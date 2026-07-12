import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { withApiHandler } from '@/lib/api/handler'

export const GET = withApiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) => {
  const { documentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('patent_documents')
    .select('*')
    .eq('id', documentId)
    .eq('user_id', user.id)
    .single()

  if (error || !data) return NextResponse.json({ error: '文档不存在' }, { status: 404 })
  return NextResponse.json(data)
})

export const PATCH = withApiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) => {
  const { documentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: doc } = await supabase
    .from('patent_documents')
    .select('id')
    .eq('id', documentId)
    .eq('user_id', user.id)
    .single()

  if (!doc) return NextResponse.json({ error: '文档不存在或无权修改' }, { status: 404 })

  const { parsed_data, user_notes } = await request.json() as {
    parsed_data?: Record<string, unknown>; user_notes?: string
  }

  const updates: Record<string, unknown> = {}
  if (parsed_data !== undefined) updates.parsed_data = parsed_data
  if (user_notes !== undefined) updates.user_notes = user_notes

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('patent_documents')
    .update(updates)
    .eq('id', documentId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
})
