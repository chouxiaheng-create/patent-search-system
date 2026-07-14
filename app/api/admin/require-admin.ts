// app/api/admin/require-admin.ts
// 管理员鉴权 helper。所有 /api/admin/* 路由必须通过它。
// 双重防御：先查 role，再返回上下文（即使 RLS 被绕过也会拦）。

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

export type AdminContext = {
  userId: string
  supabase: Awaited<ReturnType<typeof createClient>>
  admin: ReturnType<typeof createServiceClient>
}

export async function requireAdmin(): Promise<AdminContext> {
  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()
  const user = authData?.user
  if (!user) throw new ApiError(401, '未登录')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin') {
    throw new ApiError(403, '需要管理员权限')
  }

  const admin = createServiceClient()
  return { userId: user.id, supabase, admin }
}