// components/report/report-preview.tsx
'use client'

interface ReportPreviewProps {
  htmlContent: string
  title?: string
}

export function ReportPreview({ htmlContent, title }: ReportPreviewProps) {
  return (
    <div className="h-full flex flex-col">
      {title && (
        <div className="p-4 border-b border-slate-200 bg-white">
          <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
        </div>
      )}
      <div className="flex-1 overflow-auto bg-slate-50 p-4">
        <iframe
          srcDoc={htmlContent}
          className="w-full h-full min-h-[600px] bg-white rounded-lg shadow-sm border border-slate-200"
          title="报告预览"
          sandbox="allow-same-origin"
        />
      </div>
    </div>
  )
}
