'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Textarea } from '@/components/ui/textarea'

interface PromptEditorProps {
  label?: string; value: string; onChange: (v: string) => void
  defaultExpanded?: boolean; placeholder?: string
}

export function PromptEditor({ label = '编辑提示词', value, onChange, defaultExpanded = false, placeholder = '输入系统提示词...' }: PromptEditorProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)
  return (
    <div className="border border-slate-200 rounded-md overflow-hidden">
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors">
        <span className="font-medium">{label}</span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded && (
        <div className="border-t border-slate-200 p-3">
          <Textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={5} className="text-sm resize-none" />
        </div>
      )}
    </div>
  )
}
