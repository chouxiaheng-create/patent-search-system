'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { WizardProgress } from '@/components/wizard/wizard-progress'
import { JobSummaryCard } from '@/components/wizard/job-summary-card'
import { QueueStatusBanner } from '@/components/wizard/queue-status-banner'
import { ScheduleToggle } from '@/components/wizard/schedule-toggle'
import { Button } from '@/components/ui/button'
import type { AIModel, SearchStrategy } from '@/lib/supabase/types'

export default function Step3Page() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const documentId = searchParams.get('documentId') ?? ''
  const modelIds = (searchParams.get('modelIds') ?? '').split(',').filter(Boolean)
  const strategyIds = (searchParams.get('strategyIds') ?? '').split(',').filter(Boolean)
  const perTaskLimit = Number(searchParams.get('perTaskLimit') ?? '5')
  const reportLimit = Number(searchParams.get('reportLimit') ?? '10')
  const reportModelId = searchParams.get('reportModelId') ?? ''
  const reportSystemPrompt = searchParams.get('reportSystemPrompt') ?? ''
  const isAuto = searchParams.get('auto') === '1'

  const [selectedModels, setSelectedModels] = useState<AIModel[]>([])
  const [selectedStrategies, setSelectedStrategies] = useState<SearchStrategy[]>([])
  const [reportModel, setReportModel] = useState<AIModel | null>(null)
  const [parseModelName, setParseModelName] = useState('')
  const [scheduledAt, setScheduledAt] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!documentId || modelIds.length === 0 || strategyIds.length === 0) {
      router.replace('/search/new/step-1'); return
    }
    async function init() {
      const [allModels, allStrategies, doc] = await Promise.all([
        fetch('/api/models').then(r => r.json()),
        fetch('/api/strategies').then(r => r.json()),
        fetch(`/api/documents/${documentId}`).then(r => r.json()),
      ])
      setSelectedModels((allModels as AIModel[]).filter(m => modelIds.includes(m.id)))
      setSelectedStrategies((allStrategies as SearchStrategy[]).filter(s => strategyIds.includes(s.id)))
      setReportModel((allModels as AIModel[]).find(m => m.id === reportModelId) ?? null)
      setParseModelName((allModels as AIModel[]).find(m => m.id === doc?.parse_config?.model_id)?.name ?? '未知模型')
    }
    init()
  }, [])

  async function handleSubmit() {
    setSubmitting(true); setError(null)
    try {
      fetch('/api/worker-ping').catch(() => {})
      const res = await fetch('/api/jobs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documentId, config: { model_ids: modelIds, strategy_ids: strategyIds, per_task_limit: perTaskLimit, report_limit: reportLimit, report_model_id: reportModelId, report_system_prompt: reportSystemPrompt }, scheduledAt }),
      })
      if (!res.ok) throw new Error((await res.json()).error ?? '提交失败')
      const { jobId } = await res.json()
      router.push(`/search/${jobId}/progress`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '提交时发生错误，请重试')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <WizardProgress currentStep={3} />
      <div className="space-y-6">
        <JobSummaryCard searchModels={selectedModels} strategies={selectedStrategies}
          parseModelName={parseModelName} reportModelName={reportModel?.name ?? '未知模型'}
          perTaskLimit={perTaskLimit} reportLimit={reportLimit} isAuto={isAuto}
          onEditConfig={() => router.push(`/search/new/step-2?documentId=${documentId}`)} />
        <QueueStatusBanner />
        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">提交方式</h3>
          <ScheduleToggle scheduledAt={scheduledAt} onChange={setScheduledAt} />
          {error && <p className="text-sm text-red-500">{error}</p>}
          <Button className="w-full" onClick={handleSubmit} disabled={submitting || selectedModels.length === 0}>
            {submitting ? '提交中...' : scheduledAt ? '定时提交检索任务' : '提交检索任务'}
          </Button>
        </section>
        <Button variant="outline" onClick={() => router.push(`/search/new/step-2?documentId=${documentId}`)}>← 上一步</Button>
      </div>
    </div>
  )
}
