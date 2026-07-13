'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
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
import { toast } from 'sonner'
import type { AIModel, PatentDocument, UserPreferences } from '@/lib/supabase/types'

const DEFAULT_PARSE_PROMPT = `你是专利文献解析专家。请从以下专利文献中提取结构化信息，输出 JSON 格式。键名必须使用英文，不可翻译：

{
  "tech_theme": "技术主题（一句话概括）",
  "applicant": "申请人",
  "inventor": "发明人（多人用顿号分隔）",
  "filing_date": "申请日（YYYY-MM-DD格式）",
  "main_tech_steps": "主要技术方案步骤（详细描述）",
  "core_invention": "核心发明构思（详细描述）"
}

若字段无法确定则输出空字符串。请仅返回JSON，不要包含其他内容。`

export default function Step1Page() {
  const searchParams = useSearchParams()
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
  const urlDocId = searchParams.get('documentId')
  const [document, setDocument] = useState<PatentDocument | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)

  useEffect(() => {
    async function init() {
      // 如果 URL 中提供了 documentId，直接加载已有文档
      if (urlDocId) {
        setDocumentId(urlDocId)
        const docRes = await fetch(`/api/documents/${urlDocId}`)
        const loadedDoc: PatentDocument = await docRes.json()
        if (docRes.ok) setDocument(loadedDoc)
      }

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
          if (updated.parse_status === 'failed') setParseError('文档解析失败，请重试')
        })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR') {
          setParseError('实时连接失败，请刷新页面重试')
          setParsing(false)
        } else if (status === 'TIMED_OUT') {
          setParseError('实时连接超时，请刷新页面重试')
          setParsing(false)
        }
      })
    return () => { supabase.removeChannel(channel) }
  }, [documentId])

  // 偏好模式：解析完成后自动跳转 step-3
  useEffect(() => {
    if (!autoMode || !documentId || !preferences || document?.parse_status !== 'done') return
    const step3Config = {
      documentId,
      modelIds: preferences.search_model_ids,
      strategyIds: preferences.strategy_ids,
      perTaskLimit: preferences.per_task_limit,
      reportLimit: preferences.report_limit,
      reportModelId: preferences.report_model_id,
      reportSystemPrompt: preferences.report_system_prompt,
      featureOverrides: [],
    }
    sessionStorage.setItem('step3-config', JSON.stringify(step3Config))
    router.push(`/search/new/step-3?documentId=${documentId}&auto=1`)
  }, [autoMode, document?.parse_status, documentId, preferences, router])

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
      const resBody = await res.json()
      if (!res.ok) {
        throw new Error(resBody.error || resBody.detail || `服务器错误 (${res.status})`)
      }
      const newDocId = resBody.documentId
      if (!newDocId) {
        throw new Error('服务器未返回文档ID')
      }
      setDocumentId(newDocId); setParsing(true)
      const docRes = await fetch(`/api/documents/${newDocId}`)
      const docBody = await docRes.json()
      if (!docRes.ok) {
        throw new Error(docBody.error || docBody.detail || `获取文档失败 (${docRes.status})`)
      }
      setDocument(docBody)
    } catch (err) {
      console.error('上传失败:', err)
      toast.error('文件上传失败', { description: err instanceof Error ? err.message : '请检查文件格式和网络连接后重试' })
      setParsing(false)
    }
    finally { setUploading(false) }
  }

  async function handleHistoryDocSelect(docId: string) {
    const res = await fetch(`/api/documents/${docId}`)
    const doc = await res.json()
    if (!res.ok) {
      toast.error('加载历史文档失败', { description: doc.error || doc.detail || `服务器错误 (${res.status})` })
      return
    }
    setDocument(doc); setDocumentId(docId)

    // 复用历史文献：若状态不是 done（如 failed/pending），自动触发重新解析
    if (doc.parse_status !== 'done') {
      if (selectedModelIds.length === 0) {
        toast.error('请先选择解析模型再使用历史文献')
        return
      }
      setParsing(true)
      try {
        const reparseRes = await fetch(`/api/documents/${docId}/reparse`, { method: 'POST' })
        const reparseBody = await reparseRes.json()
        if (!reparseRes.ok) {
          throw new Error(reparseBody.error || reparseBody.detail || '重新解析请求失败')
        }
      } catch (err) {
        setParseError(err instanceof Error ? err.message : '解析启动失败')
        setParsing(false)
      }
    }
  }

  async function handleSaveParsedData(updates: { parsed_data: PatentDocument['parsed_data']; user_notes: string }) {
    if (!documentId) return
    await fetch(`/api/documents/${documentId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) })
    setDocument(prev => prev ? { ...prev, ...updates } : prev)
  }

  function handleNext() {
    if (!documentId) return
    if (autoMode && preferences) {
      const step3Config = {
        documentId,
        modelIds: preferences.search_model_ids,
        strategyIds: preferences.strategy_ids,
        perTaskLimit: preferences.per_task_limit,
        reportLimit: preferences.report_limit,
        reportModelId: preferences.report_model_id,
        reportSystemPrompt: preferences.report_system_prompt,
        featureOverrides: [],
      }
      sessionStorage.setItem('step3-config', JSON.stringify(step3Config))
      router.push(`/search/new/step-3?documentId=${documentId}&auto=1`)
    } else {
      router.push(`/search/new/step-2?documentId=${documentId}`)
    }
  }

  const parseModels = models.filter(m => m.usage_types.includes('parse'))

  return (
    <div className="max-w-2xl mx-auto">
      <WizardProgress currentStep={1} documentId={documentId ?? undefined} />
      <div className="space-y-5">
        {preferences !== null && (
          <div className="flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">模式</span>
            <div className="flex rounded-lg bg-muted p-0.5">
              {(['手动配置', '使用偏好配置'] as const).map((label, i) => (
                <button key={label} type="button" onClick={() => setAutoMode(i === 1)}
                  className={`px-4 py-1.5 text-sm font-medium rounded-md transition-all duration-200 ${(i === 1) === autoMode ? 'bg-white text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        <section className="card-apple p-4 sm:p-5 space-y-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">① 选择解析模型</h3>
          <ModelSelector models={parseModels} mode="parse" selectedIds={selectedModelIds} onChange={setSelectedModelIds} />
          <PromptEditor label="编辑解析提示词" value={parsePrompt} onChange={setParsePrompt} />
        </section>

        <section className="card-apple p-5 space-y-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">② 选择专利文献</h3>
          <FileUploadZone onFileSelect={handleFileSelect} uploading={uploading} uploadProgress={uploadProgress} disabled={selectedModelIds.length === 0 || !!documentId} />
          {selectedModelIds.length === 0 && <p className="text-xs text-amber-600">请先选择解析模型再上传文件</p>}
          <HistoryDocPicker documents={historyDocs} onSelect={handleHistoryDocSelect} disabled={!!documentId} />
        </section>

        {documentId && (
          <section className="card-apple p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">③ 解析结果</h3>
              {parsing && <span className="flex items-center gap-1.5 text-xs text-primary"><Loader2 size={14} className="animate-spin" />解析中...</span>}
            </div>
            {parseError && <p className="text-xs text-red-600">{parseError}</p>}
            {document && document.parse_status === 'done' && (
              <ParseResultForm document={document} onSave={handleSaveParsedData} />
            )}
          </section>
        )}

        <div className="flex justify-end pt-2">
          <Button onClick={handleNext} disabled={document?.parse_status !== 'done'} size="lg">下一步 →</Button>
        </div>
      </div>
    </div>
  )
}
