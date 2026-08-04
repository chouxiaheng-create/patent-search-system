// app/(app)/admin/jobs/page.tsx
// 任务队列页：服务端做初次鉴权，客户端组件接管交互（与 admin/users 页同模式）。

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { JobsTable } from '@/components/admin/jobs-table'

export default async function AdminJobsPage() {
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
      <h1 className="text-2xl font-semibold">任务队列</h1>
      <p className="text-muted-foreground mt-1">
        查看所有用户的任务执行情况；任务卡住时可手动取消，修复后可一键重跑失败任务。
      </p>
      <JobsTable />
    </div>
  )
}
