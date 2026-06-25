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
