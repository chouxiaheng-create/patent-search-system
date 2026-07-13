// app/api/documents/[documentId]/reparse/route.ts
// 重新解析已有文档（适用于历史文献复用场景）
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { sendBossJob } from '@/lib/boss-client'
import { withApiHandler } from '@/lib/api/handler'

export const POST = withApiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) => {
  const { documentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 验证文档归属
  const { data: doc, error: docErr } = await supabase
    .from('patent_documents')
    .select('id, title, parse_config, user_id')
    .eq('id', documentId)
    .eq('user_id', user.id)
    .single()

  if (docErr || !doc) {
    return NextResponse.json({ error: '文档不存在或无权访问' }, { status: 404 })
  }

  // 获取解析配置
  const parseConfig = doc.parse_config as { model_id?: string; system_prompt?: string } | null
  const parseModelId = parseConfig?.model_id
  if (!parseModelId) {
    return NextResponse.json({ error: '该文档缺少解析模型配置，请重新上传' }, { status: 400 })
  }

  // 重置状态并排入解析队列
  const admin = createServiceClient()
  const { error: updateErr } = await admin
    .from('patent_documents')
    .update({ parse_status: 'pending', quality_warning: null })
    .eq('id', documentId)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  await sendBossJob('parse-job', {
    documentId,
    parseModelId,
    parseSystemPrompt: parseConfig?.system_prompt ?? '',
  })

  return NextResponse.json({ ok: true, documentId })
})
