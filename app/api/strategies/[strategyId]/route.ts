import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { withApiHandler } from '@/lib/api/handler'

export const PUT = withApiHandler(async (
  request: NextRequest,
  { params }: { params: Promise<{ strategyId: string }> }
) => {
  const { strategyId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, prompt_template } = body as { name?: string; prompt_template?: string }

  const { data: existing } = await supabase
    .from('search_strategies')
    .select('id, owner_id, is_builtin')
    .eq('id', strategyId)
    .single()

  if (!existing) return NextResponse.json({ error: '策略不存在' }, { status: 404 })
  if (existing.is_builtin || existing.owner_id !== user.id) {
    return NextResponse.json({ error: '无权修改此策略' }, { status: 403 })
  }

  const updates: Record<string, string> = {}
  if (name?.trim()) updates.name = name.trim()
  if (prompt_template?.trim()) updates.prompt_template = prompt_template.trim()

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('search_strategies')
    .update(updates)
    .eq('id', strategyId)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
})
