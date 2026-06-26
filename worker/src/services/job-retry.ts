// worker/src/services/job-retry.ts
// 卡住/失败任务的恢复策略：
// - handleJobFailure：handler catch 路径调用，带 JOB 级自动重排（最多 MAX_JOB_RETRIES 次）。
// - markJobFailed：不重排，直接判 failed（看门狗、重排入队失败、重排上限已达时使用）。
// 所有 DB/RPC await 套 withTimeout，保证收尾不会因 DB 不可达而挂住 handler。
import { supabase } from './supabase'
import { sendNotification } from './notification'
import { withTimeout } from '../utils/retry'

/** JOB 级自动重排上限（"重试一定次数"中的"次数"） */
export const MAX_JOB_RETRIES = 2
/** 重排退避（startAfter = now + 此值） */
export const RETRY_BACKOFF_MS = 30 * 1000
/** 收尾路径 DB/RPC 调用超时 */
const DB_CALL_TIMEOUT_MS = 30 * 1000

/**
 * handler 失败时调用：
 *  - retry_count < MAX 且状态为 running/failed → 原子自增 retry_count、置 queued、重排入队（带 30s 退避）。
 *  - 否则（重排上限已达 / 状态不满足）→ markJobFailed。
 * 同一 job 单并发消费，handleJobFailure 不会被并发调用；乐观锁（eq retry_count）作为额外保护。
 */
export async function handleJobFailure(jobId: string, reason: string): Promise<void> {
  let job: { retry_count: number; status: string; user_id: string } | null = null
  try {
    const res = await withTimeout(
      supabase.from('search_jobs').select('retry_count, status, user_id').eq('id', jobId).single(),
      DB_CALL_TIMEOUT_MS,
      'handleJobFailure.fetch'
    )
    if (res.error || !res.data) {
      console.error(`[job-retry] fetch job ${jobId} failed:`, res.error?.message)
      return
    }
    job = res.data as { retry_count: number; status: string; user_id: string }
  } catch (err) {
    console.error(`[job-retry] fetch job ${jobId} threw:`, (err as Error).message)
    return
  }

  const canRequeue = job.retry_count < MAX_JOB_RETRIES && (job.status === 'running' || job.status === 'failed')
  if (canRequeue) {
    try {
      const updateRes = await withTimeout(
        supabase
          .from('search_jobs')
          .update({ retry_count: job.retry_count + 1, status: 'queued', started_at: null, completed_at: null })
          .eq('id', jobId)
          .eq('retry_count', job.retry_count) // 乐观锁，防并发双跑
          .select('id'),
        DB_CALL_TIMEOUT_MS,
        'handleJobFailure.requeue'
      )
      if (updateRes.error || !updateRes.data || updateRes.data.length === 0) {
        // 乐观锁未命中（已被改动）或出错 → 落到 markJobFailed
        console.warn(`[job-retry] requeue optimistic lock miss for ${jobId}, marking failed`)
        await markJobFailed(jobId, reason, job.user_id)
        return
      }

      // 重排入队（复用 send_pgboss_job RPC，参数与首次入队同源）
      const startAfter = new Date(Date.now() + RETRY_BACKOFF_MS).toISOString()
      const rpcRes = await withTimeout(
        supabase.rpc('send_pgboss_job', {
          job_name: 'search-job',
          job_data: { jobId },
          start_after: startAfter
        }),
        DB_CALL_TIMEOUT_MS,
        'handleJobFailure.reenqueue'
      )
      if (rpcRes.error) {
        console.error(`[job-retry] re-enqueue RPC failed for ${jobId}:`, rpcRes.error.message)
        // 入队失败：回滚 queued 状态，直接判 failed，避免留下无 pg-boss job 的 queued 记录
        await markJobFailed(jobId, `重排入队失败: ${rpcRes.error.message}`, job.user_id)
        return
      }

      console.log(`[job-retry] Job ${jobId} re-queued (attempt ${job.retry_count + 1}/${MAX_JOB_RETRIES}): ${reason}`)
      await sendNotification(
        job.user_id,
        'job_failed',
        `检索任务将自动重试（第 ${job.retry_count + 1}/${MAX_JOB_RETRIES} 次）：${reason}`,
        jobId
      ).catch(() => {})
      return
    } catch (err) {
      console.error(`[job-retry] requeue path threw for ${jobId}:`, (err as Error).message)
      await markJobFailed(jobId, reason, job.user_id)
      return
    }
  }

  // 重排上限已达或状态不满足 → 终态 failed
  await markJobFailed(jobId, reason, job.user_id)
}

/**
 * 不重排，直接判 failed（仅 running→failed，不覆盖已终态）。
 * 看门狗、重排入队失败、重排上限耗尽时使用。
 */
export async function markJobFailed(jobId: string, reason: string, userId?: string): Promise<void> {
  try {
    const res = await withTimeout(
      supabase
        .from('search_jobs')
        .update({ status: 'failed', completed_at: new Date().toISOString() })
        .eq('id', jobId)
        .eq('status', 'running') // 仅 running→failed，不覆盖 completed/failed/cancelled
        .select('user_id'),
      DB_CALL_TIMEOUT_MS,
      'markJobFailed'
    )
    if (res.error) {
      console.error(`[job-retry] markJobFailed update failed for ${jobId}:`, res.error.message)
      return
    }
    const uid = userId ?? (res.data && res.data[0] ? (res.data[0] as { user_id: string }).user_id : undefined)
    if (uid) {
      await sendNotification(uid, 'job_failed', `检索任务失败: ${reason}`, jobId).catch(() => {})
    }
  } catch (err) {
    console.error(`[job-retry] markJobFailed threw for ${jobId}:`, (err as Error).message)
  }
}
