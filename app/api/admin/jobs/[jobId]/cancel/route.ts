// app/api/admin/jobs/[jobId]/cancel/route.ts
// 管理员取消任意用户的任务（queued/running → cancelled）。
// - 原子迁移复用用户取消路径的模式（.in('status', ['queued','running']) 防竞争）
// - pg-boss 队列清理走 admin_cancel_pgboss_job RPC（20260804 迁移），失败不阻塞
// - 运行中任务由 worker 5s 轮询感知 cancelled 后在批次边界退出

import { NextRequest, NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { requireAdmin, ApiError } from '../../../require-admin'

export const POST = withApiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) => {
  const { jobId } = await params
  const { admin } = await requireAdmin()

  const { data: job, error: fetchErr } = await admin
    .from('search_jobs')
    .select('id, status')
    .eq('id', jobId)
    .single()

  if (fetchErr || !job) throw new ApiError(404, '任务不存在')
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    throw new ApiError(400, '任务已结束，无法取消')
  }

  // 原子迁移：仅 queued/running → cancelled，防止与 worker 终态写入竞争
  const { data: updated, error } = await admin
    .from('search_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['queued', 'running'])
    .select('id')

  if (error) throw new ApiError(500, error.message)
  if (!updated || updated.length === 0) {
    throw new ApiError(409, '任务状态已变化，无法取消')
  }

  // 清理 pg-boss 队列中排队中的 job（best-effort：失败不阻塞，worker 消费时会检查 cancelled 跳过）
  const { error: rpcErr } = await admin.rpc('admin_cancel_pgboss_job', {
    p_job_name: 'search-job',
    p_job_data: { jobId },
  })
  if (rpcErr) console.warn('[admin-cancel] RPC admin_cancel_pgboss_job failed:', rpcErr.message)

  return NextResponse.json({ ok: true })
})
