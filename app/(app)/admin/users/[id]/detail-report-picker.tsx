// app/(app)/admin/users/[id]/detail-report-picker.tsx
// 详情页报告 section 的客户端壳：维护跨页勾选 + 顶部"导出选中 (N)"
// 翻页时通过 URL 跳转（受控于父组件 SectionPagination），本组件只管勾选 + 导出触发

'use client'

import { useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import Link from 'next/link'

type PageReport = { id: string; job_id: string; created_at: string }

export function DetailReportPicker({
  userId, pageReports,
}: {
  userId: string
  pageReports: PageReport[]
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [exporting, setExporting] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)

  function toggle(rid: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(rid)) next.delete(rid)
      else next.add(rid)
      return next
    })
  }

  function togglePageAll() {
    const allSelected = pageReports.length > 0 && pageReports.every((r) => selected.has(r.id))
    setSelected((prev) => {
      const next = new Set(prev)
      if (allSelected) {
        for (const r of pageReports) next.delete(r.id)
      } else {
        for (const r of pageReports) next.add(r.id)
      }
      return next
    })
  }

  async function exportSelected() {
    if (selected.size === 0) return
    setExporting(true)
    setMsg(null)
    try {
      const res = await fetch('/api/admin/export-reports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [{ userId, reportIds: Array.from(selected) }] }),
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
      setMsg(`已导出 ${selected.size} 个报告`)
    } catch (e) {
      setMsg('导出失败：' + (e instanceof Error ? e.message : String(e)))
    } finally {
      setExporting(false)
    }
  }

  const pageAllSelected = pageReports.length > 0 && pageReports.every((r) => selected.has(r.id))
  const pageSomeSelected = pageReports.some((r) => selected.has(r.id))

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap">
        <button
          type="button"
          onClick={togglePageAll}
          className="text-sm text-muted-foreground hover:underline"
        >
          {pageAllSelected ? '取消全选本页' : '全选本页'}
        </button>
        <span className="text-sm text-muted-foreground">跨页累计已选 {selected.size} 个</span>
        <button
          type="button"
          onClick={exportSelected}
          disabled={selected.size === 0 || exporting}
          className="ml-auto px-3 py-1 text-sm border rounded hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {exporting ? '导出中…' : `导出选中 (${selected.size})`}
        </button>
        {selected.size > 0 && (
          <button
            type="button"
            onClick={() => setSelected(new Set())}
            className="text-sm text-muted-foreground hover:underline"
          >
            清空
          </button>
        )}
      </div>

      {msg && (
        <div className="text-sm text-muted-foreground border rounded px-3 py-2 bg-muted/30">{msg}</div>
      )}

      <ul className="divide-y border rounded-lg">
        {pageReports.length === 0 && (
          <li className="p-4 text-sm text-muted-foreground text-center">该用户没有报告</li>
        )}
        {pageReports.map((r) => (
          <li key={r.id} className="p-3 flex items-center gap-3 text-sm">
            <Checkbox
              checked={selected.has(r.id)}
              onCheckedChange={() => toggle(r.id)}
              aria-label={`选择报告 ${r.id.slice(0, 8)}`}
            />
            <Link href={`/admin/reports/${r.job_id}`} className="hover:underline truncate flex-1">
              报告 #{r.id.slice(0, 8)}
            </Link>
            <span className="text-muted-foreground whitespace-nowrap">
              {new Date(r.created_at).toLocaleDateString('zh-CN')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}