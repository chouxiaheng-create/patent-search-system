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
}

const statusConfig = {
  pending: { color: 'text-slate-400', bg: 'bg-slate-50', border: 'border-slate-200', icon: Search, label: '等待中' },
  running: { color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-300', icon: Loader2, label: '检索中' },
  retrying: { color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-300', icon: RotateCw, label: '重试中' },
  done: { color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-300', icon: Check, label: '已完成' },
  abandoned: { color: 'text-red-400', bg: 'bg-red-50', border: 'border-red-300', icon: X, label: '已放弃' },
}

export const SearchTaskNode = memo(function SearchTaskNode({ data }: Node<SearchTaskNodeData>) {
  const config = statusConfig[data.status] || statusConfig.pending
  const Icon = config.icon

  return (
    <div className={cn(
      'min-w-[160px] rounded-lg border-2 p-3 shadow-sm transition-all',
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
          <div className="text-xs font-medium text-slate-600">
            {data.platformName}
          </div>
          <div className="text-xs text-slate-400">
            × {data.strategyName}
          </div>
          <div className={cn('text-xs mt-1', config.color)}>
            {config.label}
            {data.status === 'done' && data.resultCount !== undefined && (
              <span className="ml-1">({data.resultCount}篇)</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
})
