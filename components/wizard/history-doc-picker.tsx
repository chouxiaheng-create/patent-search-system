import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { PatentDocument } from '@/lib/supabase/types'

interface HistoryDocPickerProps {
  documents: PatentDocument[]; onSelect: (id: string) => void; disabled?: boolean
}

export function HistoryDocPicker({ documents, onSelect, disabled }: HistoryDocPickerProps) {
  if (documents.length === 0) return null
  return (
    <div>
      <p className="text-sm text-slate-500 text-center my-3">— 或从历史文献复用 —</p>
      <Select onValueChange={onSelect} disabled={disabled}>
        <SelectTrigger className="w-full"><SelectValue placeholder="选择历史文献..." /></SelectTrigger>
        <SelectContent>
          {documents.map(doc => (
            <SelectItem key={doc.id} value={doc.id}>
              <span className="truncate">{doc.title}</span>
              <span className="ml-2 text-xs text-slate-400">{new Date(doc.created_at).toLocaleDateString('zh-CN')}</span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
