// app/api/reports/[reportId]/documents/[docIndex]/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ reportId: string; docIndex: string }> }
) {
  const { reportId, docIndex } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const body = await request.json()
  const { user_rating, user_note } = body

  // 获取当前报告
  const { data: report, error: fetchError } = await supabase
    .from('reports')
    .select('selected_docs')
    .eq('id', reportId)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !report) {
    return NextResponse.json({ error: 'Report not found' }, { status: 404 })
  }

  // 更新指定文献
  const docs = [...report.selected_docs]
  const idx = parseInt(docIndex)
  if (idx < 0 || idx >= docs.length) {
    return NextResponse.json({ error: 'Invalid document index' }, { status: 400 })
  }

  docs[idx] = {
    ...docs[idx],
    ...(user_rating !== undefined && { user_rating }),
    ...(user_note !== undefined && { user_note }),
  }

  const { error: updateError } = await supabase
    .from('reports')
    .update({ selected_docs: docs })
    .eq('id', reportId)

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 })
  }

  return NextResponse.json({ selected_docs: docs })
}
