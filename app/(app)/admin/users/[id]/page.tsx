// app/(app)/admin/users/[id]/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { DetailActions } from './detail-actions'
import { DetailReportPicker } from './detail-report-picker'
import { SectionPagination } from '@/components/admin/section-pagination'

const DEFAULT_PAGE_SIZE = 10
const ALLOWED_SIZES = [10, 20, 50]

function clampInt(raw: string | undefined, def: number, allowed?: number[]): number {
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) return def
  if (allowed && !allowed.includes(n)) return def
  return Math.floor(n)
}

export default async function AdminUserDetailPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{
    docsPage?: string; docsSize?: string
    jobsPage?: string; jobsSize?: string
    reportsPage?: string; reportsSize?: string
  }>
}) {
  const [{ id }, sp] = await Promise.all([params, searchParams])

  const docsPage    = clampInt(sp.docsPage,    1)
  const docsSize    = clampInt(sp.docsSize,    DEFAULT_PAGE_SIZE, ALLOWED_SIZES)
  const jobsPage    = clampInt(sp.jobsPage,    1)
  const jobsSize    = clampInt(sp.jobsSize,    DEFAULT_PAGE_SIZE, ALLOWED_SIZES)
  const reportsPage = clampInt(sp.reportsPage, 1)
  const reportsSize = clampInt(sp.reportsSize, DEFAULT_PAGE_SIZE, ALLOWED_SIZES)

  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()
  const user = authData?.user
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return <div className="p-8 text-red-600">需要管理员权限</div>
  }

  const admin = createServiceClient()
  const docsFrom = (docsPage - 1) * docsSize
  const jobsFrom = (jobsPage - 1) * jobsSize
  const reportsFrom = (reportsPage - 1) * reportsSize

  const [profileR, docsR, jobsR, reportsR] = await Promise.all([
    admin.from('profiles').select('id, email, role, created_at').eq('id', id).single(),
    admin.from('patent_documents')
      .select('id, title, parse_status, file_type, created_at', { count: 'exact' })
      .eq('user_id', id).order('created_at', { ascending: false })
      .range(docsFrom, docsFrom + docsSize - 1),
    admin.from('search_jobs')
      .select('id, status, scheduled_at, started_at, completed_at, created_at', { count: 'exact' })
      .eq('user_id', id).order('created_at', { ascending: false })
      .range(jobsFrom, jobsFrom + jobsSize - 1),
    admin.from('reports')
      .select('id, job_id, doc_count, created_at', { count: 'exact' })
      .eq('user_id', id).order('created_at', { ascending: false })
      .range(reportsFrom, reportsFrom + reportsSize - 1),
  ])

  if (profileR.error || !profileR.data) {
    return <div className="p-8 text-red-600">用户不存在</div>
  }

  type DocRow    = { id: string; title: string; parse_status: string; file_type: string; created_at: string }
  type JobRow    = { id: string; status: string; created_at: string }
  type ReportRow = { id: string; job_id: string; created_at: string }

  const fmtDate = (iso: string) => new Date(iso).toLocaleString('zh-CN')
  const u = profileR.data

  const docsTotal = docsR.count ?? 0
  const jobsTotal = jobsR.count ?? 0
  const reportsTotal = reportsR.count ?? 0

  const sharedPreserve = {
    ...(sp.docsSize    ? { docsSize: sp.docsSize }    : {}),
    ...(sp.docsPage    ? { docsPage: sp.docsPage }    : {}),
    ...(sp.jobsSize    ? { jobsSize: sp.jobsSize }    : {}),
    ...(sp.jobsPage    ? { jobsPage: sp.jobsPage }    : {}),
    ...(sp.reportsSize ? { reportsSize: sp.reportsSize } : {}),
    ...(sp.reportsPage ? { reportsPage: sp.reportsPage } : {}),
  }

  return (
    <div className="p-6 lg:p-10 max-w-6xl space-y-6">
      <div>
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">← 返回用户列表</Link>
      </div>

      <div className="border rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{u.email}</h1>
            <p className="text-sm text-muted-foreground mt-1">注册于 {fmtDate(u.created_at)}</p>
          </div>
          <DetailActions userId={u.id} currentRole={u.role} />
        </div>
        <div className="text-sm">
          当前角色：<strong>{u.role === 'admin' ? '管理员' : '普通用户'}</strong>
        </div>
      </div>

      <Section title="上传的专利" count={docsTotal} rangeHint={docsR.data?.length}>
        <ul className="divide-y">
          {(docsR.data ?? []).map((d: DocRow) => (
            <li key={d.id} className="py-2 flex justify-between text-sm">
              <span className="truncate mr-3">{d.title}</span>
              <span className="text-muted-foreground whitespace-nowrap">{d.parse_status} · {fmtDate(d.created_at)}</span>
            </li>
          ))}
          {docsTotal === 0 && <li className="py-4 text-sm text-muted-foreground">无</li>}
        </ul>
        <SectionPagination
          total={docsTotal}
          currentPage={docsPage}
          pageSize={docsSize}
          pageKey="docsPage"
          sizeKey="docsSize"
          preserve={sharedPreserve}
        />
      </Section>

      <Section title="检索任务" count={jobsTotal} rangeHint={jobsR.data?.length}>
        <ul className="divide-y">
          {(jobsR.data ?? []).map((j: JobRow) => (
            <li key={j.id} className="py-2 flex justify-between text-sm">
              <Link href={`/admin/reports/${j.id}`} className="hover:underline truncate mr-3">任务 #{j.id.slice(0, 8)}</Link>
              <span className="text-muted-foreground whitespace-nowrap">{j.status} · {fmtDate(j.created_at)}</span>
            </li>
          ))}
          {jobsTotal === 0 && <li className="py-4 text-sm text-muted-foreground">无</li>}
        </ul>
        <SectionPagination
          total={jobsTotal}
          currentPage={jobsPage}
          pageSize={jobsSize}
          pageKey="jobsPage"
          sizeKey="jobsSize"
          preserve={sharedPreserve}
        />
      </Section>

      <Section title="报告" count={reportsTotal} rangeHint={reportsR.data?.length}>
        <DetailReportPicker
          userId={u.id}
          pageReports={(reportsR.data ?? []).map((r: ReportRow) => ({
            id: r.id,
            job_id: r.job_id,
            created_at: r.created_at,
          }))}
        />
        <SectionPagination
          total={reportsTotal}
          currentPage={reportsPage}
          pageSize={reportsSize}
          pageKey="reportsPage"
          sizeKey="reportsSize"
          preserve={sharedPreserve}
        />
      </Section>
    </div>
  )
}

function Section({ title, count, rangeHint, children }: {
  title: string; count: number; rangeHint?: number; children: React.ReactNode
}) {
  return (
    <section className="border rounded-xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-sm text-muted-foreground">{count} 条</span>
      </div>
      {children}
    </section>
  )
}