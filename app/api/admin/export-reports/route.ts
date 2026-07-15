// app/api/admin/export-reports/route.ts
// POST: 接收 { items: [{ userId, reportIds: [...] }] }，精确导出勾选的报告为 Markdown 下载

import { NextRequest, NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { requireAdmin, ApiError } from '../require-admin'
import { createServiceClient } from '@/lib/supabase/admin'
import { buildReportMarkdown } from '@/lib/admin/export-reports-md'

const MAX_REPORTS_PER_REQUEST = 200   // 防止一次拉太多

type Item = { userId?: unknown; reportIds?: unknown }

export const POST = withApiHandler(async (request: NextRequest) => {
  await requireAdmin()

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') throw new ApiError(400, '请求体格式错误')

  const { items } = body as { items?: unknown }
  if (!Array.isArray(items) || items.length === 0) {
    throw new ApiError(400, 'items 必须是非空数组')
  }

  // 解析并校验入参：每个 item = { userId: string, reportIds: string[] (1-200) }
  const normalized: Array<{ userId: string; reportIds: string[] }> = []
  let totalReports = 0
  for (let i = 0; i < items.length; i++) {
    const it = items[i] as Item
    if (!it || typeof it !== 'object') {
      throw new ApiError(400, `items[${i}] 不是对象`)
    }
    const { userId, reportIds } = it
    if (typeof userId !== 'string' || userId.length === 0) {
      throw new ApiError(400, `items[${i}].userId 必须是字符串`)
    }
    if (!Array.isArray(reportIds) || reportIds.length === 0) {
      throw new ApiError(400, `items[${i}].reportIds 必须是非空数组`)
    }
    const ids = reportIds.filter((x): x is string => typeof x === 'string' && x.length > 0)
    if (ids.length !== reportIds.length) {
      throw new ApiError(400, `items[${i}].reportIds 每项必须是字符串`)
    }
    totalReports += ids.length
    normalized.push({ userId, reportIds: ids })
  }
  if (totalReports > MAX_REPORTS_PER_REQUEST) {
    throw new ApiError(400, `一次最多导出 ${MAX_REPORTS_PER_REQUEST} 个报告（当前 ${totalReports}）`)
  }

  const admin = createServiceClient()

  // 收集去重后的 userId 列表
  const userIds = Array.from(new Set(normalized.map((x) => x.userId)))

  // 1. 查所有目标用户的 profile（含 email）
  const { data: profiles, error: profErr } = await admin
    .from('profiles')
    .select('id, email')
    .in('id', userIds)
  if (profErr) throw new ApiError(500, `profiles 查询失败: ${profErr.message}`)
  if (!profiles || profiles.length === 0) {
    throw new ApiError(404, '没有找到任何选中用户')
  }

  // 2. 精确查勾选的报告（用 in 一次拉全部，再用集合过滤）
  const allReportIds = Array.from(new Set(normalized.flatMap((x) => x.reportIds)))
  const { data: reports, error: reportsErr } = await admin
    .from('reports')
    .select('id, job_id, user_id, html_content, selected_docs, doc_count, created_at')
    .in('id', allReportIds)
  if (reportsErr) throw new ApiError(500, `reports 查询失败: ${reportsErr.message}`)

  // 3. 校验：每个报告必须属于其 item 里声明的 userId（防止跨用户拉取）
  const allowed = new Set<string>()   // allowed report ids
  for (const n of normalized) {
    const set = new Set(n.reportIds)
    for (const r of reports ?? []) {
      if (set.has(r.id) && r.user_id === n.userId) allowed.add(r.id)
    }
  }
  // 过滤掉不属于任何声明的 report
  const validReports = (reports ?? []).filter((r) => allowed.has(r.id))

  // 4. 按 userId + item 顺序组装（同一用户的报告保持原勾选顺序）
  const reportMap = new Map<string, typeof validReports[number]>()
  for (const r of validReports) reportMap.set(r.id, r)

  const exportUsers = normalized
    .map((n) => {
      const p = profiles.find((pr) => pr.id === n.userId)
      if (!p) return null
      const rs = n.reportIds
        .map((rid) => reportMap.get(rid))
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
      return {
        id: p.id,
        email: p.email ?? '(no email)',
        reports: rs.map((r) => ({
          id: r.id,
          job_id: r.job_id,
          created_at: r.created_at,
          doc_count: r.doc_count ?? 0,
          html_content: r.html_content ?? '',
          selected_docs: Array.isArray(r.selected_docs)
            ? (r.selected_docs as Array<{ title?: string; url?: string }>)
            : [],
        })),
      }
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)

  // 5. 生成 Markdown
  const md = buildReportMarkdown({ users: exportUsers })

  // 6. 返回 .md 文件下载
  const filename = `reports-${formatTsForFile(new Date())}.md`
  return new NextResponse(md, {
    status: 200,
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
})

function formatTsForFile(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
}