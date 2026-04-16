import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { count, error } = await supabase
    .from('search_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'queued')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ queuedCount: count ?? 0 })
}
