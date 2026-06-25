import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('ai_models')
    .select('id, owner_id, name, api_base_url, model_id, is_builtin, usage_types, capabilities, adapter_config, created_at')
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
  const { name, api_base_url, model_id, api_key, usage_types, capabilities, adapter_config } = body as {
    name: string
    api_base_url: string
    model_id: string
    api_key: string
    usage_types: string[]
    capabilities: { deep_reasoning: boolean; web_search: boolean }
    adapter_config?: Record<string, unknown>
  }

  if (!name?.trim() || !api_base_url?.trim() || !model_id?.trim()) {
    return Response.json({ error: '名称、API地址和模型ID不能为空' }, { status: 400 })
  }

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('ai_models')
    .insert({
      owner_id: user.id,
      name: name.trim(),
      api_base_url: api_base_url.trim(),
      model_id: model_id.trim(),
      api_key_encrypted: api_key ?? '',
      usage_types: usage_types ?? [],
      capabilities: capabilities ?? { deep_reasoning: false, web_search: false },
      adapter_config: adapter_config ?? { provider: 'openai_compat', web_search_method: 'none', thinking_method: 'none', web_search_disables_thinking: false, thinking_default_on: false },
      is_builtin: false,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  // 响应中剔除 api_key_encrypted
  const { api_key_encrypted: _, ...safeData } = data as Record<string, unknown>
  return Response.json(safeData, { status: 201 })
}
