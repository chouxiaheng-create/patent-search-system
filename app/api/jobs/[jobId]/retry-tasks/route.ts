// app/api/jobs/[jobId]/retry-tasks/route.ts
// 部分重试：复用同一条 job，仅重跑失败/未完成的子任务（handler 自动跳过 done、只重跑非 done）。
// 保留已成功子任务的结果，重跑完成后重新生成报告。
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { sendBossJob } from '@/lib/boss-client'
import { withApiHandler } from '@/lib/api/handler'

export const POST = withApiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) => {
  const { jobId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 校验归属与状态（记录原状态/时间戳，供 M6 入队失败回滚）
  const { data: job } = await supabase
    .from('search_jobs')
    .select('id, status, started_at, completed_at, retry_count')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single()

  if (!job) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  if (job.status !== 'completed' && job.status !== 'failed') {
    return NextResponse.json({ error: '仅已完成或失败的任务可部分重试' }, { status: 400 })
  }

  // 校验存在可重跑的子任务（非 done）
  const admin = createServiceClient()
  const { count } = await admin
    .from('search_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .neq('status', 'done')

  if (count === 0 || count === null) {
    return NextResponse.json({ error: '没有可重试的失败子任务' }, { status: 400 })
  }

  // 置回 queued，清时间戳与重排计数；handler 会自动重置非 done 子任务为 pending 并重跑
  // M6 修复：用 .eq('status', job.status) 做乐观锁——若其他请求已抢先修改（如重复点击），
  // 条件不命中则返回 409，从根上防止同一 job 被多次入队导致并发重复执行子任务。
  const { data: updated, error } = await admin
    .from('search_jobs')
    .update({
      status: 'queued',
      retry_count: 0,
      started_at: null,
      completed_at: null
    })
    .eq('id', jobId)
    .eq('status', job.status)
    .select('id')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: '任务状态已被其他请求修改，请刷新后重试' }, { status: 409 })
  }

  try {
    await sendBossJob('search-job', { jobId })
  } catch (bossErr) {
    // M6 修复：入队失败时回滚到原状态，避免 job 卡在 queued 且队列无任务
    console.error('[retry-tasks] sendBossJob failed:', (bossErr as Error).message)
    const { error: rollbackErr } = await admin
      .from('search_jobs')
      .update({
        status: job.status,
        retry_count: job.retry_count,
        started_at: job.started_at,
        completed_at: job.completed_at
      })
      .eq('id', jobId)
      .eq('status', 'queued') // 仅当仍是 queued 时回滚，防止覆盖其他路径的改动
    if (rollbackErr) console.error('[retry-tasks] 回滚任务状态失败:', rollbackErr.message)
    return NextResponse.json({ error: `入队失败: ${(bossErr as Error).message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true }, { status: 200 })
})
