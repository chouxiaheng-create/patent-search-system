// components/report/document-card.tsx
'use client'

import { useState } from 'react'
import { ThumbsUp, ThumbsDown, MessageSquare } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface DocumentCardProps {
  doc: {
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
  }
  isSelected: boolean
  onSelect: () => void
  onRate: (rating: 'useful' | 'irrelevant' | null) => void
  onNoteSave: (note: string) => void
}

export function DocumentCard({
  doc,
  isSelected,
  onSelect,
  onRate,
  onNoteSave,
}: DocumentCardProps) {
  const [showNote, setShowNote] = useState(false)
  const [note, setNote] = useState(doc.user_note || '')
  const [saving, setSaving] = useState(false)

  const handleRate = async (rating: 'useful' | 'irrelevant' | null) => {
    const newRating = doc.user_rating === rating ? null : rating
    onRate(newRating)
  }

  const handleNoteSave = async () => {
    setSaving(true)
    await onNoteSave(note)
    setSaving(false)
    setShowNote(false)
  }

  return (
    <div
      className={cn(
        'border rounded-lg p-3 cursor-pointer transition-all',
        isSelected ? 'ring-2 ring-blue-500 bg-blue-50' : 'bg-white hover:shadow-sm',
        doc.user_rating === 'useful' && 'border-l-4 border-l-green-500',
        doc.user_rating === 'irrelevant' && 'border-l-4 border-l-red-400'
      )}
      onClick={onSelect}
    >
      {/* 标题和排名 */}
      <div className="flex items-start gap-2 mb-2">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-blue-100 text-blue-600 text-xs font-medium flex items-center justify-center">
          {doc.rank}
        </span>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-slate-800 line-clamp-2">
            {doc.title}
          </h4>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
              {doc.source_platform}
            </span>
            <span className="text-xs text-slate-400">×</span>
            <span className="text-xs px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
              {doc.source_strategy}
            </span>
          </div>
        </div>
      </div>

      {/* 作者和日期 */}
      {(doc.authors || doc.pub_date) && (
        <p className="text-xs text-slate-500 mb-2">
          {doc.authors && <span>{doc.authors}</span>}
          {doc.authors && doc.pub_date && <span> · </span>}
          {doc.pub_date && <span>{doc.pub_date}</span>}
        </p>
      )}

      {/* 相关描述 */}
      {doc.relevance_desc && (
        <p className="text-xs text-slate-600 mb-2 line-clamp-2">
          {doc.relevance_desc}
        </p>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-1 mt-2">
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'h-7 px-2',
            doc.user_rating === 'useful'
              ? 'text-green-600 bg-green-50 hover:bg-green-100'
              : 'text-slate-400 hover:text-green-600'
          )}
          onClick={(e) => { e.stopPropagation(); handleRate('useful') }}
        >
          <ThumbsUp size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'h-7 px-2',
            doc.user_rating === 'irrelevant'
              ? 'text-red-500 bg-red-50 hover:bg-red-100'
              : 'text-slate-400 hover:text-red-500'
          )}
          onClick={(e) => { e.stopPropagation(); handleRate('irrelevant') }}
        >
          <ThumbsDown size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'h-7 px-2 ml-auto',
            showNote || note ? 'text-blue-600' : 'text-slate-400'
          )}
          onClick={(e) => { e.stopPropagation(); setShowNote(!showNote) }}
        >
          <MessageSquare size={14} />
        </Button>
      </div>

      {/* 备注输入框 */}
      {showNote && (
        <div className="mt-2" onClick={(e) => e.stopPropagation()}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="添加备注..."
            className="w-full text-xs border rounded p-2 resize-none focus:outline-none focus:ring-1 focus:ring-blue-500"
            rows={2}
          />
          <div className="flex justify-end gap-1 mt-1">
            <Button size="sm" variant="ghost" className="h-6 text-xs" onClick={() => setShowNote(false)}>
              取消
            </Button>
            <Button size="sm" className="h-6 text-xs" onClick={handleNoteSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
