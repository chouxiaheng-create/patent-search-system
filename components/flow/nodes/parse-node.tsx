// components/flow/nodes/parse-node.tsx
'use client'

import { memo } from 'react'
import { Handle, Position, type Node } from '@xyflow/react'
import { Check, Loader2, Clock, AlertCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

interface ParseNodeData extends Record<string, unknown> {
  title: string
  status: 'pending' | 'parsing' | 'done' | 'needs_review' | 'failed'
}

const statusConfig: Record<string, { color: string; bg: string; border: string; icon: typeof Clock; label: string; animate?: boolean }> = {
  pending: { color: 'text-slate-400', bg: 'bg-slate-100', border: 'border-slate-200', icon: Clock, label: '等待中' },
  parsing: { color: 'text-blue-500', bg: 'bg-blue-50', border: 'border-blue-300', icon: Loader2, label: '解析中', animate: true },
  done: { color: 'text-green-500', bg: 'bg-green-50', border: 'border-green-300', icon: Check, label: '已完成' },
  needs_review: { color: 'text-amber-500', bg: 'bg-amber-50', border: 'border-amber-300', icon: AlertCircle, label: '需人工审查' },
  failed: { color: 'text-red-500', bg: 'bg-red-50', border: 'border-red-300', icon: AlertCircle, label: '解析失败' },
}

export const ParseNode = memo(function ParseNode({ data }: Node<ParseNodeData>) {
  const config = statusConfig[data.status] || statusConfig.pending
  const Icon = config.icon

  return (
    <div className={cn(
      'min-w-[180px] rounded-lg border-2 p-3 shadow-sm transition-all',
      config.bg,
      config.border
    )}>
      <Handle type="source" position={Position.Right} className="w-2 h-2" />

      <div className="flex items-start gap-2">
        <div className={cn('mt-0.5', config.color)}>
          <Icon size={18} className={cn(config.animate && 'animate-spin')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-slate-700">文献解析</div>
          <div className="text-xs text-slate-500 truncate mt-0.5">{data.title}</div>
          <div className={cn('text-xs mt-1', config.color)}>{config.label}</div>
        </div>
      </div>
    </div>
  )
})
