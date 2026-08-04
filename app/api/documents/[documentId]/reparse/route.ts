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

  // 验证文档归属（同时记录原解析状态，供 H6 入队失败回滚使用）
  const { data: doc, error: docErr } = await supabase
    .from('patent_documents')
    .select('id, title, parse_config, user_id, parse_status')
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
  const prevParseStatus = doc.parse_status as string | undefined
  const { error: updateErr } = await admin
    .from('patent_documents')
    .update({ parse_status: 'pending', quality_warning: null })
    .eq('id', documentId)

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 })
  }

  try {
    await sendBossJob('parse-job', {
      documentId,
      parseModelId,
      parseSystemPrompt: parseConfig?.system_prompt ?? '',
    })
  } catch (bossErr) {
    // H6 修复：入队失败时回滚 parse_status 到原值，避免文档永久卡在 pending（队列无任务）
    console.error('[reparse] sendBossJob failed:', (bossErr as Error).message)
    const { error: rollbackErr } = await admin
      .from('patent_documents')
      .update({ parse_status: prevParseStatus ?? 'failed', quality_warning: null })
      .eq('id', documentId)
    if (rollbackErr) console.error('[reparse] 回滚解析状态失败:', rollbackErr.message)
    return NextResponse.json({ error: `入队失败: ${(bossErr as Error).message}` }, { status: 500 })
  }

  return NextResponse.json({ ok: true, documentId })
})
