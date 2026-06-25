// app/(app)/search/[jobId]/report/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { ReportView } from '@/components/report/report-view'
import { Button } from '@/components/ui/button'
import type { Report } from '@/lib/supabase/types'

export default function ReportPage() {
  const params = useParams()
  const router = useRouter()
  const jobId = params.jobId as string
  const supabase = createClient()

  const [report, setReport] = useState<Report | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadReport() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        router.push('/login')
        return
      }

      // 先查任务，获取 document_id
      const { data: jobData, error: jobError } = await supabase
        .from('search_jobs')
        .select('id, document_id')
        .eq('id', jobId)
        .eq('user_id', user.id)
        .single()

      if (jobError || !jobData) {
        setError('报告不存在或无权访问')
        setLoading(false)
        return
      }

      // 查报告（不 join patent_documents，Supabase 无直接外键关系）
      // 注意：可能存在多个 report（重复生成），按 created_at 取最新的一个
      // 使用 maybeSingle 而非 single，避免多行时报错
      const { data: reportData, error: reportError } = await supabase
        .from('reports')
        .select('*')
        .eq('job_id', jobId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (reportError) {
        console.error('Report query error:', reportError)
        setError('报告查询失败：' + (reportError.message || '未知错误'))
        setLoading(false)
        return
      }

      if (!reportData) {
        setError('报告未生成，请确认所有检索任务已完成')
        setLoading(false)
        return
      }

      // 单独查询文档标题
      let document: { id: string; title: string } | undefined
      if (jobData.document_id) {
        const { data: docData } = await supabase
          .from('patent_documents')
          .select('id, title')
          .eq('id', jobData.document_id)
          .single()
        if (docData) document = docData
      }

      // 确保 selected_docs 有 user_note 字段
      const docs = (reportData.selected_docs || []).map((doc: Record<string, unknown>) => ({
        ...doc,
        user_note: (doc as { user_note?: string }).user_note || '',
      }))

      setReport({ ...reportData, selected_docs: docs, document })
      setLoading(false)
    }

    loadReport()
  }, [jobId, router])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-[#64748b]">
          <div className="w-5 h-5 border-2 border-[#1e293b]/30 border-t-[#1e293b] rounded-full animate-spin" />
          <span className="text-sm font-medium">加载中...</span>
        </div>
      </div>
    )
  }

  if (error || !report) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <p className="text-[#64748b]">{error || '报告加载失败'}</p>
        <Button variant="outline" className="rounded-xl" onClick={() => router.push('/dashboard')}>
          返回列表
        </Button>
      </div>
    )
  }

  return <ReportView report={report} />
}
