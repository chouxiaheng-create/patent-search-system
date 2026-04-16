'use client'

import { memo } from 'react'
import { type Node } from '@xyflow/react'
import { Clock } from 'lucide-react'

interface PlaceholderNodeData extends Record<string, unknown> {
  queuePosition: number
  estimatedWaitMinutes: number
}

export const PlaceholderNode = memo(function PlaceholderNode({ data }: Node<PlaceholderNodeData>) {
  return (
    <div className="min-w-[200px] rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-4 text-center">
      <Clock size={24} className="mx-auto text-slate-400 mb-2" />
      <div className="text-sm font-medium text-slate-600">等待队列中</div>
      <div className="text-2xl font-bold text-slate-500 mt-2">
        第 {data.queuePosition} 位
      </div>
      <div className="text-xs text-slate-400 mt-1">
        预计等待约 {data.estimatedWaitMinutes} 分钟
      </div>
    </div>
  )
})
