'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface ScheduleToggleProps {
  scheduledAt: string | null; onChange: (v: string | null) => void
}

export function ScheduleToggle({ scheduledAt, onChange }: ScheduleToggleProps) {
  const [mode, setMode] = useState<'immediate' | 'scheduled'>(scheduledAt ? 'scheduled' : 'immediate')

  function setImmediate_() { setMode('immediate'); onChange(null) }

  const minDateTime = new Date(Date.now() + 5 * 60 * 1000).toISOString().slice(0, 16)

  return (
    <div className="space-y-3">
      <div className="flex rounded-lg bg-muted p-0.5 w-fit">
        <button type="button" onClick={setImmediate_}
          className={cn('px-5 py-2 text-sm font-medium rounded-md transition-all duration-200',
            mode === 'immediate' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          立即提交
        </button>
        <button type="button" onClick={() => setMode('scheduled')}
          className={cn('px-5 py-2 text-sm font-medium rounded-md transition-all duration-200',
            mode === 'scheduled' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground')}>
          定时执行
        </button>
      </div>
      {mode === 'scheduled' && (
        <input type="datetime-local" min={minDateTime} value={scheduledAt ?? ''}
          onChange={e => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
          className="block border border-border rounded-xl px-3.5 py-2 text-sm text-foreground bg-muted focus:outline-none focus:ring-2 focus:ring-primary/40 focus:border-primary focus:bg-white transition-all duration-200" />
      )}
    </div>
  )
}
