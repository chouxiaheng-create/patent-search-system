import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('search_strategies')
    .select('*')
    .or(`owner_id.is.null,owner_id.eq.${user.id}`)
    .order('is_builtin', { ascending: false })
    .order('name')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, prompt_template } = body as { name: string; prompt_template: string }

  if (!name?.trim() || !prompt_template?.trim()) {
    return Response.json({ error: '名称和提示词模板不能为空' }, { status: 400 })
  }

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('search_strategies')
    .insert({ owner_id: user.id, name: name.trim(), prompt_template: prompt_template.trim(), is_builtin: false })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
