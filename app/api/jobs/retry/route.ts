// app/api/jobs/retry/route.ts
// 全量重试：新建一条 job，复制原 job 的 document_id + config，作为独立任务重新执行。
// 原 failed/cancelled 记录保留作审计，通过 retried_from_job_id 关联。
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { sendBossJob } from '@/lib/boss-client'
import { withApiHandler } from '@/lib/api/handler'

export const POST = withApiHandler(async (request: NextRequest) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { jobId } = await request.json() as { jobId?: string }
  if (!jobId) return NextResponse.json({ error: '缺少 jobId' }, { status: 400 })

  // 取原任务，校验归属与终态
  const { data: orig } = await supabase
    .from('search_jobs')
    .select('id, user_id, document_id, config, status')
    .eq('id', jobId)
    .eq('user_id', user.id)
    .single()

  if (!orig) return NextResponse.json({ error: '任务不存在' }, { status: 404 })
  if (orig.status !== 'failed' && orig.status !== 'cancelled') {
    return NextResponse.json({ error: '仅失败或已取消的任务可重试' }, { status: 400 })
  }

  // 校验文档仍可检索
  const admin = createServiceClient()
  const { data: doc } = await admin
    .from('patent_documents')
    .select('id, parse_status')
    .eq('id', orig.document_id)
    .single()

  if (!doc) return NextResponse.json({ error: '原文档不存在' }, { status: 404 })
  if (doc.parse_status !== 'done') {
    return NextResponse.json({ error: '原文档解析状态不可用，请先重新解析' }, { status: 400 })
  }

  // 新建 job，复制配置
  const { data: newJob, error } = await admin
    .from('search_jobs')
    .insert({
      user_id: user.id,
      document_id: orig.document_id,
      status: 'queued',
      config: orig.config,
      retried_from_job_id: orig.id
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await sendBossJob('search-job', { jobId: newJob.id })
  } catch (bossErr) {
    await admin
      .from('search_jobs')
      .update({ status: 'failed', completed_at: new Date().toISOString() })
      .eq('id', newJob.id)
    return NextResponse.json({ error: `入队失败: ${(bossErr as Error).message}` }, { status: 500 })
  }

  return NextResponse.json({ jobId: newJob.id }, { status: 201 })
})
