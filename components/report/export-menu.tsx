// components/report/export-menu.tsx
'use client'

import { Download, FileText, FileDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

interface ExportMenuProps {
  reportId: string
}

export function ExportMenu({ reportId }: ExportMenuProps) {
  const handleExport = async (format: 'markdown' | 'docx') => {
    const response = await fetch(`/api/reports/${reportId}/export?format=${format}`)
    if (!response.ok) return

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `patent-report.${format === 'markdown' ? 'md' : 'docx'}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Download size={14} className="mr-1" />
          导出
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport('markdown')}>
          <FileText size={14} className="mr-2" />
          导出 Markdown
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport('docx')}>
          <FileDown size={14} className="mr-2" />
          导出 Word
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
