'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { AIModel, AdapterConfig } from '@/lib/supabase/types'

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
  adapter_config: AdapterConfig
}

const USAGE_OPTIONS = [
  { value: 'search', label: '检索平台' },
  { value: 'parse', label: '文献解析' },
  { value: 'report', label: '报告汇总' },
]

const PROVIDER_OPTIONS = [
  { value: 'openai_compat', label: 'OpenAI 兼容' },
  { value: 'metaso', label: '秘塔AI' },
]

const WEB_SEARCH_METHODS = [
  { value: 'none', label: '不支持' },
  { value: 'native', label: '原生支持（无需参数）' },
  { value: 'tools_builtin', label: '内置工具函数' },
  { value: 'tools_web_search', label: 'web_search 工具类型' },
  { value: 'extra_body', label: 'extra_body 参数' },
]

const THINKING_METHODS = [
  { value: 'none', label: '不支持' },
  { value: 'param', label: 'thinking 参数' },
  { value: 'model_switch', label: '切换模型 ID' },
  { value: 'extra_body', label: 'extra_body 参数' },
  { value: 'default_on', label: '默认开启' },
]

const DEFAULT_ADAPTER_CONFIG: AdapterConfig = {
  provider: 'openai_compat',
  web_search_method: 'none',
  thinking_method: 'none',
  web_search_disables_thinking: false,
  thinking_default_on: false,
}

export function ModelFormDialog({ model, open, onOpenChange, onSave }: ModelFormDialogProps) {
  const isNew = model === null

  const [name, setName] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [usageTypes, setUsageTypes] = useState<string[]>([])
  const [deepReasoning, setDeepReasoning] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [adapterConfig, setAdapterConfig] = useState<AdapterConfig>(DEFAULT_ADAPTER_CONFIG)
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
      setAdapterConfig(model.adapter_config ?? DEFAULT_ADAPTER_CONFIG)
    } else {
      setName(''); setApiBaseUrl(''); setModelId(''); setApiKey('')
      setUsageTypes([]); setDeepReasoning(false); setWebSearch(false)
      setAdapterConfig(DEFAULT_ADAPTER_CONFIG)
    }
  }, [model, open])

  function toggleUsageType(value: string) {
    setUsageTypes(prev =>
      prev.includes(value) ? prev.filter(t => t !== value) : [...prev, value]
    )
  }

  function updateAdapterConfig(patch: Partial<AdapterConfig>) {
    setAdapterConfig(prev => ({ ...prev, ...patch }))
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({
        name, api_base_url: apiBaseUrl, model_id: modelId, api_key: apiKey,
        usage_types: usageTypes,
        capabilities: { deep_reasoning: deepReasoning, web_search: webSearch },
        adapter_config: adapterConfig,
      })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  // 验证：新建时必填所有字段；编辑时 API Key 已有配置则可留空
  const hasExistingKey = !!model?.api_key_encrypted
  const canSave = name.trim() && apiBaseUrl.trim() && modelId.trim() && (apiKey.trim() || (hasExistingKey && !isNew))

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[540px] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {isNew ? '添加自定义模型' : `编辑模型 — ${model.name}`}
          </DialogTitle>
        </DialogHeader>
          <DialogDescription className="text-xs text-muted-foreground">
            配置 AI 模型的连接参数与特性开关
          </DialogDescription>

        <div className="space-y-4 py-2">
          {/* 基本信息 */}
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

          {/* API Key — 始终可编辑 */}
          <div className="space-y-1">
            <Label htmlFor="m-api-key">
              API Key {hasExistingKey ? <span className="text-xs text-emerald-600 ml-1">（已有配置，留空则保持不变）</span> : <span className="text-xs text-red-600 ml-1">（必填）</span>}
            </Label>
            <Input id="m-api-key" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." autoComplete="off" />
          </div>

          {/* 用途 */}
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

          {/* 能力 */}
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

          {/* 适配器配置 */}
          <div className="space-y-3 pt-2 border-t border-white/[0.08]">
            <Label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">适配器配置</Label>

            <div className="space-y-1">
              <Label className="text-sm">API 协议</Label>
              <Select value={adapterConfig.provider} onValueChange={v => updateAdapterConfig({ provider: v as AdapterConfig['provider'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PROVIDER_OPTIONS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label className="text-sm">联网搜索方式</Label>
              <Select value={adapterConfig.web_search_method} onValueChange={v => updateAdapterConfig({ web_search_method: v as AdapterConfig['web_search_method'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {WEB_SEARCH_METHODS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {adapterConfig.web_search_method === 'tools_builtin' && (
              <div className="space-y-1">
                <Label className="text-sm">工具名称</Label>
                <Input value={adapterConfig.web_search_tool_name ?? ''} onChange={e => updateAdapterConfig({ web_search_tool_name: e.target.value })} placeholder="$web_search" />
              </div>
            )}

            <div className="space-y-1">
              <Label className="text-sm">深度思考方式</Label>
              <Select value={adapterConfig.thinking_method} onValueChange={v => updateAdapterConfig({ thinking_method: v as AdapterConfig['thinking_method'] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {THINKING_METHODS.map(o => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {adapterConfig.thinking_method === 'model_switch' && (
              <div className="space-y-1">
                <Label className="text-sm">思考模型 ID</Label>
                <Input value={adapterConfig.thinking_model_id ?? ''} onChange={e => updateAdapterConfig({ thinking_model_id: e.target.value })} placeholder="deepseek-r1" />
              </div>
            )}

            <div className="flex items-center justify-between">
              <Label className="text-sm">联网搜索时禁用思考</Label>
              <Switch checked={adapterConfig.web_search_disables_thinking} onCheckedChange={v => updateAdapterConfig({ web_search_disables_thinking: v })} />
            </div>

            <div className="flex items-center justify-between">
              <Label className="text-sm">默认开启思考</Label>
              <Switch checked={adapterConfig.thinking_default_on} onCheckedChange={v => updateAdapterConfig({ thinking_default_on: v })} />
            </div>
          </div>
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
