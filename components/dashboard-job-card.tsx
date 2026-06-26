'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { CancelJobButton } from '@/components/cancel-job-button'
import { RetryJobButton } from '@/components/retry-job-button'
import { RetryFailedTasksButton } from '@/components/retry-failed-tasks-button'
import { JobConfigDialog } from '@/components/job-config-dialog'
import { Clock, CheckCircle2, AlertCircle, XCircle, Loader2, BarChart3, Settings } from 'lucide-react'
import type { JobStatus } from '@/lib/supabase/types'

const statusConfig: Record<JobStatus, { label: string; color: string; icon: React.ReactNode }> = {
  queued: { label: '排队中', color: 'bg-[#ff9500]/[0.08] text-amber-600 border-[#ff9500]/20', icon: <Clock size={12} /> },
  running: { label: '执行中', color: 'bg-primary/10 text-primary border-primary/20', icon: <Loader2 size={12} className="animate-spin" /> },
  completed: { label: '已完成', color: 'bg-[#34c759]/[0.08] text-emerald-600 border-[#34c759]/20', icon: <CheckCircle2 size={12} /> },
  failed: { label: '失败', color: 'bg-destructive/10 text-red-600 border-destructive/20', icon: <AlertCircle size={12} /> },
  cancelled: { label: '已取消', color: 'bg-muted text-muted-foreground border-border', icon: <XCircle size={12} /> },
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })
}

interface JobCardProps {
  job: {
    id: string
    status: string
    created_at: string | null
    config: {
      model_ids: string[]
      strategy_ids: string[]
      per_task_limit: number
      report_limit: number
      report_model_id: string
      report_system_prompt?: string
      model_feature_overrides?: Array<{ model_id: string; enable_thinking: boolean; enable_web_search: boolean }>
    }
  }
  docTitle: string
  tasks: Array<{ status: string; results: unknown[] | null; model_id: string; strategy_id: string }>
  totalResults: number
  platformNames: string[]
  strategyNames: string[]
  modelNameMap: Map<string, string>
  strategyNameMap: Map<string, string>
  reportModelName: string
}

export function DashboardJobCard({
  job, docTitle, tasks, totalResults, platformNames, strategyNames,
  modelNameMap, strategyNameMap, reportModelName,
}: JobCardProps) {
  const [configOpen, setConfigOpen] = useState(false)
  const config = statusConfig[job.status as JobStatus]
  const totalTasks = tasks.length
  const doneTasks = tasks.filter(t => t.status === 'done').length
  // 是否存在可部分重试的子任务（非 done），用于显示"重试失败项"
  const hasNonDoneTasks = tasks.some(t => t.status !== 'done')

  return (
    <>
      <Card className="card-apple card-apple-hover">
        <CardContent className="p-4">
          <div className="flex items-center gap-4">
            <div className="flex-1 min-w-0">
              {/* 标题行 */}
              <div className="flex items-center gap-2 mb-1.5">
                <h3 className="font-medium text-foreground truncate">{docTitle}</h3>
                <Badge variant="outline" className={`flex items-center gap-1 shrink-0 ${config.color}`}>
                  {config.icon}
                  {config.label}
                </Badge>
              </div>

              {/* 平台和策略标签 */}
              {tasks.length > 0 && (
                <div className="flex items-center gap-1.5 mb-1.5 flex-wrap">
                  {platformNames.map(name => (
                    <span key={name} className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground rounded-md">{name}</span>
                  ))}
                  {platformNames.length > 0 && strategyNames.length > 0 && (
                    <span className="text-xs text-muted-foreground/50">×</span>
                  )}
                  {strategyNames.map(name => (
                    <span key={name} className="text-xs px-1.5 py-0.5 bg-muted text-muted-foreground rounded-md">{name}</span>
                  ))}
                </div>
              )}

              {/* 进度条 */}
              {(job.status === 'running' || job.status === 'queued') && totalTasks > 0 && (
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden max-w-48">
                    <div
                      className="h-full bg-primary rounded-full transition-all duration-500"
                      style={{ width: `${totalTasks > 0 ? (doneTasks / totalTasks) * 100 : 0}%` }}
                    />
                  </div>
                  <span className="text-xs text-muted-foreground">{doneTasks}/{totalTasks}</span>
                </div>
              )}

              {/* 底部信息 */}
              <div className="flex items-center gap-3 text-xs text-muted-foreground">
                <span>创建于 {formatDate(job.created_at)}</span>
                {job.status === 'completed' && totalResults > 0 && (
                  <span className="flex items-center gap-1">
                    <BarChart3 size={11} />
                    {totalResults} 篇文献
                  </span>
                )}
              </div>
            </div>

            {/* 操作按钮 */}
            <div className="flex items-center gap-2 shrink-0">
              <Button asChild variant="ghost" size="sm" className="rounded-xl text-muted-foreground" title="查看检索配置">
                <Settings size={14} />
              </Button>
              {(job.status === 'queued' || job.status === 'running') && (
                <CancelJobButton jobId={job.id} />
              )}
              {(job.status === 'failed' || job.status === 'cancelled') && (
                <RetryJobButton jobId={job.id} />
              )}
              {((job.status === 'completed' || job.status === 'failed') && hasNonDoneTasks) && (
                <RetryFailedTasksButton jobId={job.id} />
              )}
              {job.status === 'completed' && (
                <Button asChild variant="default" size="sm" className="rounded-xl">
                  <Link href={`/search/${job.id}/report`}>查看报告</Link>
                </Button>
              )}
              <Button asChild variant="outline" size="sm" className="rounded-xl">
                <Link href={`/search/${job.id}/progress`}>查看进度</Link>
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <JobConfigDialog
        open={configOpen}
        onOpenChange={setConfigOpen}
        config={job.config}
        modelNames={modelNameMap}
        strategyNames={strategyNameMap}
        reportModelName={reportModelName}
      />
    </>
  )
}
