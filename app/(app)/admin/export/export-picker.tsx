// app/(app)/admin/export/export-picker.tsx
// 客户端：左侧用户列表（展开/收起）+ 右侧报告勾选 + 顶栏导出
// 报告懒加载：点开用户时按需 fetch /api/admin/users/[id] 取 reports

'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'

type UserRow = { id: string; email: string }
type ReportRow = { id: string; job_id: string; created_at: string; doc_count: number }

export function ExportPicker({ users }: { users: UserRow[] }) {
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [reportsByUser, setReportsByUser] = useState<Map<string, ReportRow[]>>(new Map())
  const [loadingUser, setLoadingUser] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())   // report ids
  const [exporting, setExporting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  const filtered = users.filter((u) => !search || u.email.toLowerCase().includes(search.toLowerCase()))

  async function toggleUser(uid: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(uid)) next.delete(uid)
      else next.add(uid)
      return next
    })
    if (!reportsByUser.has(uid)) {
      setLoadingUser(uid)
      try {
        const res = await fetch(`/api/admin/users/${uid}`)
        const body = await res.json()
        if (!res.ok) throw new Error(body.error || body.detail || `HTTP ${res.status}`)
        const reports: ReportRow[] = (body.reports ?? []).map((r: { id: string; job_id: string; created_at: string; doc_count: number }) => ({
          id: r.id,
          job_id: r.job_id,
          created_at: r.created_at,
          doc_count: r.doc_count ?? 0,
        }))
        setReportsByUser((prev) => {
          const next = new Map(prev)
          next.set(uid, reports)
          return next
        })
      } catch (e) {
        setMsg('加载报告失败：' + (e instanceof Error ? e.message : String(e)))
      } finally {
        setLoadingUser(null)
      }
    }
  }

  function toggleReport(rid: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(rid)) next.delete(rid)
      else next.add(rid)
      return next
    })
  }

  function toggleUserAll(uid: string) {
    const reports = reportsByUser.get(uid) ?? []
    const allSelected = reports.length > 0 && reports.every((r) => selected.has(r.id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const r of reports) next.delete(r.id)
      } else {
        for (const r of reports) next.add(r.id)
      }
      return next
    })
  }

  // 按 userId 把选中的 report id 分组（喂给 API）
  function buildItems(): Array<{ userId: string; reportIds: string[] }> {
    const map = new Map<string, string[]>()
    for (const r of reportsByUser.entries()) {
      const list: string[] = []
      for (const rep of r[1]) if (selected.has(rep.id)) list.push(rep.id)
      if (list.length > 0) map.set(r[0], list)
    }
    return Array.from(map.entries()).map(([userId, reportIds]) => ({ userId, reportIds }))
  }

  async function doExport() {
    const items = buildItems()
    if (items.length === 0) return
    setExporting(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/export-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(`[${res.status}] ${body.error || '导出失败'}`)
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const cd = res.headers.get('Content-Disposition') ?? ''
      const m = cd.match(/filename="([^"]+)"/)
      a.download = m?.[1] ?? 'reports.md'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      const totalReports = items.reduce((s, x) => s + x.reportIds.length, 0)
      setMsg(`已导出 ${items.length} 个用户 · ${totalReports} 个报告`)
    } catch (e) {
      setMsg('导出失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExporting(false)
    }
  }

  const selectedCount = selected.size

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Input
          placeholder="按邮箱搜索用户…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <span className="text-sm text-muted-foreground">共 {users.length} 个用户</span>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-sm text-muted-foreground">已选 {selectedCount} 个报告</span>
          <Button
            disabled={selectedCount === 0 || exporting}
            onClick={doExport}
          >
            {exporting ? '导出中…' : '导出 Markdown'}
          </Button>
          {selectedCount > 0 && (
            <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>清空</Button>
          )}
        </div>
      </div>

      {msg && (
        <div className="text-sm text-muted-foreground border rounded px-3 py-2 bg-muted/30">{msg}</div>
      )}

      <div className="border rounded-xl overflow-hidden">
        <ul className="divide-y">
          {filtered.length === 0 && (
            <li className="p-6 text-center text-sm text-muted-foreground">未找到用户</li>
          )}
          {filtered.map((u) => {
            const isOpen = expanded.has(u.id)
            const reports = reportsByUser.get(u.id)
            const userSelectedCount = (reports ?? []).filter((r) => selected.has(r.id)).length
            const allSelected = reports && reports.length > 0 && userSelectedCount === reports.length
            return (
              <li key={u.id}>
                <div className="flex items-center gap-3 p-3 hover:bg-muted/30">
                  <button
                    onClick={() => toggleUser(u.id)}
                    className="text-sm font-medium text-left flex-1 truncate"
                  >
                    {isOpen ? '▼' : '▶'} {u.email}
                  </button>
                  <Badge variant="outline">
                    {reports ? `${userSelectedCount}/${reports.length} 报告` : loadingUser === u.id ? '加载中…' : '0 报告'}
                  </Badge>
                  {reports && reports.length > 0 && (
                    <Button size="sm" variant="ghost" onClick={() => toggleUserAll(u.id)}>
                      {allSelected ? '全清该用户' : '全选该用户'}
                    </Button>
                  )}
                </div>
                {isOpen && reports && (
                  <ul className="bg-muted/10 divide-y border-t">
                    {reports.length === 0 && (
                      <li className="p-4 text-sm text-muted-foreground text-center">该用户没有报告</li>
                    )}
                    {reports.map((r) => (
                      <li key={r.id} className="p-3 flex items-center gap-3 text-sm">
                        <Checkbox
                          checked={selected.has(r.id)}
                          onCheckedChange={() => toggleReport(r.id)}
                          aria-label={`选择报告 ${r.id.slice(0, 8)}`}
                        />
                        <span className="font-mono text-xs text-muted-foreground">{r.id.slice(0, 8)}</span>
                        <span className="truncate flex-1">任务 #{r.job_id.slice(0, 8)}</span>
                        <span className="text-muted-foreground whitespace-nowrap">{r.doc_count} 文档 · {new Date(r.created_at).toLocaleDateString('zh-CN')}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}