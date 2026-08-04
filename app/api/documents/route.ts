import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { sendBossJob } from '@/lib/boss-client'
import { withApiHandler } from '@/lib/api/handler'
import type { FileType } from '@/lib/supabase/types'

/** L2：允许的文件类型白名单（与 worker/src/parsers 支持的解析器一一对应） */
const ALLOWED_FILE_TYPES: FileType[] = ['pdf', 'docx', 'xlsx', 'txt']

export const POST = withApiHandler(async (request: NextRequest) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: '请求体格式错误' }, { status: 400 })
  }

  const { fileUrl, fileName, fileType, parseModelId, parseSystemPrompt } = body as {
    fileUrl?: unknown; fileName?: unknown; fileType?: unknown
    parseModelId?: unknown; parseSystemPrompt?: unknown
  }

  // L2：输入校验——fileUrl/fileName/fileType/parseModelId 必须非空，fileType 必须白名单内
  if (typeof fileUrl !== 'string' || fileUrl.trim() === '') {
    return NextResponse.json({ error: 'fileUrl 不能为空' }, { status: 400 })
  }
  if (typeof fileName !== 'string' || fileName.trim() === '') {
    return NextResponse.json({ error: 'fileName 不能为空' }, { status: 400 })
  }
  if (typeof fileType !== 'string' || !ALLOWED_FILE_TYPES.includes(fileType as FileType)) {
    return NextResponse.json({ error: `fileType 必须是 ${ALLOWED_FILE_TYPES.join('/')}` }, { status: 400 })
  }
  if (typeof parseModelId !== 'string' || parseModelId.trim() === '') {
    return NextResponse.json({ error: 'parseModelId 不能为空' }, { status: 400 })
  }

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('patent_documents')
    .insert({
      user_id: user.id, title: fileName.trim(), file_url: fileUrl.trim(), file_type: fileType,
      parse_status: 'pending',
      parse_config: { model_id: parseModelId, system_prompt: typeof parseSystemPrompt === 'string' ? parseSystemPrompt : '' },
    })
    .select('id')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  try {
    await sendBossJob('parse-job', { documentId: data.id, parseModelId, parseSystemPrompt: typeof parseSystemPrompt === 'string' ? parseSystemPrompt : '' })
  } catch (bossErr) {
    // M5 修复：入队失败时回滚已插入的文档记录，避免留下永远 pending 的孤儿文档
    console.error('[documents] sendBossJob failed:', (bossErr as Error).message)
    const { error: rollbackErr } = await admin
      .from('patent_documents')
      .delete()
      .eq('id', data.id)
    if (rollbackErr) console.error('[documents] 回滚文档失败:', rollbackErr.message)
    return NextResponse.json({ error: `入队失败: ${(bossErr as Error).message}` }, { status: 500 })
  }

  return NextResponse.json({ documentId: data.id }, { status: 201 })
})
