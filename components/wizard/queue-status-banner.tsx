'use client'

import { useEffect, useState } from 'react'
import { Clock, CheckCircle2 } from 'lucide-react'

export function QueueStatusBanner() {
  const [count, setCount] = useState<number | null>(null)

  async function fetch_() {
    try {
      const res = await fetch('/api/queue-status')
      if (res.ok) setCount((await res.json()).queuedCount)
    } catch {}
  }

  useEffect(() => {
    fetch_()
    const t = setInterval(fetch_, 30_000)
    return () => clearInterval(t)
  }, [])

  if (count === null) return null

  return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-md border text-sm">
      {count === 0 ? (
        <><CheckCircle2 size={16} className="text-green-600 shrink-0" /><span className="text-green-700">队列空闲，提交后将立即开始</span></>
      ) : (
        <><Clock size={16} className="text-amber-600 shrink-0" /><span className="text-amber-700">队列中有 {count} 个任务，预计约 {count * 8} 分钟后开始</span></>
      )}
    </div>
  )
}
