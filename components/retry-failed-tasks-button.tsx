'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

interface RetryFailedTasksButtonProps {
  jobId: string
}

// 部分重试：仅重跑失败/未完成的子任务，保留已成功子任务结果，完成后重新生成报告
export function RetryFailedTasksButton({ jobId }: RetryFailedTasksButtonProps) {
  const [retrying, setRetrying] = useState(false)

  async function handleRetry() {
    if (!confirm('仅重跑失败的子任务，已成功的结果会保留。确定继续？')) return
    setRetrying(true)
    try {
      const res = await fetch(`/api/jobs/${jobId}/retry-tasks`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || '重试失败')
      }
      toast.success('已重新提交失败子任务')
      window.location.reload()
    } catch (err) {
      toast.error('重试失败', { description: err instanceof Error ? err.message : '请重试' })
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
      <RefreshCw size={14} className="mr-1" />
      {retrying ? '提交中...' : '重试失败项'}
    </Button>
  )
}
