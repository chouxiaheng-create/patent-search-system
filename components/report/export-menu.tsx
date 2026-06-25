// components/report/export-menu.tsx
'use client'

import { useState } from 'react'
import { Download, FileText, FileDown, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { toast } from 'sonner'

interface ExportMenuProps {
  reportId: string
}

export function ExportMenu({ reportId }: ExportMenuProps) {
  const [exporting, setExporting] = useState(false)

  const handleExport = async (format: 'markdown' | 'docx') => {
    setExporting(true)
    try {
      const response = await fetch(`/api/reports/${reportId}/export?format=${format}`)
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: '导出失败' }))
        throw new Error(err.error || `HTTP ${response.status}`)
      }

      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `patent-report.${format === 'markdown' ? 'md' : 'docx'}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      toast.success(`已导出 ${format === 'markdown' ? 'Markdown' : 'Word'} 文件`)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : '导出失败'
      toast.error('导出失败', { description: message })
    } finally {
      setExporting(false)
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" disabled={exporting}>
          {exporting ? (
            <Loader2 size={14} className="mr-1 animate-spin" />
          ) : (
            <Download size={14} className="mr-1" />
          )}
          导出
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('markdown')} disabled={exporting}>
          <FileText size={14} className="mr-2" />
          导出 Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('docx')} disabled={exporting}>
          <FileDown size={14} className="mr-2" />
          导出 Word
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}