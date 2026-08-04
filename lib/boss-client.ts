import { createServiceClient } from '@/lib/supabase/admin'

/**
 * 向 pg-boss 队列发送作业
 *
 * 前端 API 路线使用 Supabase RPC（send_pgboss_job）直接入队，
 * 不再尝试 pg-boss 客户端连接（Supabase pooler 连接会导致超时）。
 *
 * Worker 进程使用独立的 pg-boss 客户端消费队列。
 */
export async function sendBossJob(
  name: string,
  data: Record<string, unknown>,
  options?: { startAfter?: Date }
): Promise<void> {
  const admin = createServiceClient()
  const { error } = await admin.rpc('send_pgboss_job', {
    job_name: name,
    job_data: data,
    start_after: options?.startAfter?.toISOString() ?? new Date().toISOString()
  })

  if (error) {
    console.error('[boss-client] RPC send_pgboss_job failed:', error)
    throw new Error('Failed to enqueue job: ' + error.message)
  }
}

/**
 * L7：取消队列中尚未开始执行的 pg-boss job（state ∈ created/retry）。
 * 依赖迁移 20260803_cancel_pgboss_job_function.sql 中的 public.cancel_pgboss_job 函数；
 * 函数内部会校验该 jobId 属于当前调用者且 search_jobs.status='cancelled'（须先改 DB 状态再调用）。
 * 已在执行中的 job 无法取消（由 worker 的轮询检查协作退出）。
 */
export async function cancelBossJob(name: string, data: Record<string, unknown>): Promise<void> {
  const supabase = await import('@/lib/supabase/server').then(m => m.createClient())
  const { error } = await supabase.rpc('cancel_pgboss_job', {
    p_job_name: name,
    p_job_data: data,
  })
  if (error) {
    // 取消队列失败不致命（worker 消费时会再次检查 status==='cancelled' 后跳过），仅告警
    console.warn('[boss-client] RPC cancel_pgboss_job failed:', error.message)
  }
}
