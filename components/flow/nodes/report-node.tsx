// components/flow/nodes/report-node.tsx
'use client'

import { memo } from 'react'
import { Handle, Position, type Node } from '@xyflow/react'
import { BarChart3, Check, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

interface ReportNodeData extends Record<string, unknown> {
  status: 'waiting' | 'generating' | 'done'
  jobId: string
  docCount?: number
}

export const ReportNode = memo(function ReportNode({ data }: Node<ReportNodeData>) {
  const isDone = data.status === 'done'
  const isGenerating = data.status === 'generating'

  return (
    <div className={cn(
      'min-w-[160px] rounded-xl border-2 p-3 shadow-sm transition-all',
      isDone ? 'bg-emerald-50 border-emerald-200' : 'bg-muted border-border'
    )}>
      <Handle type="target" position={Position.Left} className="w-2 h-2" />

      <div className="flex items-start gap-2">
        <div className={cn('mt-0.5', isDone ? 'text-emerald-600' : 'text-muted-foreground')}>
          {isGenerating ? <Loader2 size={16} className="animate-spin text-primary" /> : <BarChart3 size={16} />}
        </div>
        <div className="flex-1">
          <div className="text-sm font-medium text-foreground">生成报告</div>
          <div className={cn('text-xs mt-1 font-medium', isDone ? 'text-emerald-600' : 'text-muted-foreground')}>
            {isDone ? '报告已生成' : isGenerating ? '正在生成...' : '等待中'}
          </div>
          {isDone && data.docCount !== undefined && (
            <div className="text-xs text-muted-foreground mt-0.5">共 {data.docCount} 篇文献</div>
          )}
        </div>
      </div>

      {isDone && (
        <Link href={`/search/${data.jobId}/report`} className="block mt-2">
          <Button size="sm" variant="outline" className="w-full text-xs h-7 rounded-lg">
            查看报告
          </Button>
        </Link>
      )}
    </div>
  )
})
