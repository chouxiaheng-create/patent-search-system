import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import type { AIModel, ModelFeatureOverride } from '@/lib/supabase/types'

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
  featureOverrides?: ModelFeatureOverride[]
  onFeatureOverridesChange?: (overrides: ModelFeatureOverride[]) => void
}

export function ModelSelector({
  models, mode, multiSelect = false, selectedIds, onChange,
  featureOverrides = [], onFeatureOverridesChange,
}: ModelSelectorProps) {
  function toggle(id: string, disabled: boolean) {
    if (disabled) return
    const newIds = multiSelect
      ? selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]
      : [id]
    onChange(newIds)

    if (multiSelect && onFeatureOverridesChange) {
      const model = models.find(m => m.id === id)
      if (!model) return
      if (!selectedIds.includes(id)) {
        onFeatureOverridesChange([...featureOverrides, {
          model_id: id,
          enable_thinking: model.adapter_config?.thinking_default_on ?? false,
          enable_web_search: model.capabilities.web_search,
        }])
      } else {
        onFeatureOverridesChange(featureOverrides.filter(o => o.model_id !== id))
      }
    }
  }

  function updateOverride(modelId: string, field: 'enable_thinking' | 'enable_web_search', value: boolean) {
    if (!onFeatureOverridesChange) return
    const model = models.find(m => m.id === modelId)
    if (!model) return
    let thinking = featureOverrides.find(o => o.model_id === modelId)?.enable_thinking ?? false
    let search = featureOverrides.find(o => o.model_id === modelId)?.enable_web_search ?? false
    if (field === 'enable_thinking') thinking = value
    if (field === 'enable_web_search') search = value
    if (model.adapter_config?.web_search_disables_thinking) {
      if (field === 'enable_web_search' && value) thinking = false
      if (field === 'enable_thinking' && value) search = false
    }
    onFeatureOverridesChange(
      featureOverrides.map(o => o.model_id === modelId ? { ...o, enable_thinking: thinking, enable_web_search: search } : o)
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
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

        {mode === 'search' && multiSelect && selectedIds.length > 0 && (
          <div className="space-y-2 pl-1">
            {selectedIds.map(id => {
              const model = models.find(m => m.id === id)
              if (!model) return null
              const override = featureOverrides.find(o => o.model_id === id)
              const canThink = model.capabilities.deep_reasoning && model.adapter_config?.thinking_method !== 'none'
              const canSearch = model.capabilities.web_search && model.adapter_config?.web_search_method !== 'none'
              const mutuallyExclusive = model.adapter_config?.web_search_disables_thinking ?? false
              return (
                <div key={id} className="flex items-center gap-6 py-1.5 px-3 bg-blue-50 rounded-md text-sm">
                  <span className="font-medium text-blue-800 w-28 shrink-0">{model.name}</span>
                  {canThink && (
                    <div className="flex items-center gap-1.5">
                      <Switch id={`think-${id}`}
                        checked={override?.enable_thinking ?? (model.adapter_config?.thinking_default_on ?? false)}
                        onCheckedChange={v => updateOverride(id, 'enable_thinking', v)} />
                      <Label htmlFor={`think-${id}`} className="text-xs text-slate-600 cursor-pointer">深度思考</Label>
                    </div>
                  )}
                  {canSearch && (
                    <div className="flex items-center gap-1.5">
                      <Switch id={`search-${id}`}
                        checked={override?.enable_web_search ?? true}
                        onCheckedChange={v => updateOverride(id, 'enable_web_search', v)} />
                      <Label htmlFor={`search-${id}`} className="text-xs text-slate-600 cursor-pointer">联网搜索</Label>
                    </div>
                  )}
                  {mutuallyExclusive && override?.enable_thinking && override?.enable_web_search && (
                    <span className="text-xs text-amber-600">注意：该模型不支持同时开启两项</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
