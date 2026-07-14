// app/(app)/admin/users/[id]/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { DetailActions } from './detail-actions'

export default async function AdminUserDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params

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

  // 服务端拉三栏元数据（admin 客户端，RLS 自动放行）
  const admin = createServiceClient()
  const [profileR, docsR, jobsR, reportsR] = await Promise.all([
    admin.from('profiles').select('id, email, role, created_at').eq('id', id).single(),
    admin.from('patent_documents').select('id, filename, status, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    admin.from('search_jobs').select('id, title, status, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    admin.from('reports').select('id, job_id, created_at').eq('user_id', id).order('created_at', { ascending: false }),
  ])

  if (profileR.error || !profileR.data) {
    return <div className="p-8 text-red-600">用户不存在</div>
  }

  type DocRow = { id: string; filename: string; status: string; created_at: string }
  type JobRow = { id: string; title: string; status: string; created_at: string }
  type ReportRow = { id: string; job_id: string; created_at: string }

  const fmtDate = (iso: string) => new Date(iso).toLocaleString('zh-CN')
  const u = profileR.data

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

      <Section title="上传的专利" count={docsR.data?.length ?? 0}>
        <ul className="divide-y">
          {(docsR.data ?? []).map((d: DocRow) => (
            <li key={d.id} className="py-2 flex justify-between text-sm">
              <span>{d.filename}</span>
              <span className="text-muted-foreground">{d.status} · {fmtDate(d.created_at)}</span>
            </li>
          ))}
          {(docsR.data ?? []).length === 0 && <li className="py-4 text-sm text-muted-foreground">无</li>}
        </ul>
      </Section>

      <Section title="检索任务" count={jobsR.data?.length ?? 0}>
        <ul className="divide-y">
          {(jobsR.data ?? []).map((j: JobRow) => (
            <li key={j.id} className="py-2 flex justify-between text-sm">
              <Link href={`/search/${j.id}/report`} className="hover:underline">{j.title}</Link>
              <span className="text-muted-foreground">{j.status} · {fmtDate(j.created_at)}</span>
            </li>
          ))}
          {(jobsR.data ?? []).length === 0 && <li className="py-4 text-sm text-muted-foreground">无</li>}
        </ul>
      </Section>

      <Section title="报告" count={reportsR.data?.length ?? 0}>
        <ul className="divide-y">
          {(reportsR.data ?? []).map((r: ReportRow) => (
            <li key={r.id} className="py-2 flex justify-between text-sm">
              <Link href={`/search/${r.job_id}/report`} className="hover:underline">报告 #{r.id.slice(0, 8)}</Link>
              <span className="text-muted-foreground">{fmtDate(r.created_at)}</span>
            </li>
          ))}
          {(reportsR.data ?? []).length === 0 && <li className="py-4 text-sm text-muted-foreground">无</li>}
        </ul>
      </Section>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
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
