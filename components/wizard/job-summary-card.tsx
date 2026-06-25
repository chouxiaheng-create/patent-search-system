import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { AIModel, SearchStrategy } from '@/lib/supabase/types'

interface JobSummaryCardProps {
  searchModels: AIModel[]; strategies: SearchStrategy[]
  parseModelName: string; reportModelName: string
  perTaskLimit: number; reportLimit: number
  isAuto?: boolean; onEditConfig?: () => void
}

export function JobSummaryCard({ searchModels, strategies, parseModelName, reportModelName, perTaskLimit, reportLimit, isAuto = false, onEditConfig }: JobSummaryCardProps) {
  const taskTotal = searchModels.length * strategies.length
  return (
    <Card className="card-apple overflow-hidden">
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground tracking-tight">任务摘要</h3>
          <div className="flex items-center gap-2">
            {isAuto && <Badge variant="secondary" className="text-primary bg-primary/[0.06] border-none font-medium">自动挡</Badge>}
            {isAuto && onEditConfig && <button type="button" onClick={onEditConfig} className="text-xs font-medium text-primary hover:underline">修改配置 →</button>}
          </div>
        </div>
        <div className="grid grid-cols-3 text-center">
          <div className="space-y-0.5">
            <p className="text-3xl font-bold text-foreground tracking-tight">{searchModels.length}</p>
            <p className="text-xs font-medium text-muted-foreground">检索平台</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-3xl font-bold text-foreground tracking-tight">{strategies.length}</p>
            <p className="text-xs font-medium text-muted-foreground">检索策略</p>
          </div>
          <div className="space-y-0.5">
            <p className="text-3xl font-bold text-primary tracking-tight">{taskTotal}</p>
            <p className="text-xs font-medium text-muted-foreground">子任务总数</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5 text-sm">
          <div className="flex items-center gap-1.5"><span className="text-muted-foreground text-xs">解析模型</span><span className="font-medium text-foreground">{parseModelName}</span></div>
          <div className="flex items-center gap-1.5"><span className="text-muted-foreground text-xs">汇总模型</span><span className="font-medium text-foreground">{reportModelName}</span></div>
          <div className="flex items-center gap-1.5"><span className="text-muted-foreground text-xs">每路径文献数</span><span className="font-medium text-foreground">{perTaskLimit}</span></div>
          <div className="flex items-center gap-1.5"><span className="text-muted-foreground text-xs">报告输出文献数</span><span className="font-medium text-foreground">{reportLimit}</span></div>
        </div>
      </CardContent>
    </Card>
  )
}
