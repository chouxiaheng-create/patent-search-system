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
  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">任务摘要</h3>
          <div className="flex items-center gap-2">
            {isAuto && <Badge variant="secondary" className="text-blue-600 bg-blue-50">自动挡</Badge>}
            {isAuto && onEditConfig && <button type="button" onClick={onEditConfig} className="text-xs text-blue-600 hover:underline">修改配置 →</button>}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div><p className="text-2xl font-bold text-slate-800">{searchModels.length}</p><p className="text-xs text-slate-500">检索平台</p></div>
          <div><p className="text-2xl font-bold text-slate-800">{strategies.length}</p><p className="text-xs text-slate-500">检索策略</p></div>
          <div><p className="text-2xl font-bold text-blue-600">{searchModels.length * strategies.length}</p><p className="text-xs text-slate-500">子任务总数</p></div>
        </div>
        <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
          <div><span className="text-slate-400">解析模型：</span>{parseModelName}</div>
          <div><span className="text-slate-400">汇总模型：</span>{reportModelName}</div>
          <div><span className="text-slate-400">每路径文献数：</span>{perTaskLimit}</div>
          <div><span className="text-slate-400">报告输出文献数：</span>{reportLimit}</div>
        </div>
      </CardContent>
    </Card>
  )
}
