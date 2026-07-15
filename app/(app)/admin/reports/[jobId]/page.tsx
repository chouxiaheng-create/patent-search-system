// app/(app)/admin/reports/[jobId]/page.tsx
// Admin 视角查看任意用户的报告（不受原作者 user_id 限制）
// 用 service_role 直读 + 服务端鉴权

import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { ReportView } from '@/components/report/report-view'

type Params = { jobId: string }

export default async function AdminReportPage({
  params,
}: { params: Promise<Params> }) {
  const { jobId } = await params

  // 1. 鉴权：必须 admin
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

  // 2. service_role 直读（不受 RLS 限制，能看任意用户的报告）
  const admin = createServiceClient()

  const { data: jobData, error: jobErr } = await admin
    .from('search_jobs')
    .select('id, document_id, user_id, status')
    .eq('id', jobId)
    .single()
  if (jobErr || !jobData) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-red-600">任务不存在（jobId={jobId.slice(0, 8)}…）</p>
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">← 返回用户列表</Link>
      </div>
    )
  }

  // 查报告（按 created_at desc 取最新一份）
  const { data: reportData, error: reportErr } = await admin
    .from('reports')
    .select('id, job_id, user_id, html_content, selected_docs, doc_count, path_summary, created_at')
    .eq('job_id', jobId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (reportErr) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-red-600">报告查询失败：{reportErr.message}</p>
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">← 返回用户列表</Link>
      </div>
    )
  }

  if (!reportData) {
    return (
      <div className="p-8 space-y-3">
        <p className="text-[#64748b]">该任务尚未生成报告（可能还在检索中）</p>
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">← 返回用户列表</Link>
      </div>
    )
  }

  // 附带查文档标题（用于报告头部展示）
  let document: { id: string; title: string } | undefined
  if (jobData.document_id) {
    const { data: docData } = await admin
      .from('patent_documents')
      .select('id, title')
      .eq('id', jobData.document_id)
      .single()
    if (docData) document = docData
  }

  // 确保 selected_docs 有 user_note 字段（与用户端 viewer 兼容）
  const docs = (reportData.selected_docs || []).map((doc: Record<string, unknown>) => ({
    ...doc,
    user_note: (doc as { user_note?: string }).user_note || '',
  }))

  return (
    <div>
      <div className="px-6 lg:px-10 pt-4 pb-2 text-sm text-muted-foreground space-x-3 border-b">
        <Link href="/admin/users" className="hover:underline">← 用户列表</Link>
        <span className="text-xs">| 管理员视图 · jobId={jobId.slice(0, 8)}… · userId={jobData.user_id.slice(0, 8)}…</span>
      </div>
      <ReportView
        report={{
          id: reportData.id,
          job_id: reportData.job_id,
          user_id: reportData.user_id,
          html_content: reportData.html_content,
          selected_docs: docs,
          doc_count: reportData.doc_count ?? 0,
          path_summary: reportData.path_summary,
          created_at: reportData.created_at,
          document,
        }}
      />
    </div>
  )
}
