import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { withApiHandler } from '@/lib/api/handler'
import { withCache, invalidateCache } from '@/lib/api/cache'

const CACHE_TTL = 3 * 60 * 1000 // 3 分钟

export const GET = withApiHandler(async (_request: NextRequest) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const cacheKey = `strategies-${user.id}`
  const data = await withCache(cacheKey, CACHE_TTL, async () => {
    const { data, error } = await supabase
      .from('search_strategies')
      .select('*')
      .or(`owner_id.is.null,owner_id.eq.${user.id}`)
      .order('is_builtin', { ascending: false })
      .order('name')
    if (error) throw new Error(error.message)
    return data
  })

  return NextResponse.json(data)
})

export const POST = withApiHandler(async (request: NextRequest) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, prompt_template } = body as { name: string; prompt_template: string }

  if (!name?.trim() || !prompt_template?.trim()) {
    return NextResponse.json({ error: '名称和提示词模板不能为空' }, { status: 400 })
  }

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('search_strategies')
    .insert({ owner_id: user.id, name: name.trim(), prompt_template: prompt_template.trim(), is_builtin: false })
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  invalidateCache(`strategies-${user.id}`)
  return NextResponse.json(data, { status: 201 })
})
