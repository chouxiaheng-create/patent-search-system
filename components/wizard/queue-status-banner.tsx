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
    <div className="flex items-center gap-2.5 px-4 py-3 rounded-2xl border border-white/[0.08] bg-white text-sm">
      {count === 0 ? (
        <><CheckCircle2 size={16} className="text-emerald-600 shrink-0" strokeWidth={2} /><span className="text-foreground font-medium">队列空闲，提交后将立即开始</span></>
      ) : (
        <><Clock size={16} className="text-amber-600 shrink-0" strokeWidth={2} /><span className="text-foreground font-medium">队列中有 {count} 个任务，预计约 {count * 8} 分钟后开始</span></>
      )}
    </div>
  )
}
