// components/flow/nodes/search-task-node.tsx
'use client'

import { memo } from 'react'
import { Handle, Position, type Node } from '@xyflow/react'
import { Search, Check, X, RotateCw, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

interface SearchTaskNodeData extends Record<string, unknown> {
  platformName: string
  strategyName: string
  status: 'pending' | 'running' | 'retrying' | 'done' | 'abandoned'
  resultCount?: number
  startedAt?: string | null
  completedAt?: string | null
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
  pending: { color: 'text-muted-foreground', bg: 'bg-muted', border: 'border-border', icon: Search, label: '等待中' },
  running: { color: 'text-primary', bg: 'bg-primary/5', border: 'border-primary/30', icon: Loader2, label: '检索中' },
  retrying: { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', icon: RotateCw, label: '重试中' },
  done: { color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: Check, label: '已完成' },
  abandoned: { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', icon: X, label: '已放弃' },
}

export const SearchTaskNode = memo(function SearchTaskNode({ data }: Node<SearchTaskNodeData>) {
  const config = statusConfig[data.status] || statusConfig.pending
  const Icon = config.icon

  return (
    <div className={cn(
      'min-w-[160px] rounded-xl border-2 p-3 shadow-sm transition-all',
      config.bg,
      config.border
    )}>
      <Handle type="target" position={Position.Left} className="w-2 h-2" />
      <Handle type="source" position={Position.Right} className="w-2 h-2" />

      <div className="flex items-start gap-2">
        <div className={cn('mt-0.5', config.color)}>
          <Icon size={16} className={cn((data.status === 'running' || data.status === 'retrying') && 'animate-spin')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-medium text-foreground">
            {data.platformName}
          </div>
          <div className="text-xs text-muted-foreground">
            × {data.strategyName}
          </div>
          <div className={cn('text-xs mt-1 font-medium', config.color)}>
            {config.label}
            {data.status === 'done' && data.resultCount !== undefined && (
              <span className="ml-1">({data.resultCount}篇)</span>
            )}
          </div>
          {(data.status === 'done' && data.startedAt && data.completedAt) && (
            <div className="text-xs text-muted-foreground mt-0.5">
              {formatDuration(new Date(data.completedAt).getTime() - new Date(data.startedAt).getTime())}
            </div>
          )}
          {(data.status === 'running' && data.startedAt) && (
            <div className="text-xs text-primary mt-0.5 animate-pulse">
              {formatDuration(Date.now() - new Date(data.startedAt).getTime())}
            </div>
          )}
        </div>
      </div>
    </div>
  )
})
