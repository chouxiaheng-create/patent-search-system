import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { getBossClient } from '@/lib/boss-client'

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

  const boss = await getBossClient()
  await boss.send('search-job', { jobId: job.id }, scheduledAt ? { startAfter: new Date(scheduledAt) } : undefined)

  return Response.json({ jobId: job.id }, { status: 201 })
}
