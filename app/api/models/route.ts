import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('ai_models')
    .select('*')
    .or(`owner_id.is.null,owner_id.eq.${user.id}`)
    .order('is_builtin', { ascending: false })
    .order('name')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
