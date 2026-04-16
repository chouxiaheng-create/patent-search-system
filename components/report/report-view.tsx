// components/report/report-view.tsx
'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { DocumentList } from './document-list'
import { ReportPreview } from './report-preview'
import { ExportMenu } from './export-menu'
import { Button } from '@/components/ui/button'

interface ReportDocument {
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
}

interface ReportViewProps {
  report: {
    id: string
    job_id: string
    html_content: string
    selected_docs: ReportDocument[]
    doc_count: number
    created_at: string
    document?: { id: string; title: string }
  }
}

export function ReportView({ report }: ReportViewProps) {
  const [documents, setDocuments] = useState(report.selected_docs)
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null)
  const [filter, setFilter] = useState<'all' | 'useful' | 'irrelevant'>('all')
  const [sortBy, setSortBy] = useState<'rank' | 'platform' | 'rating'>('rank')

  const handleRate = useCallback(async (index: number, rating: 'useful' | 'irrelevant' | null) => {
    // 即时乐观更新
    setDocuments(prev => prev.map((d, i) =>
      i === index ? { ...d, user_rating: rating } : d
    ))

    // 保存到服务器
    await fetch(`/api/reports/${report.id}/documents/${index}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_rating: rating }),
    })
  }, [report.id])

  const handleNoteSave = useCallback(async (index: number, note: string) => {
    // 即时乐观更新
    setDocuments(prev => prev.map((d, i) =>
      i === index ? { ...d, user_note: note } : d
    ))

    // 保存到服务器
    await fetch(`/api/reports/${report.id}/documents/${index}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_note: note }),
    })
  }, [report.id])

  const docTitle = report.document?.title || '专利检索报告'

  return (
    <div className="h-[calc(100vh-8rem)] flex flex-col">
      {/* 顶部操作栏 */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/search/${report.job_id}/progress`}>
              <ArrowLeft size={16} className="mr-1" />
              返回
            </Link>
          </Button>
          <h1 className="text-sm font-semibold text-slate-800 truncate max-w-md">
            {docTitle}
          </h1>
        </div>
        <ExportMenu reportId={report.id} />
      </div>

      {/* 主体区域 */}
      <div className="flex flex-1 overflow-hidden">
        {/* 左侧文献列表 */}
        <div className="w-[360px] border-r border-slate-200 bg-slate-50 flex-shrink-0 overflow-hidden">
          <DocumentList
            documents={documents}
            selectedIndex={selectedIndex}
            filter={filter}
            sortBy={sortBy}
            onSelect={setSelectedIndex}
            onFilterChange={setFilter}
            onSortChange={setSortBy}
            onRate={handleRate}
            onNoteSave={handleNoteSave}
          />
        </div>

        {/* 右侧报告预览 */}
        <div className="flex-1 overflow-hidden">
          <ReportPreview
            htmlContent={report.html_content}
            title="报告预览"
          />
        </div>
      </div>
    </div>
  )
}
