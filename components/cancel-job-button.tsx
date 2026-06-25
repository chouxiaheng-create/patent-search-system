'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { XCircle } from 'lucide-react'
import { toast } from 'sonner'

interface CancelJobButtonProps {
  jobId: string
}

export function CancelJobButton({ jobId }: CancelJobButtonProps) {
  const [cancelling, setCancelling] = useState(false)

  async function handleCancel() {
    if (!confirm('确定要取消此任务吗？')) return
    setCancelling(true)
    try {
      const res = await fetch('/api/jobs', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId, status: 'cancelled' }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '取消失败')
      }
      toast.success('任务已取消')
      window.location.reload()
    } catch (err) {
      toast.error('取消失败', { description: err instanceof Error ? err.message : '请重试' })
    } finally {
      setCancelling(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleCancel} disabled={cancelling}>
      <XCircle size={14} className="mr-1" />
      {cancelling ? '取消中...' : '取消任务'}
    </Button>
  )
}
