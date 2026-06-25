// app/(app)/dashboard/page.tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Search } from 'lucide-react'
import { DashboardJobCard } from '@/components/dashboard-job-card'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  // Fetch user's jobs with config
  const { data: jobs } = await supabase
    .from('search_jobs')
    .select(`
      id, status, created_at, started_at, completed_at, scheduled_at, config,
      document:patent_documents ( title )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  const jobIds = (jobs || []).map(j => j.id)

  // Fetch task summaries
  const { data: taskSummaries } = jobIds.length > 0
    ? await supabase.from('search_tasks').select('job_id, status, results, model_id, strategy_id').in('job_id', jobIds)
    : { data: [] as Record<string, unknown>[] }

  // Fetch model and strategy names
  const allModelIds = [...new Set((taskSummaries || []).map(t => t.model_id))]
  const allStrategyIds = [...new Set((taskSummaries || []).map(t => t.strategy_id))]

  // Also fetch report model names from job configs
  const reportModelIds = [...new Set((jobs || []).map(j => j.config?.report_model_id).filter(Boolean))]
  const combinedModelIds = [...new Set([...allModelIds, ...reportModelIds])]

  const [{ data: modelNames }, { data: strategyNames }] = await Promise.all([
    combinedModelIds.length > 0 ? supabase.from('ai_models').select('id, name').in('id', combinedModelIds) : { data: [] as Record<string, unknown>[] },
    allStrategyIds.length > 0 ? supabase.from('search_strategies').select('id, name').in('id', allStrategyIds) : { data: [] as Record<string, unknown>[] },
  ])
  const modelNameMap = new Map((modelNames || []).map(m => [m.id, m.name]))
  const strategyNameMap = new Map((strategyNames || []).map(s => [s.id, s.name]))

  // Group tasks by job_id
  const tasksByJob = new Map<string, Record<string, unknown>[]>()
  for (const task of taskSummaries || []) {
    if (!tasksByJob.has(task.job_id)) tasksByJob.set(task.job_id, [])
    tasksByJob.get(task.job_id)!.push(task)
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-foreground">我的检索任务</h2>
        <Button asChild className="rounded-xl">
          <Link href="/search/new/step-1">新建检索</Link>
        </Button>
      </div>

      {!jobs || jobs.length === 0 ? (
        <Card className="card-apple">
          <CardContent className="py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
              <Search size={28} className="text-primary" />
            </div>
            <p className="text-foreground font-medium mb-1">暂无检索任务</p>
            <p className="text-sm text-muted-foreground mb-5">点击上方按钮创建第一个专利检索任务</p>
            <Button asChild className="rounded-xl">
              <Link href="/search/new/step-1">开始检索</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const docTitle = job.document && typeof job.document === 'object' && 'title' in job.document
              ? String(job.document.title) : '未知文档'

            const tasks = tasksByJob.get(job.id) || []
            const totalResults = tasks.reduce((sum, t) => sum + (Array.isArray(t.results) ? t.results.length : 0), 0)
            const platformNames = [...new Set(tasks.map(t => modelNameMap.get(t.model_id) as string).filter(Boolean))].slice(0, 2)
            const strategyNames = [...new Set(tasks.map(t => strategyNameMap.get(t.strategy_id) as string).filter(Boolean))].slice(0, 2)
            const reportModelName = modelNameMap.get(job.config?.report_model_id) ?? '未知模型'

            return (
              <DashboardJobCard
                key={job.id}
                job={job}
                docTitle={docTitle}
                tasks={tasks as Array<{ status: string; results: unknown[] | null; model_id: string; strategy_id: string }>}
                totalResults={totalResults}
                platformNames={platformNames}
                strategyNames={strategyNames}
                modelNameMap={modelNameMap}
                strategyNameMap={strategyNameMap}
                reportModelName={reportModelName}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
