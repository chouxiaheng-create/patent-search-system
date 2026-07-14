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
  const [profileR, docsR, jobsR, reportsR] = await Promise.all([
    admin.from('profiles').select('id, email, role, created_at').eq('id', id).single(),
    admin.from('patent_documents').select('id, filename, status, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    admin.from('search_jobs').select('id, title, status, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    admin.from('reports').select('id, job_id, created_at').eq('user_id', id).order('created_at', { ascending: false }),
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