'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import type { AIModel } from '@/lib/supabase/types'

interface ModelFormDialogProps {
  model: AIModel | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onSave: (data: ModelFormData) => Promise<void>
}

export interface ModelFormData {
  name: string
  api_base_url: string
  model_id: string
  api_key: string
  usage_types: string[]
  capabilities: { deep_reasoning: boolean; web_search: boolean }
}

const USAGE_OPTIONS = [
  { value: 'search', label: '检索平台' },
  { value: 'parse', label: '文献解析' },
  { value: 'report', label: '报告汇总' },
]

export function ModelFormDialog({ model, open, onOpenChange, onSave }: ModelFormDialogProps) {
  const isNew = model === null
  const isBuiltin = model?.is_builtin ?? false

  const [name, setName] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [usageTypes, setUsageTypes] = useState<string[]>([])
  const [deepReasoning, setDeepReasoning] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (model) {
      setName(model.name)
      setApiBaseUrl(model.api_base_url)
      setModelId(model.model_id)
      setApiKey('')
      setUsageTypes(model.usage_types)
      setDeepReasoning(model.capabilities.deep_reasoning)
      setWebSearch(model.capabilities.web_search)
    } else {
      setName(''); setApiBaseUrl(''); setModelId(''); setApiKey('')
      setUsageTypes([]); setDeepReasoning(false); setWebSearch(false)
    }
  }, [model, open])

  function toggleUsageType(value: string) {
    setUsageTypes(prev =>
      prev.includes(value) ? prev.filter(t => t !== value) : [...prev, value]
    )
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({ name, api_base_url: apiBaseUrl, model_id: modelId, api_key: apiKey, usage_types: usageTypes, capabilities: { deep_reasoning: deepReasoning, web_search: webSearch } })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const canSave = isBuiltin
    ? apiKey.trim().length > 0
    : name.trim() && apiBaseUrl.trim() && modelId.trim() && apiKey.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {isNew ? '添加自定义模型' : isBuiltin ? `配置 API Key — ${model.name}` : `编辑模型 — ${model.name}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {!isBuiltin && (
            <>
              <div className="space-y-1">
                <Label htmlFor="m-name">模型名称</Label>
                <Input id="m-name" value={name} onChange={e => setName(e.target.value)} placeholder="如：我的GPT-4o" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="m-base-url">API Base URL</Label>
                <Input id="m-base-url" value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="m-model-id">模型 ID</Label>
                <Input id="m-model-id" value={modelId} onChange={e => setModelId(e.target.value)} placeholder="gpt-4o" />
              </div>
            </>
          )}

          <div className="space-y-1">
            <Label htmlFor="m-api-key">
              API Key {model?.api_key_encrypted ? <span className="text-xs text-green-600 ml-1">（已有配置，留空则保持不变）</span> : <span className="text-xs text-red-500 ml-1">（必填）</span>}
            </Label>
            <Input id="m-api-key" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." autoComplete="off" />
          </div>

          {!isBuiltin && (
            <>
              <div className="space-y-2">
                <Label>用途（可多选）</Label>
                <div className="flex gap-4">
                  {USAGE_OPTIONS.map(opt => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <Checkbox id={`usage-${opt.value}`} checked={usageTypes.includes(opt.value)} onCheckedChange={() => toggleUsageType(opt.value)} />
                      <Label htmlFor={`usage-${opt.value}`} className="text-sm cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>支持的能力</Label>
                <div className="flex gap-6">
                  <div className="flex items-center gap-2">
                    <Switch id="cap-thinking" checked={deepReasoning} onCheckedChange={setDeepReasoning} />
                    <Label htmlFor="cap-thinking" className="text-sm cursor-pointer">深度思考</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="cap-search" checked={webSearch} onCheckedChange={setWebSearch} />
                    <Label htmlFor="cap-search" className="text-sm cursor-pointer">联网搜索</Label>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
