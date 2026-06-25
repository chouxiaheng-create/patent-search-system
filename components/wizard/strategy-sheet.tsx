'use client'

import { useState } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetFooter } from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { SearchStrategy } from '@/lib/supabase/types'

interface StrategySheetProps {
  strategy: SearchStrategy | null; open: boolean; onOpenChange: (v: boolean) => void
  onSave?: (id: string, updates: { name: string; prompt_template: string }) => Promise<void>
  onSaveAs?: (data: { name: string; prompt_template: string }) => Promise<void>
  onCreate?: (data: { name: string; prompt_template: string }) => Promise<void>
}

export function StrategySheet({ strategy, open, onOpenChange, onSave, onSaveAs, onCreate }: StrategySheetProps) {
  const isNew = strategy === null
  const isBuiltin = strategy?.is_builtin ?? false
  const [name, setName] = useState(strategy?.name ?? '')
  const [prompt, setPrompt] = useState(strategy?.prompt_template ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    setSaving(true)
    try {
      if (isNew) await onCreate?.({ name, prompt_template: prompt })
      else if (isBuiltin) await onSaveAs?.({ name: `${name}（自定义副本）`, prompt_template: prompt })
      else await onSave?.(strategy!.id, { name, prompt_template: prompt })
      onOpenChange(false)
    } finally { setSaving(false) }
  }

  return (
    <Sheet open={open} onOpenChange={v => { if (!v) { setName(strategy?.name ?? ''); setPrompt(strategy?.prompt_template ?? '') } onOpenChange(v) }}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{isNew ? '新建检索策略' : isBuiltin ? `查看策略：${strategy.name}` : `编辑策略：${strategy.name}`}</SheetTitle>
        </SheetHeader>
        <div className="space-y-4 py-4">
          <div className="space-y-1">
            <Label htmlFor="s-name">策略名称</Label>
            <Input id="s-name" value={name} readOnly={isBuiltin && !isNew} onChange={e => setName(e.target.value)} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="s-prompt">提示词模板</Label>
            <p className="text-xs text-muted-foreground">可用变量：{`{{tech_theme}}`}、{`{{applicant}}`}、{`{{inventor}}`}、{`{{filing_date}}`}、{`{{main_tech_steps}}`}、{`{{core_invention}}`}</p>
            <Textarea id="s-prompt" value={prompt} readOnly={isBuiltin && !isNew} rows={8} onChange={e => setPrompt(e.target.value)} className="font-mono text-sm" />
          </div>
        </div>
        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          {isBuiltin
            ? <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '另存为我的策略'}</Button>
            : <Button onClick={handleSave} disabled={saving || !name.trim() || !prompt.trim()}>{saving ? '保存中...' : isNew ? '创建策略' : '保存修改'}</Button>
          }
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
