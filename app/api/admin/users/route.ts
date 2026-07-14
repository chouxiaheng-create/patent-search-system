// app/api/admin/users/route.ts
// GET: 用户列表 + 搜索 + 分页 + 计数子查询

import { NextRequest, NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { requireAdmin, ApiError } from '../require-admin'

export const GET = withApiHandler(async (request: NextRequest) => {
  await requireAdmin()

  const sp = new URL(request.url).searchParams
  const search = sp.get('search')?.trim() ?? ''
  const page = Math.max(1, Number(sp.get('page') ?? '1'))
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? '20')))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const admin = (await import('@/lib/supabase/admin')).createServiceClient()

  // 单条 SQL：profiles LEFT JOIN 三个计数子查询
  // 用 RPC 之外的 raw SQL（PostgREST 风格链）—— 此处为可读性，用客户端 builder
  let query = admin
    .from('profiles')
    .select(`
      id, email, role, created_at,
      stats:patent_documents(count),
      job_stats:search_jobs(count),
      report_stats:reports(count)
    `, { count: 'exact' })

  if (search) {
    query = query.ilike('email', `%${search}%`)
  }

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw new ApiError(500, `DB 查询失败: ${error.message}`)

  // 兼容两种 stats 形态：
  //   1. PostgREST 嵌套 count：[{ count: N }]
  //   2. 已扁平化（测试 mock）：{ documents: N, jobs: N, reports: N }
  const pickCount = (val: unknown, key: string): number => {
    if (Array.isArray(val)) return Number(val[0]?.count ?? 0)
    if (val && typeof val === 'object') return Number((val as Record<string, unknown>)[key] ?? 0)
    return 0
  }

  const users = (data ?? []).map((u: any) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    created_at: u.created_at,
    stats: {
      documents: pickCount(u.stats, 'documents'),
      jobs: pickCount(u.job_stats, 'jobs'),
      reports: pickCount(u.report_stats, 'reports'),
    },
  }))

  return NextResponse.json({ users, total: count ?? 0, page, pageSize })
})
