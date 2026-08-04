import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { sendBossJob, cancelBossJob } from '@/lib/boss-client'
import { withApiHandler } from '@/lib/api/handler'

interface JobConfig {
  model_ids: string[]; strategy_ids: string[]
  per_task_limit: number; report_limit: number
  report_model_id: string; report_system_prompt: string
}

/** M13：config 字段上限约束（防止负数/0/超大值导致异常切片或资源滥用） */
const CONFIG_LIMITS = {
  per_task_limit: { min: 1, max: 50 },
  report_limit: { min: 1, max: 200 },
  max_model_ids: 10,
  max_strategy_ids: 10,
  max_string_len: 5000,
}

/**
 * M13：校验并规范化 JobConfig。
 * 返回 null 表示校验失败（调用方应返回 400）。
 */
function validateJobConfig(input: unknown): JobConfig | null {
  if (!input || typeof input !== 'object') return null
  const c = input as Record<string, unknown>

  if (!Array.isArray(c.model_ids) || c.model_ids.length === 0 || c.model_ids.length > CONFIG_LIMITS.max_model_ids) return null
  if (!Array.isArray(c.strategy_ids) || c.strategy_ids.length === 0 || c.strategy_ids.length > CONFIG_LIMITS.max_strategy_ids) return null
  const modelIds = c.model_ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
  const strategyIds = c.strategy_ids.filter((x): x is string => typeof x === 'string' && x.length > 0)
  if (modelIds.length === 0 || strategyIds.length === 0) return null

  const perTask = Number(c.per_task_limit)
  if (!Number.isInteger(perTask) || perTask < CONFIG_LIMITS.per_task_limit.min || perTask > CONFIG_LIMITS.per_task_limit.max) return null

  const reportLimit = Number(c.report_limit)
  if (!Number.isInteger(reportLimit) || reportLimit < CONFIG_LIMITS.report_limit.min || reportLimit > CONFIG_LIMITS.report_limit.max) return null

  if (typeof c.report_model_id !== 'string' || c.report_model_id.trim() === '') return null

  const reportSystemPrompt = typeof c.report_system_prompt === 'string' ? c.report_system_prompt : ''
  if (reportSystemPrompt.length > CONFIG_LIMITS.max_string_len) return null

  return {
    model_ids: modelIds,
    strategy_ids: strategyIds,
    per_task_limit: perTask,
    report_limit: reportLimit,
    report_model_id: c.report_model_id.trim(),
    report_system_prompt: reportSystemPrompt,
  }
}

/** L1：解析并校验 scheduledAt 为合法 ISO 时间（未来时间），非法返回 null */
function parseScheduledAt(value: unknown): { iso: string; date: Date } | null {
  if (value === undefined || value === null) return null
  if (typeof value !== 'string' || value.trim() === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return { iso: date.toISOString(), date }
}

export const POST = withApiHandler(async (request: NextRequest) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // L1：非法 JSON 直接 400，不再抛 500
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  const { documentId, config, scheduledAt } = body as {
    documentId?: unknown; config?: unknown; scheduledAt?: unknown
  }

  if (typeof documentId !== 'string' || documentId.trim() === '') {
    return NextResponse.json({ error: 'documentId 不能为空' }, { status: 400 })
  }

  // M13：config schema 校验
  const validatedConfig = validateJobConfig(config)
  if (!validatedConfig) {
    return NextResponse.json({
      error: 'config 校验失败：model_ids/strategy_ids 需为非空字符串数组（≤10 个），per_task_limit 1-50，report_limit 1-200，report_model_id 必填',
    }, { status: 400 })
  }

  // L1：scheduledAt 校验（非法日期直接 400，避免 toISOString() 抛 RangeError）
  const scheduled = parseScheduledAt(scheduledAt)
  if (scheduledAt !== undefined && scheduledAt !== null && !scheduled) {
    return NextResponse.json({ error: 'scheduledAt 格式非法' }, { status: 400 })
  }

  const { data: doc } = await supabase
    .from('patent_documents')
    .select('id, parse_status')
    .eq('id', documentId)
    .eq('user_id', user.id)
    .single()

  if (!doc) return NextResponse.json({ error: '文档不存在' }, { status: 404 })
  if (doc.parse_status !== 'done') {
    return NextResponse.json({ error: '文档尚未解析完成，无法发起检索' }, { status: 400 })
  }

  const admin = createServiceClient()
  const { data: job, error } = await admin
    .from('search_jobs')
    .insert({ user_id: user.id, document_id: documentId, status: 'queued', config: validatedConfig, scheduled_at: scheduled?.iso ?? null })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await sendBossJob('search-job', { jobId: job.id }, scheduled ? { startAfter: scheduled.date } : undefined)
  } catch (bossErr) {
    // pg-boss 入队失败：回滚 search_jobs 状态为 failed，避免留下卡住的 queued 记录
    console.error('[jobs] sendBossJob failed:', (bossErr as Error).message)
    await admin
      .from('search_jobs')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', job.id)
    return NextResponse.json({ error: `入队失败: ${(bossErr as Error).message}` }, { status: 500 })
  }

  return NextResponse.json({ jobId: job.id }, { status: 201 })
})

export const PATCH = withApiHandler(async (request: NextRequest) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // L1：非法 JSON 直接 400
  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  const { jobId, status } = body as { jobId?: unknown; status?: unknown }

  if (typeof jobId !== 'string' || !jobId || status !== 'cancelled') {
    return NextResponse.json({ error: '仅支持取消操作' }, { status: 400 })
  }

  // 验证任务归属
  const { data: job } = await supabase
    .from('search_jobs')
    .select('id, status, user_id')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single()

  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 })

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return NextResponse.json({ error: '任务已结束，无法取消' }, { status: 400 })
  }

  const admin = createServiceClient()
  // 原子迁移：仅 running/queued → cancelled，防止与 worker 终态写入竞争
  const { data: updated, error } = await admin
    .from('search_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['queued', 'running'])
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: '任务状态已变化，无法取消' }, { status: 409 })
  }

  // L7：尝试取消队列中未开始的 pg-boss job（函数内校验归属；失败不阻塞，worker 消费时会检查 cancelled 跳过）
  await cancelBossJob('search-job', { jobId })

  return NextResponse.json({ ok: true })
})
