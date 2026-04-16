import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import type { UserPreferences } from '@/lib/supabase/types'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('profiles')
    .select('preferences')
    .eq('id', user.id)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data?.preferences ?? null)
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const preferences = await request.json() as UserPreferences

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('profiles')
    .update({ preferences })
    .eq('id', user.id)
    .select('preferences')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data?.preferences)
}
