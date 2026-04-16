// app/(app)/dashboard/page.tsx
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { FileText, Clock, CheckCircle2, AlertCircle, XCircle, Loader2 } from 'lucide-react'
import type { JobStatus } from '@/lib/supabase/types'

const statusConfig: Record<JobStatus, { label: string; color: string; icon: React.ReactNode }> = {
  queued: { label: '排队中', color: 'bg-slate-100 text-slate-700 border-slate-200', icon: <Clock size={12} /> },
  running: { label: '执行中', color: 'bg-blue-100 text-blue-700 border-blue-200', icon: <Loader2 size={12} className="animate-spin" /> },
  completed: { label: '已完成', color: 'bg-green-100 text-green-700 border-green-200', icon: <CheckCircle2 size={12} /> },
  failed: { label: '失败', color: 'bg-red-100 text-red-700 border-red-200', icon: <AlertCircle size={12} /> },
  cancelled: { label: '已取消', color: 'bg-slate-100 text-slate-500 border-slate-200', icon: <XCircle size={12} /> },
}

function formatDate(dateStr: string | null) {
  if (!dateStr) return '-'
  return new Date(dateStr).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) return null

  // Fetch user's jobs with document info
  const { data: jobs } = await supabase
    .from('search_jobs')
    .select(`
      id,
      status,
      created_at,
      started_at,
      completed_at,
      scheduled_at,
      document:patent_documents (
        title
      )
    `)
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .limit(20)

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-semibold text-slate-800">我的检索任务</h2>
        <Button asChild>
          <Link href="/search/new/step-1">新建检索</Link>
        </Button>
      </div>

      {!jobs || jobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText size={48} className="mx-auto text-slate-300 mb-4" />
            <p className="text-slate-500 mb-2">暂无检索任务</p>
            <p className="text-sm text-slate-400">点击上方按钮创建第一个专利检索任务</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => {
            const config = statusConfig[job.status as JobStatus]
            const docTitle = job.document && typeof job.document === 'object' && 'title' in job.document
              ? String(job.document.title)
              : '未知文档'

            return (
              <Card key={job.id} className="hover:shadow-md transition-shadow">
                <CardContent className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-medium text-slate-800 truncate">{docTitle}</h3>
                        <Badge
                          variant="outline"
                          className={`flex items-center gap-1 ${config.color}`}
                        >
                          {config.icon}
                          {config.label}
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-500">
                        创建于 {formatDate(job.created_at)}
                        {job.started_at && ` · 开始于 ${formatDate(job.started_at)}`}
                      </p>
                    </div>
                    <Button asChild variant="outline" size="sm">
                      <Link href={`/search/${job.id}/progress`}>
                        查看进度
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
