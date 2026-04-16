// app/(app)/search/[jobId]/report/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ReportView } from '@/components/report/report-view'
import { Button } from '@/components/ui/button'

export default function ReportPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.jobId as string
  const supabase = createClient()

  const [report, setReport] = useState<{
    id: string
    job_id: string
    html_content: string
    selected_docs: Array<{
      rank: number
      title: string
      authors: string
      url: string
      pub_date: string
      relevance_desc: string
      citation_gb: string
      source_platform: string
      source_strategy: string
      user_rating: 'useful' | 'irrelevant' | null
      user_note: string
    }>
    doc_count: number
    created_at: string
    document?: { id: string; title: string }
  } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadReport() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      // 先通过 job_id 找到报告
      const { data: jobData, error: jobError } = await supabase
        .from('search_jobs')
        .select('id')
        .eq('id', jobId)
        .eq('user_id', user.id)
        .single()

      if (jobError || !jobData) {
        setError('报告不存在或无权访问')
        setLoading(false)
        return
      }

      const { data: reportData, error: reportError } = await supabase
        .from('reports')
        .select('*, document:patent_documents(id, title)')
        .eq('job_id', jobId)
        .eq('user_id', user.id)
        .single()

      if (reportError || !reportData) {
        setError('报告未生成')
        setLoading(false)
        return
      }

      // 确保 selected_docs 有 user_note 字段
      const docs = reportData.selected_docs.map((doc: Record<string, unknown>) => ({
        ...doc,
        user_note: (doc as { user_note?: string }).user_note || '',
      }))

      setReport({ ...reportData, selected_docs: docs })
      setLoading(false)
    }

    loadReport()
  }, [jobId, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-500">加载中...</div>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-slate-500">{error || '报告加载失败'}</p>
        <Button variant="outline" onClick={() => router.push('/dashboard')}>
          返回列表
        </Button>
      </div>
    )
  }

  return <ReportView report={report} />
}
