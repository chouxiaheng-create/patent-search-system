// components/flow/job-sidebar.tsx
'use client'

import type { JobStatus } from '@/lib/supabase/types'
import { Calendar, Clock, CheckCircle, XCircle, FileText } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface JobSidebarProps {
  jobId: string
  status: JobStatus
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  docCount?: number
  onCancel: () => void
  cancelling?: boolean
}

function formatDuration(ms: number): string {
  if (ms < 0) return ""
  if (ms < 1000) return Math.round(ms) + "ms"
  if (ms < 60000) return (ms / 1000).toFixed(1) + "s"
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.floor((ms % 60000) / 1000)
  return minutes + "m " + seconds + "s"
}

const statusConfig = {
  queued: { label: '排队中', color: 'text-amber-600', bg: 'bg-amber-50' },
  running: { label: '执行中', color: 'text-primary', bg: 'bg-primary/[0.06]' },
  completed: { label: '已完成', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  failed: { label: '失败', color: 'text-red-600', bg: 'bg-red-50' },
  cancelled: { label: '已取消', color: 'text-muted-foreground', bg: 'bg-muted' },
}

export function JobSidebar({
  jobId,
  status,
  startedAt,
  completedAt,
  createdAt,
  docCount,
  onCancel,
  cancelling = false
}: JobSidebarProps) {
  const config = statusConfig[status] || statusConfig.queued
  const canCancel = status === 'queued' || status === 'running'

  return (
    <div className="w-72 bg-white border-l border-white/[0.08] p-4">
      <h3 className="text-sm font-semibold text-foreground mb-4">任务详情</h3>

      <div className="space-y-4">
        {/* 状态 */}
        <div className={cn('rounded-xl p-3', config.bg)}>
          <div className="text-xs text-muted-foreground mb-1">状态</div>
          <div className={cn('text-sm font-medium', config.color)}>
            {config.label}
          </div>
        </div>

        {/* 创建时间 */}
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
            <Calendar size={12} />
            <span>创建时间</span>
          </div>
          <div className="text-sm text-foreground">
            {new Date(createdAt).toLocaleString('zh-CN')}
          </div>
        </div>

        {/* 开始时间 */}
        {startedAt && (
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock size={12} />
              <span>开始时间</span>
            </div>
            <div className="text-sm text-foreground">
              {new Date(startedAt).toLocaleString('zh-CN')}
            </div>
          </div>
        )}

        {/* 总耗时 */}
        {(startedAt || completedAt) && (
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <Clock size={12} />
              <span>总耗时</span>
            </div>
            <div className="text-sm font-medium text-foreground">
              {formatDuration(
                (completedAt ? new Date(completedAt).getTime() : Date.now()) -
                (startedAt ? new Date(startedAt).getTime() : 0)
              )}
            </div>
          </div>
        )}

        {/* 完成时间 */}
        {completedAt && (
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              {status === 'completed' ? (
                <CheckCircle size={12} className="text-emerald-600" />
              ) : (
                <XCircle size={12} className="text-red-600" />
              )}
              <span>{status === 'completed' ? '完成时间' : '失败时间'}</span>
            </div>
            <div className="text-sm text-foreground">
              {new Date(completedAt).toLocaleString('zh-CN')}
            </div>
          </div>
        )}

        {/* 文献数量 */}
        {status === 'completed' && docCount !== undefined && (
          <div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1">
              <FileText size={12} />
              <span>对比文献</span>
            </div>
            <div className="text-sm text-foreground">{docCount} 篇</div>
          </div>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="mt-6 space-y-2">
        {canCancel && (
          <Button
            variant="outline"
            className="w-full text-red-600 border-destructive/20 hover:bg-red-50 rounded-xl"
            onClick={onCancel}
            disabled={cancelling}
          >
            {cancelling ? '取消中...' : '取消任务'}
          </Button>
        )}

        {status === 'completed' && (
          <Link href={`/search/${jobId}/report`}>
            <Button className="w-full rounded-xl">查看报告</Button>
          </Link>
        )}

        <Link href="/dashboard">
          <Button variant="ghost" className="w-full rounded-xl">返回列表</Button>
        </Link>
      </div>
    </div>
  )
}
