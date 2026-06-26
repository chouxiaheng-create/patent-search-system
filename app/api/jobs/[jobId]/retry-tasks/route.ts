// app/api/jobs/[jobId]/retry-tasks/route.ts
// 部分重试：复用同一条 job，仅重跑失败/未完成的子任务（handler 自动跳过 done、只重跑非 done）。
// 保留已成功子任务的结果，重跑完成后重新生成报告。
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { sendBossJob } from '@/lib/boss-client'

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) {
  const { jobId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // 校验归属与状态
  const { data: job } = await supabase
    .from('search_jobs')
    .select('id, status')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single()

  if (!job) return Response.json({ error: '任务不存在' }, { status: 404 })
  if (job.status !== 'completed' && job.status !== 'failed') {
    return Response.json({ error: '仅已完成或失败的任务可部分重试' }, { status: 400 })
  }

  // 校验存在可重跑的子任务（非 done）
  const admin = createServiceClient()
  const { count } = await admin
    .from('search_tasks')
    .select('*', { count: 'exact', head: true })
    .eq('job_id', jobId)
    .neq('status', 'done')

  if (count === 0 || count === null) {
    return Response.json({ error: '没有可重试的失败子任务' }, { status: 400 })
  }

  // 置回 queued，清时间戳与重排计数；handler 会自动重置非 done 子任务为 pending 并重跑
  const { error } = await admin
    .from('search_jobs')
    .update({
      status: 'queued',
      retry_count: 0,
      started_at: null,
      completed_at: null
    })
    .eq('id', jobId)

  if (error) return Response.json({ error: error.message }, { status: 500 })

  try {
    await sendBossJob('search-job', { jobId })
  } catch (bossErr) {
    return Response.json({ error: `入队失败: ${(bossErr as Error).message}` }, { status: 500 })
  }

  return Response.json({ ok: true }, { status: 200 })
}
