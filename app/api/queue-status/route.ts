import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { withApiHandler } from '@/lib/api/handler'

export const GET = withApiHandler(async (_request: NextRequest) => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // 使用 service role 查询，因为 RLS 可能限制普通用户读取 built-in 数据
  const admin = createServiceClient()
  const { count, error } = await admin
    .from('search_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'queued')

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ queuedCount: count ?? 0 })
})
