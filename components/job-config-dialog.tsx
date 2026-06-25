'use client'

import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { Settings, Layers, FileText, Sliders } from 'lucide-react'

interface JobConfigDialogProps {
  open: boolean
  onOpenChange: (v: boolean) => void
  config: {
    model_ids: string[]
    strategy_ids: string[]
    per_task_limit: number
    report_limit: number
    report_model_id: string
    report_system_prompt?: string
    model_feature_overrides?: Array<{
      model_id: string
      enable_thinking: boolean
      enable_web_search: boolean
    }>
  }
  modelNames: Map<string, string>
  strategyNames: Map<string, string>
  reportModelName: string
}

export function JobConfigDialog({
  open, onOpenChange, config, modelNames, strategyNames, reportModelName,
}: JobConfigDialogProps) {
  const overrides = new Map(
    (config.model_feature_overrides ?? []).map(o => [o.model_id, o])
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Settings size={18} />
            检索配置详情
          </DialogTitle>
        </DialogHeader>
          <DialogDescription className="text-xs text-muted-foreground">
            当前检索任务所配置的模型、策略及参数概览
          </DialogDescription>

        <div className="space-y-5 py-2">
          {/* 检索平台 */}
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Layers size={13} />
              检索平台（{config.model_ids.length} 个）
            </div>
            <div className="space-y-1.5">
              {config.model_ids.map(id => {
                const override = overrides.get(id)
                return (
                  <div key={id} className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-foreground">{modelNames.get(id) ?? id}</span>
                    {override && (
                      <div className="flex gap-1">
                        {override.enable_thinking && (
                          <Badge className="text-[10px] bg-[#af52de]/[0.08] text-[#af52de] border-[#af52de]/20">深度思考</Badge>
                        )}
                        {override.enable_web_search && (
                          <Badge className="text-[10px] bg-primary/10 text-primary border-primary/20">联网搜索</Badge>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </section>

          {/* 检索策略 */}
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <FileText size={13} />
              检索策略（{config.strategy_ids.length} 个）
            </div>
            <div className="flex flex-wrap gap-1.5">
              {config.strategy_ids.map(id => (
                <Badge key={id} variant="outline" className="text-xs border-border text-foreground">
                  {strategyNames.get(id) ?? id}
                </Badge>
              ))}
            </div>
          </section>

          {/* 参数配置 */}
          <section className="space-y-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              <Sliders size={13} />
              参数配置
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-muted rounded-xl p-3">
                <p className="text-xs text-muted-foreground">每路径备选文献数</p>
                <p className="text-lg font-bold text-foreground">{config.per_task_limit}</p>
              </div>
              <div className="bg-muted rounded-xl p-3">
                <p className="text-xs text-muted-foreground">报告输出文献数</p>
                <p className="text-lg font-bold text-foreground">{config.report_limit}</p>
              </div>
              <div className="col-span-2 bg-muted rounded-xl p-3">
                <p className="text-xs text-muted-foreground">汇总模型</p>
                <p className="text-sm font-medium text-foreground">{reportModelName}</p>
              </div>
            </div>
          </section>

          {/* 子任务矩阵 */}
          <section className="space-y-2">
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              子任务矩阵（{config.model_ids.length} × {config.strategy_ids.length} = {config.model_ids.length * config.strategy_ids.length} 条路径）
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="text-left py-1.5 pr-2 text-muted-foreground font-medium">平台 \ 策略</th>
                    {config.strategy_ids.map(sId => (
                      <th key={sId} className="text-center py-1.5 px-2 text-muted-foreground font-medium">
                        {strategyNames.get(sId) ?? sId}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {config.model_ids.map(mId => (
                    <tr key={mId}>
                      <td className="py-1.5 pr-2 font-medium text-foreground">{modelNames.get(mId) ?? mId}</td>
                      {config.strategy_ids.map(sId => (
                        <td key={sId} className="text-center py-1.5 px-2">
                          <span className="inline-block w-2 h-2 rounded-full bg-primary" />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {/* 报告提示词 */}
          {config.report_system_prompt && (
            <section className="space-y-2">
              <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">报告生成提示词</div>
              <div className="bg-muted rounded-xl p-3 text-xs text-foreground/70 font-mono whitespace-pre-wrap max-h-32 overflow-y-auto">
                {config.report_system_prompt}
              </div>
            </section>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
