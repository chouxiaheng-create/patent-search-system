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
    <div className="border border-border rounded-xl overflow-hidden transition-all duration-200">
      <button type="button" onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">
        <span>{label}</span>
        {expanded ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
      </button>
      {expanded && (
        <div className="border-t border-border p-3">
          <Textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} rows={5} className="text-sm resize-none" />
        </div>
      )}
    </div>
  )
}
