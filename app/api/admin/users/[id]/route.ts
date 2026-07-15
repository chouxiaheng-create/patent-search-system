// app/api/admin/users/[id]/route.ts
// GET: 用户详情（profile + 三栏元数据，仅元数据不含全文）
// PATCH: 角色切换（Task 5 加上）

import { NextRequest, NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { requireAdmin, ApiError } from '../../require-admin'
import { createServiceClient } from '@/lib/supabase/admin'

export const GET = withApiHandler(async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin()
  const { id } = await ctx.params
  const admin = createServiceClient()

  // 并行：profile + 三栏元数据
  // 注：列名按迁移 20260413000001_schema.sql 的真实 schema 取（filename→title, status→parse_status,
  //     search_jobs 无 title 列，只取本身有的字段）
  const [profileR, docsR, jobsR, reportsR] = await Promise.all([
    admin.from('profiles').select('id, email, role, created_at').eq('id', id).single(),
    admin.from('patent_documents').select('id, title, parse_status, file_type, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    admin.from('search_jobs').select('id, status, scheduled_at, started_at, completed_at, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    admin.from('reports').select('id, job_id, doc_count, created_at').eq('user_id', id).order('created_at', { ascending: false }),
  ])

  if (profileR.error || !profileR.data) throw new ApiError(404, '用户不存在')
  if (docsR.error) throw new ApiError(500, docsR.error.message)
  if (jobsR.error) throw new ApiError(500, jobsR.error.message)
  if (reportsR.error) throw new ApiError(500, reportsR.error.message)

  return NextResponse.json({
    profile: profileR.data,
    documents: docsR.data ?? [],
    jobs: jobsR.data ?? [],
    reports: reportsR.data ?? [],
  })
})

export const PATCH = withApiHandler(async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { userId: adminId } = await requireAdmin()
  const { id: targetId } = await ctx.params

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') throw new ApiError(400, '请求体格式错误')

  const { role, confirmText } = body as { role?: string; confirmText?: string }
  if (role !== 'admin' && role !== 'user') throw new ApiError(400, 'role 必须是 admin 或 user')
  if (confirmText !== '我确认') throw new ApiError(400, '请输入确认文本"我确认"')

  const admin = createServiceClient()

  // 防锁死：若降级 admin，先看系统中 admin 总数
  if (role === 'user') {
    const { count, error: cntErr } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
    if (cntErr) throw new ApiError(500, cntErr.message)
    // 检查目标用户的当前 role
    const { data: targetProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', targetId)
      .single()
    if (targetProfile?.role === 'admin' && (count ?? 0) <= 1) {
      throw new ApiError(409, '系统至少需要 1 个管理员，无法降级')
    }
  }

  // 主操作：更新 role
  const { data, error } = await admin
    .from('profiles')
    .update({ role })
    .eq('id', targetId)
    .select('id, role')
    .single()
  if (error || !data) throw new ApiError(500, error?.message ?? '更新失败')

  // 审计：失败不阻塞
  try {
    await admin.from('admin_audit_log').insert({
      admin_id: adminId,
      action: role === 'admin' ? 'promote' : 'demote',
      target_user: targetId,
      detail: { from: role === 'admin' ? 'user' : 'admin', to: role },
    })
  } catch (auditErr) {
    console.error('[audit] write failed:', auditErr)
  }

  return NextResponse.json({ user: data })
})
