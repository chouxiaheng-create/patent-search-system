'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { WizardProgress } from '@/components/wizard/wizard-progress'
import { JobSummaryCard } from '@/components/wizard/job-summary-card'
import { QueueStatusBanner } from '@/components/wizard/queue-status-banner'
import { ScheduleToggle } from '@/components/wizard/schedule-toggle'
import { Button } from '@/components/ui/button'
import type { AIModel, SearchStrategy, ModelFeatureOverride } from '@/lib/supabase/types'

interface Step3Config {
  documentId: string
  modelIds: string[]
  strategyIds: string[]
  perTaskLimit: number
  reportLimit: number
  reportModelId: string
  reportSystemPrompt: string
  featureOverrides: ModelFeatureOverride[]
}

function loadStep3Config(searchParams: URLSearchParams): Step3Config {
  // 从 URL params 读取配置
  return {
    documentId: searchParams.get('documentId') ?? '',
    modelIds: (searchParams.get('modelIds') ?? '').split(',').filter(Boolean),
    strategyIds: (searchParams.get('strategyIds') ?? '').split(',').filter(Boolean),
    perTaskLimit: Number(searchParams.get('perTaskLimit') ?? '5'),
    reportLimit: Number(searchParams.get('reportLimit') ?? '10'),
    reportModelId: searchParams.get('reportModelId') ?? '',
    reportSystemPrompt: searchParams.get('reportSystemPrompt') ?? '',
    featureOverrides: [],
  }
}

export default function Step3Page() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [config, setConfig] = useState<Step3Config | null>(null)
  const isAuto = searchParams.get('auto') === '1'

  const [selectedModels, setSelectedModels] = useState<AIModel[]>([])
  const [selectedStrategies, setSelectedStrategies] = useState<SearchStrategy[]>([])
  const [reportModel, setReportModel] = useState<AIModel | null>(null)
  const [parseModelName, setParseModelName] = useState('')
  const [scheduledAt, setScheduledAt] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoSubmitted = useRef(false)

  useEffect(() => {
    const loaded = loadStep3Config(searchParams)
    if (!loaded.documentId || loaded.modelIds.length === 0 || loaded.strategyIds.length === 0) {
      router.replace('/search/new/step-1')
      return
    }
    setConfig(loaded)
  }, [])

  useEffect(() => { if (!config) return; const cfg = config; async function init() { const [allModels, allStrategies, doc] = await Promise.all([ fetch('/api/models').then(r => r.json()), fetch('/api/strategies').then(r => r.json()), fetch(`/api/documents/${cfg.documentId}`).then(r => r.json()), ]); setSelectedModels((allModels as AIModel[]).filter(m => cfg.modelIds.includes(m.id))); setSelectedStrategies((allStrategies as SearchStrategy[]).filter(s => cfg.strategyIds.includes(s.id))); setReportModel((allModels as AIModel[]).find(m => m.id === cfg.reportModelId) ?? null); setParseModelName((allModels as AIModel[]).find(m => m.id === doc?.parse_config?.model_id)?.name ?? '未知模型'); } init() }, [config])

  // 自动模式：数据加载完成后自动提交
  useEffect(() => {
    if (!isAuto || autoSubmitted.current || selectedModels.length === 0 || selectedStrategies.length === 0) return
    autoSubmitted.current = true
    handleSubmit()
  }, [isAuto, selectedModels.length, selectedStrategies.length])

  async function handleSubmit() {
    if (!config) return
    setSubmitting(true); setError(null)
    try {
      fetch('/api/worker-ping').catch(() => {})
      const res = await fetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId: config.documentId, config: { model_ids: config.modelIds, strategy_ids: config.strategyIds, per_task_limit: config.perTaskLimit, report_limit: config.reportLimit, report_model_id: config.reportModelId, report_system_prompt: config.reportSystemPrompt, model_feature_overrides: config.featureOverrides }, scheduledAt }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '提交失败')
      const { jobId } = await res.json()
      router.push(`/search/${jobId}/progress`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '提交时发生错误，请重选')
      setSubmitting(false)
    }
  }

  if (!config) {
    return (
      <div className="max-w-2xl mx-auto">
        <WizardProgress currentStep={3} documentId={searchParams.get('documentId') ?? undefined} />
        <div className="text-center py-12 text-muted-foreground">加载配置中...</div>
      </div>
    )
  }

  const { documentId, modelIds, strategyIds, perTaskLimit, reportLimit, reportModelId, reportSystemPrompt, featureOverrides } = config

  return (
    <div className="max-w-2xl mx-auto">
      <WizardProgress currentStep={3} documentId={searchParams.get('documentId') ?? undefined} />
      <div className="space-y-5">
        <JobSummaryCard searchModels={selectedModels} strategies={selectedStrategies}
          parseModelName={parseModelName} reportModelName={reportModel?.name ?? '未知模型'}
          perTaskLimit={perTaskLimit} reportLimit={reportLimit} isAuto={isAuto}
          onEditConfig={() => router.push(`/search/new/step-2?documentId=${documentId}`)} />
        <QueueStatusBanner />
        <section className="card-apple p-4 sm:p-5 space-y-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">提交方式</h3>
          <ScheduleToggle scheduledAt={scheduledAt} onChange={setScheduledAt} />
          {error && <p className="text-sm text-red-600 font-medium">{error}</p>}
          <Button className="w-full" size="lg" onClick={handleSubmit} disabled={submitting || selectedModels.length === 0}>
            {submitting ? '提交中...' : scheduledAt ? '定时提交检索任务' : '提交检索任务'}
          </Button>
        </section>
        <Button variant="outline" onClick={() => router.push(`/search/new/step-2?documentId=${documentId}`)}>← 上一步</Button>
      </div>
    </div>
  )
}
