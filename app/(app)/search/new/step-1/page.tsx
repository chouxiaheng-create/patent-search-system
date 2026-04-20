'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { WizardProgress } from '@/components/wizard/wizard-progress'
import { ModelSelector } from '@/components/wizard/model-selector'
import { PromptEditor } from '@/components/wizard/prompt-editor'
import { FileUploadZone } from '@/components/wizard/file-upload-zone'
import { HistoryDocPicker } from '@/components/wizard/history-doc-picker'
import { ParseResultForm } from '@/components/wizard/parse-result-form'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { AIModel, PatentDocument, UserPreferences } from '@/lib/supabase/types'

const DEFAULT_PARSE_PROMPT = `你是专利文献解析专家。请从以下专利文献中提取结构化信息，输出 JSON 格式，包含字段：
tech_theme（技术主题）、applicant（申请人）、inventor（发明人）、
filing_date（申请日，格式 YYYY-MM-DD）、main_tech_steps（主要技术方案步骤）、
core_invention（核心发明构思）。若字段无法确定则输出空字符串。`

export default function Step1Page() {
  const router = useRouter()
  const supabase = createClient()

  const [models, setModels] = useState<AIModel[]>([])
  const [historyDocs, setHistoryDocs] = useState<PatentDocument[]>([])
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [parsePrompt, setParsePrompt] = useState(DEFAULT_PARSE_PROMPT)
  const [autoMode, setAutoMode] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [document, setDocument] = useState<PatentDocument | null>(null)
  const [parsing, setParsing] = useState(false)

  useEffect(() => {
    async function init() {
      const [modelsRes, prefsRes] = await Promise.all([
        fetch('/api/models').then(r => r.json()),
        fetch('/api/preferences').then(r => r.json()),
      ])
      setModels(modelsRes)
      setPreferences(prefsRes)
      if (prefsRes?.parse_model_id) {
        setSelectedModelIds([prefsRes.parse_model_id])
        setParsePrompt(prefsRes.parse_system_prompt ?? DEFAULT_PARSE_PROMPT)
      }
      const { data: docs } = await supabase
        .from('patent_documents').select('*').eq('parse_status', 'done')
        .order('created_at', { ascending: false }).limit(20)
      setHistoryDocs(docs ?? [])
    }
    init()
  }, [])

  useEffect(() => {
    if (!documentId) return
    const channel = supabase.channel(`doc-${documentId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'patent_documents', filter: `id=eq.${documentId}` },
        (payload) => {
          const updated = payload.new as PatentDocument
          setDocument(updated)
          if (updated.parse_status !== 'parsing') setParsing(false)
        })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [documentId])

  async function handleFileSelect(file: File) {
    if (selectedModelIds.length === 0) return
    setUploading(true); setUploadProgress(0)
    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return
      const filePath = `${user.id}/${Date.now()}-${file.name.replace(/[^\x00-\x7F]/g, '_')}`
      const { error: storageError } = await supabase.storage.from('documents').upload(filePath, file)
      if (storageError) throw storageError
      setUploadProgress(100)
      const ext = file.name.split('.').pop()?.toLowerCase()
      const res = await fetch('/api/documents', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileUrl: filePath, fileName: file.name, fileType: ext, parseModelId: selectedModelIds[0], parseSystemPrompt: parsePrompt }),
      })
      const { documentId: newDocId } = await res.json()
      setDocumentId(newDocId); setParsing(true)
      const docRes = await fetch(`/api/documents/${newDocId}`)
      setDocument(await docRes.json())
    } catch (err) { console.error('上传失败:', err) }
    finally { setUploading(false) }
  }

  async function handleHistoryDocSelect(docId: string) {
    const doc = await fetch(`/api/documents/${docId}`).then(r => r.json())
    setDocument(doc); setDocumentId(docId)
  }

  async function handleSaveParsedData(updates: { parsed_data: PatentDocument['parsed_data']; user_notes: string }) {
    if (!documentId) return
    await fetch(`/api/documents/${documentId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    setDocument(prev => prev ? { ...prev, ...updates } : prev)
  }

  function handleNext() {
    if (!documentId) return
    if (autoMode && preferences) {
      const p = new URLSearchParams({
        documentId, modelIds: preferences.search_model_ids.join(','), strategyIds: preferences.strategy_ids.join(','),
        perTaskLimit: String(preferences.per_task_limit), reportLimit: String(preferences.report_limit),
        reportModelId: preferences.report_model_id, reportSystemPrompt: preferences.report_system_prompt, auto: '1',
      })
      router.push(`/search/new/step-3?${p}`)
    } else {
      router.push(`/search/new/step-2?documentId=${documentId}`)
    }
  }

  const parseModels = models.filter(m => m.usage_types.includes('parse'))

  return (
    <div className="max-w-2xl mx-auto">
      <WizardProgress currentStep={1} />
      <div className="space-y-6">
        {preferences !== null && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">模式：</span>
            <div className="flex rounded-md border border-slate-200 overflow-hidden">
              {(['手动配置', '使用偏好配置'] as const).map((label, i) => (
                <button key={label} type="button" onClick={() => setAutoMode(i === 1)}
                  className={`px-3 py-1.5 text-sm font-medium transition-colors ${(i === 1) === autoMode ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'} ${i > 0 ? 'border-l border-slate-200' : ''}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">① 选择解析模型</h3>
          <ModelSelector models={parseModels} mode="parse" selectedIds={selectedModelIds} onChange={setSelectedModelIds} />
          <PromptEditor label="编辑解析提示词" value={parsePrompt} onChange={setParsePrompt} />
        </section>

        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">② 选择专利文献</h3>
          <FileUploadZone onFileSelect={handleFileSelect} uploading={uploading} uploadProgress={uploadProgress} disabled={selectedModelIds.length === 0 || !!documentId} />
          {selectedModelIds.length === 0 && <p className="text-xs text-amber-600">请先选择解析模型再上传文件</p>}
          <HistoryDocPicker documents={historyDocs} onSelect={handleHistoryDocSelect} disabled={!!documentId} />
        </section>

        {documentId && (
          <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">③ 解析结果</h3>
              {parsing && <span className="flex items-center gap-1.5 text-xs text-blue-600"><Loader2 size={14} className="animate-spin" />解析中...</span>}
            </div>
            {document && document.parse_status !== 'pending' && (
              <ParseResultForm document={document} onSave={handleSaveParsedData} />
            )}
          </section>
        )}

        <div className="flex justify-end">
          <Button onClick={handleNext} disabled={document?.parse_status !== 'done'}>下一步 →</Button>
        </div>
      </div>
    </div>
  )
}
