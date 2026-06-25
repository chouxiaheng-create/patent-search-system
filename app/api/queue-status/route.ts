import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // 使用 service role 查询，因为 RLS 可能限制普通用户读取 built-in 数据
  const admin = createServiceClient()
  const { count, error } = await admin
    .from('search_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'queued')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ queuedCount: count ?? 0 })
}
