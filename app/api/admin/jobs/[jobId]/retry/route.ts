// app/api/admin/jobs/[jobId]/retry/route.ts
// 管理员重跑任意用户的任务（failed 全量重跑 / completed 部分重试）。
// - handler 幂等：首次运行时自动创建子任务；重跑时跳过 done、重跑非 done（无需改动 worker）
// - 乐观锁 .eq('status', job.status) 防并发双跑；入队失败回滚原状态（M6 模式）

import { NextRequest, NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { requireAdmin, ApiError } from '../../../require-admin'
import { sendBossJob } from '@/lib/boss-client'

export const POST = withApiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) => {
  const { jobId } = await params
  const { admin } = await requireAdmin()

  const { data: job, error: fetchErr } = await admin
    .from('search_jobs')
    .select('id, status, retry_count, started_at, completed_at')
    .eq('id', jobId)
    .single()

  if (fetchErr || !job) throw new ApiError(404, '任务不存在')
  if (job.status !== 'failed' && job.status !== 'completed') {
    throw new ApiError(400, '仅失败或已完成的任务可重跑')
  }

  // 乐观锁：置回 queued，清时间戳与重排计数
  const { data: updated, error } = await admin
    .from('search_jobs')
    .update({
      status: 'queued',
      retry_count: 0,
      started_at: null,
      completed_at: null,
    })
    .eq('id', jobId)
    .eq('status', job.status)
    .select('id')

  if (error) throw new ApiError(500, error.message)
  if (!updated || updated.length === 0) {
    throw new ApiError(409, '任务状态已被其他请求修改，请刷新后重试')
  }

  try {
    await sendBossJob('search-job', { jobId })
  } catch (bossErr) {
    // 入队失败：回滚到原状态，避免留下无 pg-boss job 的 queued 记录（M6 模式）
    console.error('[admin-retry] sendBossJob failed:', (bossErr as Error).message)
    const { error: rollbackErr } = await admin
      .from('search_jobs')
      .update({
        status: job.status,
        retry_count: job.retry_count,
        started_at: job.started_at,
        completed_at: job.completed_at,
      })
      .eq('id', jobId)
      .eq('status', 'queued')
    if (rollbackErr) console.error('[admin-retry] 回滚任务状态失败:', rollbackErr.message)
    throw new ApiError(500, `入队失败: ${(bossErr as Error).message}`)
  }

  return NextResponse.json({ ok: true })
})
