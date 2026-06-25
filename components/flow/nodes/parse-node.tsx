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
  pending: { color: 'text-muted-foreground', bg: 'bg-muted', border: 'border-border', icon: Clock, label: '等待中' },
  parsing: { color: 'text-primary', bg: 'bg-primary/5', border: 'border-primary/30', icon: Loader2, label: '解析中', animate: true },
  done: { color: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: Check, label: '已完成' },
  needs_review: { color: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200', icon: AlertCircle, label: '需人工审查' },
  failed: { color: 'text-red-600', bg: 'bg-red-50', border: 'border-red-200', icon: AlertCircle, label: '解析失败' },
}

export const ParseNode = memo(function ParseNode({ data }: Node<ParseNodeData>) {
  const config = statusConfig[data.status] || statusConfig.pending
  const Icon = config.icon

  return (
    <div className={cn(
      'min-w-[180px] rounded-xl border-2 p-3 shadow-sm transition-all',
      config.bg,
      config.border
    )}>
      <Handle type="source" position={Position.Right} className="w-2 h-2" />

      <div className="flex items-start gap-2">
        <div className={cn('mt-0.5', config.color)}>
          <Icon size={18} className={cn(config.animate && 'animate-spin')} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">文献解析</div>
          <div className="text-xs text-muted-foreground truncate mt-0.5">{data.title}</div>
          <div className={cn('text-xs mt-1 font-medium', config.color)}>{config.label}</div>
        </div>
      </div>
    </div>
  )
})
