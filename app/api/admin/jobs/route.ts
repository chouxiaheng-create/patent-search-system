// app/api/admin/jobs/route.ts
// GET: 全量检索任务列表（联表用户邮箱/文档标题 + 子任务进度聚合）
// 仅 admin 可访问（requireAdmin 校验）。

import { NextRequest, NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { requireAdmin, ApiError } from '../require-admin'

const VALID_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled']

export const GET = withApiHandler(async (request: NextRequest) => {
  const { admin } = await requireAdmin()

  const sp = new URL(request.url).searchParams
  const status = sp.get('status')?.trim() ?? ''
  const email = sp.get('email')?.trim() ?? ''
  const page = Math.max(1, Number(sp.get('page') ?? '1'))
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? '50')))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  if (status && !VALID_STATUSES.includes(status)) {
    throw new ApiError(400, `非法 status: ${status}`)
  }

  let query = admin.from('search_jobs').select(`
    id, status, retry_count, created_at, started_at, completed_at, scheduled_at,
    user_email:profiles(email),
    document_title:patent_documents(title),
    tasks:search_tasks(id, status)
  `, { count: 'exact' })

  if (status) query = query.eq('status', status)
  if (email) query = query.ilike('profiles.email', `%${email}%`)

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw new ApiError(500, `DB 查询失败: ${error.message}`)

  // PostgREST 嵌入关系：to-one 返回对象，to-many 返回数组（兼容两种形态）
  const pickEmbedded = (val: unknown): Record<string, unknown> => {
    if (Array.isArray(val)) return (val[0] ?? {}) as Record<string, unknown>
    if (val && typeof val === 'object') return val as Record<string, unknown>
    return {}
  }

  const jobs = (data ?? []).map((j: any) => {
    const tasks: Array<{ status: string }> = Array.isArray(j.tasks) ? j.tasks : []
    const task_counts = {
      total: tasks.length,
      done: tasks.filter(t => t.status === 'done').length,
      running: tasks.filter(t => t.status === 'running').length,
      pending: tasks.filter(t => t.status === 'pending' || t.status === 'retrying').length,
      failed: tasks.filter(t => t.status === 'abandoned').length,
      abandoned: tasks.filter(t => t.status === 'abandoned').length,
    }
    return {
      id: j.id,
      status: j.status,
      retry_count: j.retry_count,
      created_at: j.created_at,
      started_at: j.started_at,
      completed_at: j.completed_at,
      scheduled_at: j.scheduled_at,
      user_email: String(pickEmbedded(j.user_email).email ?? ''),
      document_title: String(pickEmbedded(j.document_title).title ?? ''),
      task_counts,
      progress_percent: task_counts.total === 0 ? 0 : Math.round((task_counts.done / task_counts.total) * 100),
    }
  })

  return NextResponse.json({ jobs, total: count ?? 0, page, pageSize })
})
