// components/report/document-list.tsx
'use client'

import { useMemo } from 'react'
import { DocumentCard } from './document-card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

interface DocumentListProps {
  documents: Array<{
    rank: number
    title: string
    authors: string
    url: string
    pub_date: string
    relevance_desc: string
    source_platform: string
    source_strategy: string
    user_rating: 'useful' | 'irrelevant' | null
    user_note: string
  }>
  selectedIndex: number | null
  filter: 'all' | 'useful' | 'irrelevant'
  sortBy: 'rank' | 'platform' | 'rating'
  onSelect: (index: number) => void
  onFilterChange: (filter: 'all' | 'useful' | 'irrelevant') => void
  onSortChange: (sortBy: 'rank' | 'platform' | 'rating') => void
  onRate: (index: number, rating: 'useful' | 'irrelevant' | null) => void
  onNoteSave: (index: number, note: string) => void
}

export function DocumentList({
  documents,
  selectedIndex,
  filter,
  sortBy,
  onSelect,
  onFilterChange,
  onSortChange,
  onRate,
  onNoteSave,
}: DocumentListProps) {
  const filteredDocs = useMemo(() => {
    let docs = [...documents]

    // 筛选
    if (filter === 'useful') {
      docs = docs.filter(d => d.user_rating === 'useful')
    } else if (filter === 'irrelevant') {
      docs = docs.filter(d => d.user_rating === 'irrelevant')
    }

    // 排序
    docs.sort((a, b) => {
      if (sortBy === 'rank') return a.rank - b.rank
      if (sortBy === 'platform') return a.source_platform.localeCompare(b.source_platform)
      if (sortBy === 'rating') {
        const ratingOrder = { useful: 0, irrelevant: 2, null: 1 }
        return (ratingOrder[a.user_rating || 'null'] as number) - (ratingOrder[b.user_rating || 'null'] as number)
      }
      return 0
    })

    return docs
  }, [documents, filter, sortBy])

  // 找到原始文档索引
  const getOriginalIndex = (doc: typeof documents[0]) => {
    return documents.findIndex(d => d.rank === doc.rank)
  }

  return (
    <div className="flex flex-col h-full">
      {/* 摘要 */}
      <div className="p-4 border-b border-slate-200 bg-white">
        <h2 className="text-sm font-semibold text-slate-700 mb-2">文献列表</h2>
        <p className="text-xs text-slate-500">
          共 {documents.length} 篇
          {filter !== 'all' && ` · ${filteredDocs.length} 篇符合筛选`}
        </p>
      </div>

      {/* 列表 */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {filteredDocs.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">
            {filter === 'all' ? '暂无文献' : `没有${filter === 'useful' ? '有用' : '不相关'}的文献`}
          </p>
        ) : (
          filteredDocs.map((doc) => {
            const originalIndex = getOriginalIndex(doc)
            return (
              <DocumentCard
                key={doc.rank}
                doc={doc}
                isSelected={selectedIndex === originalIndex}
                onSelect={() => onSelect(originalIndex)}
                onRate={(rating) => onRate(originalIndex, rating)}
                onNoteSave={(note) => onNoteSave(originalIndex, note)}
              />
            )
          })
        )}
      </div>

      {/* 筛选和排序 */}
      <div className="p-3 border-t border-slate-200 bg-white flex gap-2">
        <Select value={filter} onValueChange={(v) => onFilterChange(v as 'all' | 'useful' | 'irrelevant')}>
          <SelectTrigger className="h-8 text-xs w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="useful">有用</SelectItem>
            <SelectItem value="irrelevant">不相关</SelectItem>
          </SelectContent>
        </Select>

        <Select value={sortBy} onValueChange={(v) => onSortChange(v as 'rank' | 'platform' | 'rating')}>
          <SelectTrigger className="h-8 text-xs w-24">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="rank">按排名</SelectItem>
            <SelectItem value="platform">按平台</SelectItem>
            <SelectItem value="rating">按评分</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}
