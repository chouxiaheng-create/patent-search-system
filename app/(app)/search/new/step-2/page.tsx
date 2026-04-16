'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { WizardProgress } from '@/components/wizard/wizard-progress'
import { ModelSelector } from '@/components/wizard/model-selector'
import { PromptEditor } from '@/components/wizard/prompt-editor'
import { StrategySheet } from '@/components/wizard/strategy-sheet'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { AIModel, SearchStrategy, PatentDocument } from '@/lib/supabase/types'

const DEFAULT_REPORT_PROMPT = `你是专业专利检索分析师。以下是针对一件专利申请的多路检索结果，请综合评估，
去除重复条目，按相关程度从高到低筛选最相关的文献，输出 JSON 数组，
每项包含：rank、title、authors、url、pub_date、relevance_desc、citation_gb。`

export default function Step2Page() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const documentId = searchParams.get('documentId') ?? ''

  const [models, setModels] = useState<AIModel[]>([])
  const [strategies, setStrategies] = useState<SearchStrategy[]>([])
  const [selectedSearchModelIds, setSelectedSearchModelIds] = useState<string[]>([])
  const [selectedStrategyIds, setSelectedStrategyIds] = useState<string[]>([])
  const [perTaskLimit, setPerTaskLimit] = useState(5)
  const [reportLimit, setReportLimit] = useState(10)
  const [selectedReportModelIds, setSelectedReportModelIds] = useState<string[]>([])
  const [reportPrompt, setReportPrompt] = useState(DEFAULT_REPORT_PROMPT)
  const [savePreferences, setSavePreferences] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [activeStrategy, setActiveStrategy] = useState<SearchStrategy | null>(null)
  const [document, setDocument] = useState<PatentDocument | null>(null)

  useEffect(() => {
    if (!documentId) { router.replace('/search/new/step-1'); return }
    async function init() {
      const [docRes, modelsRes, strategiesRes] = await Promise.all([
        fetch(`/api/documents/${documentId}`),
        fetch('/api/models'),
        fetch('/api/strategies'),
      ])
      const doc: PatentDocument = await docRes.json()
      if (doc.parse_status !== 'done') { router.replace('/search/new/step-1'); return }
      setDocument(doc)
      const allModels: AIModel[] = await modelsRes.json()
      const allStrategies: SearchStrategy[] = await strategiesRes.json()
      setModels(allModels)
      setStrategies(allStrategies)
      setSelectedSearchModelIds(allModels.filter(m => m.usage_types.includes('search') && m.capabilities.deep_reasoning && m.capabilities.web_search && m.is_builtin).map(m => m.id))
      setSelectedStrategyIds(allStrategies.filter(s => s.is_builtin).map(s => s.id).slice(0, 2))
      const reportModels = allModels.filter(m => m.usage_types.includes('report') && m.capabilities.deep_reasoning)
      if (reportModels.length > 0) setSelectedReportModelIds([reportModels[0].id])
    }
    init()
  }, [documentId])

  async function handleSaveStrategy(id: string, updates: { name: string; prompt_template: string }) {
    await fetch(`/api/strategies/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    setStrategies(await fetch('/api/strategies').then(r => r.json()))
  }

  async function handleSaveAsStrategy(data: { name: string; prompt_template: string }) {
    const s = await fetch('/api/strategies', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }).then(r => r.json())
    setStrategies(prev => [...prev, s])
    setSelectedStrategyIds(prev => [...prev, s.id])
  }

  function handleNext() {
    if (savePreferences) {
      fetch('/api/preferences', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        parse_model_id: document?.parse_config?.model_id ?? '', parse_system_prompt: document?.parse_config?.system_prompt ?? '',
        search_model_ids: selectedSearchModelIds, strategy_ids: selectedStrategyIds,
        per_task_limit: perTaskLimit, report_limit: reportLimit, report_model_id: selectedReportModelIds[0] ?? '', report_system_prompt: reportPrompt,
      }) }).catch(() => {})
    }
    const p = new URLSearchParams({ documentId, modelIds: selectedSearchModelIds.join(','), strategyIds: selectedStrategyIds.join(','),
      perTaskLimit: String(perTaskLimit), reportLimit: String(reportLimit), reportModelId: selectedReportModelIds[0] ?? '', reportSystemPrompt: reportPrompt })
    router.push(`/search/new/step-3?${p}`)
  }

  const searchModels = models.filter(m => m.usage_types.includes('search'))
  const reportModels = models.filter(m => m.usage_types.includes('report'))
  const canProceed = selectedSearchModelIds.length > 0 && selectedStrategyIds.length > 0 && selectedReportModelIds.length > 0

  return (
    <div className="max-w-2xl mx-auto">
      <WizardProgress currentStep={2} />
      <div className="space-y-6">
        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">检索平台（多选）</h3>
          <ModelSelector models={searchModels} mode="search" multiSelect selectedIds={selectedSearchModelIds} onChange={setSelectedSearchModelIds} />
        </section>

        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">检索策略（多选）</h3>
          <div className="space-y-2">
            {strategies.map(s => (
              <div key={s.id} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <Checkbox id={`s-${s.id}`} checked={selectedStrategyIds.includes(s.id)}
                    onCheckedChange={v => setSelectedStrategyIds(v ? [...selectedStrategyIds, s.id] : selectedStrategyIds.filter(id => id !== s.id))} />
                  <Label htmlFor={`s-${s.id}`} className="text-sm cursor-pointer">{s.name}</Label>
                  {s.is_builtin && <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">内置</span>}
                </div>
                <button type="button" onClick={() => { setActiveStrategy(s); setSheetOpen(true) }} className="text-xs text-blue-600 hover:underline">查看/编辑提示词</button>
              </div>
            ))}
            <button type="button" onClick={() => { setActiveStrategy(null); setSheetOpen(true) }} className="text-sm text-blue-600 hover:underline mt-1">+ 新建自定义策略</button>
          </div>
        </section>

        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">参数</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1"><Label className="text-sm">每路径备选文献数</Label><Input type="number" min={1} max={20} value={perTaskLimit} onChange={e => setPerTaskLimit(Number(e.target.value))} className="w-24" /></div>
            <div className="space-y-1"><Label className="text-sm">报告输出文献数</Label><Input type="number" min={1} max={30} value={reportLimit} onChange={e => setReportLimit(Number(e.target.value))} className="w-24" /></div>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">汇总模型</Label>
            <ModelSelector models={reportModels} mode="report" selectedIds={selectedReportModelIds} onChange={setSelectedReportModelIds} />
            <PromptEditor label="编辑报告生成提示词" value={reportPrompt} onChange={setReportPrompt} />
          </div>
        </section>

        <div className="flex items-center gap-2">
          <Checkbox id="save-prefs" checked={savePreferences} onCheckedChange={v => setSavePreferences(!!v)} />
          <Label htmlFor="save-prefs" className="text-sm cursor-pointer">保存当前配置为我的偏好配置</Label>
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => router.push('/search/new/step-1')}>← 上一步</Button>
          <Button onClick={handleNext} disabled={!canProceed}>下一步 →</Button>
        </div>
      </div>

      <StrategySheet strategy={activeStrategy} open={sheetOpen} onOpenChange={setSheetOpen}
        onSave={handleSaveStrategy} onSaveAs={handleSaveAsStrategy} onCreate={handleSaveAsStrategy} />
    </div>
  )
}
