// components/flow/queue-banner.tsx
'use client'

import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface QueueBannerProps {
  queuePosition: number
  estimatedWaitMinutes: number
  onCancel: () => void
  cancelling?: boolean
}

export function QueueBanner({
  queuePosition,
  estimatedWaitMinutes,
  onCancel,
  cancelling = false
}: QueueBannerProps) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Clock size={20} className="text-amber-500" />
          <div>
            <div className="text-sm font-medium text-amber-800">
              当前在队列中第 {queuePosition} 位
            </div>
            <div className="text-xs text-amber-600">
              预计等待约 {estimatedWaitMinutes} 分钟
            </div>
          </div>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={onCancel}
          disabled={cancelling}
          className="text-amber-700 border-amber-300 hover:bg-amber-100"
        >
          {cancelling ? '取消中...' : '取消任务'}
        </Button>
      </div>
    </div>
  )
}
