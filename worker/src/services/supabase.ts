import { createClient, SupabaseClient } from '@supabase/supabase-js'
import type { AIModelRecord, SearchStrategyRecord } from '../types'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
})

/** 单个待解析文件的最大字节数（H7 修复：防止超大文件拖垮 worker 内存） */
const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB

export async function downloadFile(fileUrl: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from('documents')
    .download(fileUrl)

  if (error) throw new Error(`下载文件失败: ${error.message}`)
  if (!data) throw new Error('文件数据为空')

  // H7：下载后立刻校验大小（storage API 的 Blob 可能先返回，故 arrayBuffer 前后各校验一次）
  if (typeof (data as Blob).size === 'number' && (data as Blob).size > MAX_FILE_BYTES) {
    throw new Error(`文件超过大小限制（${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）`)
  }

  const arrayBuffer = await data.arrayBuffer()
  if (arrayBuffer.byteLength > MAX_FILE_BYTES) {
    throw new Error(`文件超过大小限制（${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB）`)
  }
  return Buffer.from(arrayBuffer)
}

export type { AIModelRecord, SearchStrategyRecord }

export async function getModel(modelId: string): Promise<AIModelRecord> {
  const { data, error } = await supabase
    .from('ai_models')
    .select('*')
    .eq('id', modelId)
    .single()

  if (error || !data) throw new Error(`获取模型失败: ${modelId}`)
  return data as AIModelRecord
}

export async function getStrategy(strategyId: string): Promise<SearchStrategyRecord> {
  const { data, error } = await supabase
    .from('search_strategies')
    .select('*')
    .eq('id', strategyId)
    .single()

  if (error || !data) throw new Error(`获取策略失败: ${strategyId}`)
  return data as SearchStrategyRecord
}

export async function getJob(jobId: string) {
  const { data, error } = await supabase
    .from('search_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (error || !data) throw new Error(`获取任务失败: ${jobId}`)
  return data
}

export async function getDocument(documentId: string) {
  const { data, error } = await supabase
    .from('patent_documents')
    .select('*')
    .eq('id', documentId)
    .single()

  if (error || !data) throw new Error(`获取文档失败: ${documentId}`)
  return data
}

export async function updateDocument(documentId: string, updates: Record<string, unknown>) {
  const { error } = await supabase
    .from('patent_documents')
    .update(updates)
    .eq('id', documentId)

  if (error) throw new Error(`更新文档失败: ${error.message}`)
}

/**
 * 更新任务记录。
 * @param match 可选：额外的等值条件（如 { status: 'running' }），用于原子状态迁移。
 *              条件不命中时 Supabase 返回空 data，此时应视为"未更新"而非报错。
 */
export async function updateJob(
  jobId: string,
  updates: Record<string, unknown>,
  match?: Record<string, unknown>
): Promise<{ updated: boolean }> {
  let query = supabase
    .from('search_jobs')
    .update(updates)
    .eq('id', jobId)

  if (match) {
    for (const [k, v] of Object.entries(match)) {
      query = query.eq(k, v)
    }
  }

  const { data, error } = await query.select('id')

  if (error) throw new Error(`更新任务失败: ${error.message}`)
  return { updated: Array.isArray(data) && data.length > 0 }
}

/**
 * 原子状态迁移：仅当当前状态为 from 时才更新为 to，防止并发路径互相覆盖。
 * （H2/H3 修复：completed/failed 等终态写入必须走此函数）
 * @returns 是否实际完成迁移（false 表示状态已被其他路径改动，调用方应停止后续写入）
 */
export async function transitionJobStatus(
  jobId: string,
  from: string,
  to: string,
  extra: Record<string, unknown> = {}
): Promise<boolean> {
  const { updated } = await updateJob(jobId, { status: to, ...extra }, { status: from })
  return updated
}

export async function updateTaskStatus(taskId: string, status: string, extra: Record<string, unknown> = {}) {
  const { error } = await supabase
    .from('search_tasks')
    .update({ status, ...extra })
    .eq('id', taskId)

  if (error) throw new Error(`更新子任务失败: ${error.message}`)
}

export async function getSearchTasks(jobId: string) {
  const { data, error } = await supabase
    .from('search_tasks')
    .select('*')
    .eq('job_id', jobId)

  if (error) throw new Error(`获取子任务失败: ${error.message}`)
  return data || []
}

/**
 * 将指定子任务重置为 pending（清 error_msg/results/started_at/completed_at）。
 * 用于部分重试与自动重排：只重跑非 done 子任务，保留已成功子任务结果。
 */
export async function resetTasksToPending(taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return
  const { error } = await supabase
    .from('search_tasks')
    .update({ status: 'pending', error_msg: null, results: null, started_at: null, completed_at: null, retry_count: 0 })
    .in('id', taskIds)

  if (error) throw new Error(`重置子任务失败: ${error.message}`)
}

/**
 * 查找卡在 running 超过阈值的任务（看门狗用）。
 */
export async function getStuckRunningJobs(thresholdMs: number): Promise<Array<{ id: string; user_id: string }>> {
  const cutoff = new Date(Date.now() - thresholdMs).toISOString()
  const { data, error } = await supabase
    .from('search_jobs')
    .select('id, user_id')
    .eq('status', 'running')
    .lt('started_at', cutoff)

  if (error) {
    console.error('[supabase] getStuckRunningJobs failed:', error.message)
    return []
  }
  return (data || []) as Array<{ id: string; user_id: string }>
}

export async function createSearchTasks(jobId: string, modelIds: string[], strategyIds: string[]) {
  // 先检查是否已存在子任务（幂等性）
  const { data: existing } = await supabase
    .from('search_tasks')
    .select('id, model_id, strategy_id, status, retry_count')
    .eq('job_id', jobId)

  if (existing && existing.length > 0) {
    console.log(`[createSearchTasks] Job ${jobId} already has ${existing.length} tasks, skipping creation`)
    return existing
  }

  const tasks = modelIds.flatMap(modelId =>
    strategyIds.map(strategyId => ({
      job_id: jobId,
      model_id: modelId,
      strategy_id: strategyId,
      status: 'pending',
      retry_count: 0
    }))
  )

  // M12：配合数据库唯一索引 uq_search_tasks_job_model_strategy，用 upsert(ignoreDuplicates=true)
  // 保证幂等——重复插入冲突时静默忽略，从根上消除"先查后插"竞态窗口下的重复子任务
  // （依赖迁移 20260803_add_search_tasks_unique.sql；若索引缺失会报错，部署时需先执行迁移）。
  const { data, error } = await supabase
    .from('search_tasks')
    .upsert(tasks, { onConflict: 'job_id,model_id,strategy_id', ignoreDuplicates: true })
    .select('id, model_id, strategy_id, status, retry_count')

  if (error) throw new Error(`创建子任务失败: ${error.message}`)
  return data
}

export async function getPlatformNames(modelIds: string[]): Promise<string[]> {
  const { data } = await supabase
    .from('ai_models')
    .select('name')
    .in('id', modelIds)

  return (data || []).map(d => d.name)
}

export async function getStrategyNames(strategyIds: string[]): Promise<string[]> {
  const { data } = await supabase
    .from('search_strategies')
    .select('name')
    .in('id', strategyIds)

  return (data || []).map(d => d.name)
}