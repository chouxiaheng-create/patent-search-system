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
        <div className="p-4 border-b border-white/[0.08] bg-white">
          <h2 className="text-sm font-semibold text-foreground">{title}</h2>
        </div>
      )}
      <div className="flex-1 overflow-auto bg-muted p-4">
        <iframe
          srcDoc={htmlContent}
          className="w-full h-full min-h-[600px] bg-white rounded-xl shadow-sm border border-white/[0.08]"
          title="报告预览"
          sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        />
      </div>
    </div>
  )
}
