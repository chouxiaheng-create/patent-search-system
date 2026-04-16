import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { AIModel } from '@/lib/supabase/types'

function isSearchCapable(m: AIModel) { return m.capabilities.deep_reasoning && m.capabilities.web_search }
function isReasoningCapable(m: AIModel) { return m.capabilities.deep_reasoning }

function disabledReason(m: AIModel, mode: 'search' | 'parse' | 'report'): string | null {
  if (mode === 'search') {
    if (!m.capabilities.deep_reasoning) return '需要深度推理能力'
    if (!m.capabilities.web_search) return '需要联网搜索能力'
  } else {
    if (!m.capabilities.deep_reasoning) return '需要深度推理能力'
  }
  return null
}

interface ModelSelectorProps {
  models: AIModel[]
  mode: 'search' | 'parse' | 'report'
  multiSelect?: boolean
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function ModelSelector({ models, mode, multiSelect = false, selectedIds, onChange }: ModelSelectorProps) {
  function toggle(id: string, disabled: boolean) {
    if (disabled) return
    onChange(multiSelect
      ? selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]
      : [id]
    )
  }

  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-2">
        {models.map((m) => {
          const capable = mode === 'search' ? isSearchCapable(m) : isReasoningCapable(m)
          const reason = disabledReason(m, mode)
          const selected = selectedIds.includes(m.id)
          const chip = (
            <button key={m.id} type="button" disabled={!capable} onClick={() => toggle(m.id, !capable)}
              className={cn('px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                selected && capable ? 'bg-blue-600 border-blue-600 text-white'
                : capable ? 'bg-white border-slate-300 text-slate-700 hover:border-blue-400'
                : 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
              )}>
              {m.name}
            </button>
          )
          if (!capable && reason) return (
            <Tooltip key={m.id}>
              <TooltipTrigger asChild>{chip}</TooltipTrigger>
              <TooltipContent><p>{reason}</p></TooltipContent>
            </Tooltip>
          )
          return chip
        })}
      </div>
    </TooltipProvider>
  )
}
