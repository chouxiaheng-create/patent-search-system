// app/(app)/admin/users/page.tsx
// 用户列表页：服务端做初次鉴权，预拉第一页；客户端组件接管交互。

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AdminUsersTable } from './users-table'

export default async function AdminUsersPage() {
  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()
  const user = authData?.user
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    return <div className="p-8 text-red-600">需要管理员权限</div>
  }

  return (
    <div className="p-6 lg:p-10 max-w-6xl">
      <h1 className="text-2xl font-semibold">用户管理</h1>
      <p className="text-muted-foreground mt-1">查看所有注册用户，切换角色以授予/收回管理员权限。</p>
      <AdminUsersTable />
    </div>
  )
}