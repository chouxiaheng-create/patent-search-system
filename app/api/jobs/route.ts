import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { sendBossJob } from '@/lib/boss-client'

interface JobConfig {
  model_ids: string[]; strategy_ids: string[]
  per_task_limit: number; report_limit: number
  report_model_id: string; report_system_prompt: string
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { documentId, config, scheduledAt } = await request.json() as {
    documentId: string; config: JobConfig; scheduledAt?: string
  }

  const { data: doc } = await supabase
    .from('patent_documents')
    .select('id, parse_status')
    .eq('id', documentId)
    .eq('user_id', user.id)
    .single()

  if (!doc) return Response.json({ error: '文档不存在' }, { status: 404 })
  if (doc.parse_status !== 'done') {
    return Response.json({ error: '文档尚未解析完成，无法发起检索' }, { status: 400 })
  }

  const admin = createServiceClient()
  const { data: job, error } = await admin
    .from('search_jobs')
    .insert({ user_id: user.id, document_id: documentId, status: 'queued', config, scheduled_at: scheduledAt ?? null })
    .select('id')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  try {
    await sendBossJob('search-job', { jobId: job.id }, scheduledAt ? { startAfter: new Date(scheduledAt) } : undefined)
  } catch (bossErr) {
    // pg-boss 入队失败：回滚 search_jobs 状态为 failed，避免留下卡住的 queued 记录
    console.error('[jobs] sendBossJob failed:', (bossErr as Error).message)
    await admin
      .from('search_jobs')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', job.id)
    return Response.json({ error: `入队失败: ${(bossErr as Error).message}` }, { status: 500 })
  }

  return Response.json({ jobId: job.id }, { status: 201 })
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId, status } = await request.json() as { jobId: string; status: string }

  if (!jobId || status !== 'cancelled') {
    return Response.json({ error: '仅支持取消操作' }, { status: 400 })
  }

  // 验证任务归属
  const { data: job } = await supabase
    .from('search_jobs')
    .select('id, status, user_id')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single()

  if (!job) return Response.json({ error: '任务不存在' }, { status: 404 })

  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    return Response.json({ error: '任务已结束，无法取消' }, { status: 400 })
  }

  const admin = createServiceClient()
  const { error } = await admin
    .from('search_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
