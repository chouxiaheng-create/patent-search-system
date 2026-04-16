// app/api/models/[modelId]/route.ts
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('ai_models')
    .select('id, owner_id, is_builtin')
    .eq('id', modelId)
    .single()

  if (!existing) return Response.json({ error: '模型不存在' }, { status: 404 })
  if (existing.is_builtin || existing.owner_id !== user.id) {
    return Response.json({ error: '无权修改此模型' }, { status: 403 })
  }

  const body = await request.json()
  const { name, api_base_url, model_id, api_key, usage_types, capabilities, adapter_config } = body as {
    name?: string; api_base_url?: string; model_id?: string; api_key?: string
    usage_types?: string[]; capabilities?: { deep_reasoning: boolean; web_search: boolean }
    adapter_config?: Record<string, unknown>
  }

  const updates: Record<string, unknown> = {}
  if (name?.trim()) updates.name = name.trim()
  if (api_base_url?.trim()) updates.api_base_url = api_base_url.trim()
  if (model_id?.trim()) updates.model_id = model_id.trim()
  if (api_key !== undefined) updates.api_key_encrypted = api_key
  if (usage_types) updates.usage_types = usage_types
  if (capabilities) updates.capabilities = capabilities
  if (adapter_config) updates.adapter_config = adapter_config

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('ai_models')
    .update(updates)
    .eq('id', modelId)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('ai_models')
    .select('id, owner_id, is_builtin')
    .eq('id', modelId)
    .single()

  if (!existing) return Response.json({ error: '模型不存在' }, { status: 404 })
  if (existing.is_builtin || existing.owner_id !== user.id) {
    return Response.json({ error: '无权删除此模型' }, { status: 403 })
  }

  const admin = createServiceClient()
  const { error } = await admin.from('ai_models').delete().eq('id', modelId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
