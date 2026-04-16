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
      <div className="flex rounded-md border border-slate-200 overflow-hidden w-fit">
        <button type="button" onClick={setImmediate_}
          className={cn('px-4 py-2 text-sm font-medium transition-colors', mode === 'immediate' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
          立即提交
        </button>
        <button type="button" onClick={() => setMode('scheduled')}
          className={cn('px-4 py-2 text-sm font-medium border-l border-slate-200 transition-colors', mode === 'scheduled' ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50')}>
          定时执行
        </button>
      </div>
      {mode === 'scheduled' && (
        <input type="datetime-local" min={minDateTime} value={scheduledAt ?? ''}
          onChange={e => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
          className="block border border-slate-300 rounded-md px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500" />
      )}
    </div>
  )
}
