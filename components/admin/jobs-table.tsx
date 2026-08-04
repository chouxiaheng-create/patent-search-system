'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw, RotateCcw, XCircle, Eye, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type TaskCounts = { total: number; done: number; running: number; pending: number; failed: number; abandoned: number }
type JobRow = {
  id: string; status: string; retry_count: number
  created_at: string | null; started_at: string | null; completed_at: string | null; scheduled_at: string | null
  user_email: string; document_title: string
  task_counts: TaskCounts; progress_percent: number
}

const STATUS_OPTIONS = [
  { value: 'all', label: '全部状态' },
  { value: 'queued', label: '排队中' },
  { value: 'running', label: '执行中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
]

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'secondary',
  running: 'default',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'outline',
}

const statusLabel: Record<string, string> = {
  queued: '排队中', running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消',
}

export function JobsTable() {
  const router = useRouter()
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ type: 'cancel' | 'retry'; job: JobRow } | null>(null)
  const [acting, setActing] = useState(false)

  const fetchJobs = useCallback(async () => {
    const params = new URLSearchParams()
    if (status && status !== 'all') params.set('status', status)
    if (email.trim()) params.set('email', email.trim())
    try {
      const res = await fetch(`/api/admin/jobs?${params.toString()}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '加载失败')
      const body = await res.json()
      setJobs(body.jobs ?? [])
      setTotal(body.total ?? 0)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [status, email])

  useEffect(() => { fetchJobs() }, [fetchJobs])
  useEffect(() => {
    const t = setInterval(fetchJobs, 30_000) // 30s 自动刷新
    return () => clearInterval(t)
  }, [fetchJobs])

  async function handleConfirm() {
    if (!confirm) return
    setActing(true)
    try {
      const res = await fetch(`/api/admin/jobs/${confirm.job.id}/${confirm.type}`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? '操作失败')
      toast.success(confirm.type === 'cancel' ? '任务已取消' : '任务已重新入队')
      setConfirm(null)
      fetchJobs()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setActing(false)
    }
  }

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div className="mt-6 space-y-4">
      {/* 筛选工具栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-40"><SelectValue placeholder="全部状态" /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Input
          placeholder="按用户邮箱搜索"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') fetchJobs() }}
          className="w-56"
        />
        <Button variant="outline" size="sm" onClick={fetchJobs} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          刷新
        </Button>
        <span className="text-xs text-muted-foreground">共 {total} 个任务（每 30s 自动刷新）</span>
      </div>

      {error && <div className="text-sm text-red-600">加载失败：{error}</div>}

      <div className="rounded-2xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>任务</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>文档</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>进度</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 && !loading && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">暂无任务</TableCell></TableRow>
            )}
            {jobs.map(j => (
              <TableRow key={j.id}>
                <TableCell className="font-mono text-xs">{j.id.slice(0, 8)}</TableCell>
                <TableCell>{j.user_email}</TableCell>
                <TableCell className="max-w-[220px] truncate">{j.document_title || '—'}</TableCell>
                <TableCell><Badge variant={statusVariant[j.status]}>{statusLabel[j.status]}</Badge></TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${j.progress_percent}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {j.task_counts.done}/{j.task_counts.total} ({j.progress_percent}%)
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmt(j.created_at)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <div className="flex justify-end gap-1.5">
                    {(j.status === 'queued' || j.status === 'running') && (
                      <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setConfirm({ type: 'cancel', job: j })}>
                        <XCircle size={14} /> 取消
                      </Button>
                    )}
                    {(j.status === 'failed' || j.status === 'completed') && (
                      <Button variant="ghost" size="sm" onClick={() => setConfirm({ type: 'retry', job: j })}>
                        <RotateCcw size={14} /> 重跑
                      </Button>
                    )}
                    {j.status === 'completed' && (
                      <Button variant="ghost" size="sm" onClick={() => router.push(`/admin/reports/${j.id}`)}>
                        <Eye size={14} /> 报告
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* 二次确认对话框 */}
      <Dialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.type === 'cancel' ? '确认取消该任务？' : '确认重跑该任务？'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirm?.type === 'cancel'
              ? `任务 ${confirm?.job.id.slice(0, 8)}（${confirm?.job.user_email}）将被立即取消，正在执行的子任务会在批次边界停止。`
              : `任务 ${confirm?.job.id.slice(0, 8)}（${confirm?.job.user_email}）将重新入队执行${confirm?.job.status === 'completed' ? '，仅重跑未完成的子任务' : ''}。`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={acting}>取消</Button>
            <Button
              variant={confirm?.type === 'cancel' ? 'destructive' : 'default'}
              onClick={handleConfirm}
              disabled={acting}
            >
              {acting && <Loader2 size={14} className="animate-spin mr-1" />}
              确认{confirm?.type === 'cancel' ? '取消' : '重跑'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
