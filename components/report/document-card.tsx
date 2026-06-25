// components/report/document-card.tsx
'use client'

import { useState } from 'react'
import { ThumbsUp, ThumbsDown, MessageSquare, ExternalLink } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'

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
        'border rounded-xl p-3 cursor-pointer transition-all duration-200',
        isSelected
          ? 'ring-2 ring-primary bg-primary/5 border-primary/30'
          : 'bg-white border-white/[0.08] hover:shadow-sm',
        doc.user_rating === 'useful' && 'border-l-4 border-l-[#34c759]',
        doc.user_rating === 'irrelevant' && 'border-l-4 border-l-destructive'
      )}
      onClick={onSelect}
    >
      {/* 标题和排名 */}
      <div className="flex items-start gap-2 mb-2">
        <span className="flex-shrink-0 w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-semibold flex items-center justify-center">
          {doc.rank}
        </span>
        <div className="flex-1 min-w-0">
          <h4 className="text-sm font-medium text-foreground line-clamp-2">
            {doc.title}
          </h4>
          <div className="flex items-center gap-1 mt-1">
            <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground rounded-md">
              {doc.source_platform}
            </span>
            <span className="text-xs text-muted-foreground/50">×</span>
            <span className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground rounded-md">
              {doc.source_strategy}
            </span>
          </div>
        </div>
      </div>

      {/* 作者和日期 */}
      {(doc.authors || doc.pub_date) && (
        <p className="text-xs text-muted-foreground mb-2">
          {doc.authors && <span>{doc.authors}</span>}
          {doc.authors && doc.pub_date && <span> · </span>}
          {doc.pub_date && <span>{doc.pub_date}</span>}
        </p>
      )}

      {/* 相关描述 */}
      {doc.relevance_desc && (
        <p className="text-xs text-foreground/70 mb-2 line-clamp-2">
          {doc.relevance_desc}
        </p>
      )}

      {/* 查看原文链接 */}
      {doc.url && (
        <a
          href={doc.url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline mb-2"
        >
          <ExternalLink size={12} />
          查看原文
        </a>
      )}

      {/* 操作按钮 */}
      <div className="flex items-center gap-1.5 mt-2">
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'h-8 px-2.5 rounded-lg',
            doc.user_rating === 'useful'
              ? 'text-emerald-600 bg-[#34c759]/[0.08] hover:bg-[#34c759]/[0.12]'
              : 'text-muted-foreground hover:text-emerald-600 hover:bg-emerald-50'
          )}
          onClick={(e) => { e.stopPropagation(); handleRate('useful') }}
        >
          <ThumbsUp size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'h-8 px-2.5 rounded-lg',
            doc.user_rating === 'irrelevant'
              ? 'text-red-600 bg-destructive/10 hover:bg-destructive/15'
              : 'text-muted-foreground hover:text-red-600 hover:bg-red-50'
          )}
          onClick={(e) => { e.stopPropagation(); handleRate('irrelevant') }}
        >
          <ThumbsDown size={14} />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className={cn(
            'h-8 px-2.5 rounded-lg ml-auto',
            showNote || note ? 'text-primary' : 'text-muted-foreground'
          )}
          onClick={(e) => { e.stopPropagation(); setShowNote(!showNote) }}
        >
          <MessageSquare size={14} />
        </Button>
      </div>

      {/* 备注输入框 */}
      {showNote && (
        <div className="mt-2.5" onClick={(e) => e.stopPropagation()}>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="添加备注..."
            className="text-xs min-h-[60px] rounded-xl"
            rows={2}
          />
          <div className="flex justify-end gap-1.5 mt-1.5">
            <Button size="sm" variant="ghost" className="h-7 text-xs rounded-lg" onClick={() => setShowNote(false)}>
              取消
            </Button>
            <Button size="sm" className="h-7 text-xs rounded-lg" onClick={handleNoteSave} disabled={saving}>
              {saving ? '保存中...' : '保存'}
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
