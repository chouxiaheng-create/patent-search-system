// app/(app)/admin/export/page.tsx
// 批量导出页面：选一个或多个用户 → 展开看报告 → 勾报告 → 导出 Markdown
// 服务端鉴权 + 拉用户列表（service_role）；客户端组件负责按用户展开报告 + 多选

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { ExportPicker } from './export-picker'

export default async function AdminExportPage() {
  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()
  const user = authData?.user
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return <div className="p-8 text-red-600">需要管理员权限</div>
  }

  // 拉所有用户（service_role；纯邮箱列表即可，按 email 排序方便定位）
  const admin = createServiceClient()
  const { data: users, error } = await admin
    .from('profiles')
    .select('id, email')
    .order('email', { ascending: true })

  if (error) {
    return <div className="p-8 text-red-600">用户列表加载失败：{error.message}</div>
  }

  return (
    <div className="p-6 lg:p-10 max-w-6xl space-y-6">
      <div>
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">← 返回用户列表</Link>
      </div>
      <div>
        <h1 className="text-2xl font-semibold">批量导出报告</h1>
        <p className="text-sm text-muted-foreground mt-1">
          按用户展开报告列表，勾选要导出的报告后点击导出按钮（最多 200 个报告 / 次）
        </p>
      </div>
      <ExportPicker
        users={(users ?? []).map((u) => ({ id: u.id, email: u.email ?? '(no email)' }))}
      />
    </div>
  )
}