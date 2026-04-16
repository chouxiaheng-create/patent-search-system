'use client'

import { useRef, useState } from 'react'
import { Upload, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const ACCEPTED = '.pdf,.docx,.xlsx,.txt'
const ACCEPTED_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain']
const MAX_MB = 20

interface FileUploadZoneProps {
  onFileSelect: (file: File) => Promise<void>
  uploading: boolean; uploadProgress?: number; disabled?: boolean
}

export function FileUploadZone({ onFileSelect, uploading, uploadProgress = 0, disabled = false }: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function validate(file: File): string | null {
    if (!ACCEPTED_TYPES.includes(file.type) && !file.name.match(/\.(pdf|docx|xlsx|txt)$/i))
      return '仅支持 PDF、Word (.docx)、Excel (.xlsx) 和 TXT 文件'
    if (file.size > MAX_MB * 1024 * 1024) return `文件大小不能超过 ${MAX_MB}MB`
    return null
  }

  async function handle(file: File) {
    const err = validate(file)
    if (err) { setError(err); return }
    setError(null)
    await onFileSelect(file)
  }

  return (
    <div>
      <div role="button" tabIndex={0} aria-label="上传专利文件"
        onDragOver={e => { e.preventDefault(); if (!disabled && !uploading) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); if (!disabled && !uploading) { const f = e.dataTransfer.files[0]; if (f) handle(f) } }}
        onClick={() => { if (!disabled && !uploading) inputRef.current?.click() }}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
        className={cn('border-2 border-dashed rounded-lg p-8 text-center transition-colors',
          dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300',
          (disabled || uploading) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-blue-400 hover:bg-slate-50'
        )}>
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="animate-spin text-blue-600" size={32} />
            <p className="text-sm text-slate-600">上传中... {uploadProgress}%</p>
            <div className="w-48 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
              <Upload className="text-blue-600" size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">点击或拖拽文件到此处</p>
              <p className="text-xs text-slate-500 mt-1">支持 PDF、Word、Excel、TXT，单文件 ≤ 20MB</p>
            </div>
          </div>
        )}
      </div>
      <input ref={inputRef} type="file" accept={ACCEPTED} className="hidden"
        onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); e.target.value = '' }}
        disabled={disabled || uploading} />
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  )
}
