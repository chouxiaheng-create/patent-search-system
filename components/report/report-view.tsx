// components/report/report-view.tsx
'use client'

import { useState, useCallback } from 'react'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { DocumentList } from './document-list'
import { ReportPreview } from './report-preview'
import { ExportMenu } from './export-menu'
import { Button } from '@/components/ui/button'
import type { Report } from '@/lib/supabase/types'

interface ReportViewProps {
  report: Report
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
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/[0.08] bg-white">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" asChild>
            <Link href={`/search/${report.job_id}/progress`}>
              <ArrowLeft size={16} className="mr-1" />
              返回
            </Link>
          </Button>
          <h1 className="text-sm font-semibold text-foreground truncate max-w-md">
            {docTitle}
          </h1>
        </div>
        <ExportMenu reportId={report.id} />
      </div>

      {/* 主体区域 */}
      <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
        {/* 左侧文献列表 */}
        <div className="w-full md:w-[360px] md:border-r border-b md:border-b-0 border-white/[0.08] bg-muted flex-shrink-0 overflow-hidden md:h-auto h-[50vh]">
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
