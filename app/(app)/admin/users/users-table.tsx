// app/(app)/admin/users/users-table.tsx
// 列表页（用户表格）：搜索 + 分页 + 角色切换
// 报告导出入口：顶部"批量导出报告"按钮 → 跳转 /admin/export 选报告

'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { RoleSwitchDialog } from '@/components/admin/role-switch-dialog'
import Link from 'next/link'

type User = {
  id: string
  email: string
  role: 'admin' | 'user'
  created_at: string
  stats: { documents: number; jobs: number; reports: number }
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('zh-CN')
const fmtCount = (n: number | null | undefined) => (n == null ? '-' : n)

export function AdminUsersTable() {
  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [dialogUser, setDialogUser] = useState<User | null>(null)

  async function load() {
    setLoading(true)
    try {
      const url = new URL('/api/admin/users', window.location.origin)
      url.searchParams.set('page', String(page))
      url.searchParams.set('pageSize', '20')
      if (search) url.searchParams.set('search', search)
      const res = await fetch(url)
      const body = await res.json()
      if (!res.ok) {
        const msg = body.error || body.detail || body.message || `HTTP ${res.status}`
        throw new Error(`[${res.status}] ${msg}`)
      }
      setUsers(body.users)
      setTotal(body.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [page, search])

  const totalPages = Math.max(1, Math.ceil(total / 20))

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="按邮箱搜索…"
          value={search}
          onChange={(e) => { setPage(1); setSearch(e.target.value) }}
          className="max-w-sm"
        />
        <span className="text-sm text-muted-foreground">共 {total} 个用户</span>
        <div className="ml-auto">
          <Link href="/admin/export">
            <Button variant="outline" size="sm">批量导出报告 →</Button>
          </Link>
        </div>
      </div>

      <div className="border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left p-3">邮箱</th>
              <th className="text-left p-3">角色</th>
              <th className="text-left p-3">注册时间</th>
              <th className="text-left p-3">文件 / 任务 / 报告</th>
              <th className="text-left p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">加载中…</td></tr>}
            {!loading && users.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">未找到用户</td></tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-3">{u.email}</td>
                <td className="p-3">
                  <button onClick={() => setDialogUser(u)} title="点击切换">
                    <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                      {u.role === 'admin' ? '管理员' : '用户'}
                    </Badge>
                  </button>
                </td>
                <td className="p-3">{fmtDate(u.created_at)}</td>
                <td className="p-3 text-muted-foreground">
                  {fmtCount(u.stats.documents)} / {fmtCount(u.stats.jobs)} / {fmtCount(u.stats.reports)}
                </td>
                <td className="p-3">
                  <Link className="text-blue-600 hover:underline" href={`/admin/users/${u.id}`}>详情</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
        <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
      </div>

      {dialogUser && (
        <RoleSwitchDialog
          open={Boolean(dialogUser)}
          onOpenChange={(open) => !open && setDialogUser(null)}
          currentRole={dialogUser.role}
          targetUserId={dialogUser.id}
          onSuccess={(newRole) => {
            setUsers((prev) => prev.map((x) => x.id === dialogUser.id ? { ...x, role: newRole } : x))
          }}
        />
      )}
    </div>
  )
}