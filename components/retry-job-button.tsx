'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { RotateCw } from 'lucide-react'
import { toast } from 'sonner'

interface RetryJobButtonProps {
  jobId: string
}

// 全量重试：新建一条 job 重新执行（保留原失败记录作审计）
export function RetryJobButton({ jobId }: RetryJobButtonProps) {
  const [retrying, setRetrying] = useState(false)

  async function handleRetry() {
    if (!confirm('将新建一条任务并重新执行全部检索，原失败记录会保留。确定继续？')) return
    setRetrying(true)
    try {
      const res = await fetch('/api/jobs/retry', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error || '重试失败')
      }
      toast.success('已创建新的重试任务')
      window.location.reload()
    } catch (err) {
      toast.error('重试失败', { description: err instanceof Error ? err.message : '请重试' })
    } finally {
      setRetrying(false)
    }
  }

  return (
    <Button variant="outline" size="sm" onClick={handleRetry} disabled={retrying}>
      <RotateCw size={14} className="mr-1" />
      {retrying ? '提交中...' : '重试'}
    </Button>
  )
}
