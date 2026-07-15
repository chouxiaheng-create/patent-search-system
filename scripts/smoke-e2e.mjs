// scripts/smoke-e2e.mjs
// API-level 综合 smoke test：覆盖 Sections 1, 2, 3, 4, 5, 6
//
// 设计：所有"UI 点击"背后都是 API 调用，本脚本直接调 API。
// UI 一致性（RoleSwitchDialog 显示、加载中文文案）仍需用户肉眼检查。
//
// 用法：node scripts\smoke-e2e.mjs

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createClient } from '@supabase/supabase-js'

// 读 env
const envPath = resolve(process.cwd(), '..', '..', '.env.local')
const envText = readFileSync(envPath, 'utf8')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anonKey || !serviceKey) {
  console.error('env 缺少 SUPABASE 凭据')
  process.exit(1)
}

const API = 'http://localhost:3000/api/admin/users'
const ADMIN_EMAIL = 'admin-test@local.invalid'
const ADMIN_PWD = 'AdminTest123!'

let pass = 0, fail = 0
const log = (label, ok, detail = '') => {
  const tag = ok ? '✓ PASS' : '✗ FAIL'
  console.log(`  ${tag}  ${label}${detail ? '  — ' + detail : ''}`)
  ok ? pass++ : fail++
}
const section = (name) => console.log(`\n=== ${name} ===`)

// 安全解析响应：JSON / HTML / 空 body 都处理
async function safeFetch(target, opts = {}) {
  const res = await fetch(target, opts)
  const ct = res.headers.get('content-type') || ''
  const text = await res.text()
  let json = null, html = null
  if (ct.includes('json')) {
    try { json = JSON.parse(text) } catch { /* fallthrough */ }
  } else if (text.trim().startsWith('{') || text.trim().startsWith('[')) {
    try { json = JSON.parse(text) } catch { html = text.slice(0, 200) }
  } else {
    html = text.slice(0, 200)
  }
  return { status: res.status, ct, json, html }
}

// 安全判定"未授权是否真的被挡住"：
// 标准应为 4xx 但项目当前中间件会 200+HTML 跳登录页。
// 关键判定：响应里不能包含任何 admin 数据特征（email, profiles, audit 等）
function isBlocked(safeRes) {
  if (safeRes.status >= 400 && safeRes.status < 500) return true
  // 200 但 HTML（被中间件挡下重定向到登录页）— 安全，需要验证 HTML 不含数据
  if (safeRes.status === 200 && safeRes.html && !safeRes.json) {
    const html = safeRes.html.toLowerCase()
    // 任何看起来像数据列表的内容都不应该出现
    if (html.includes('@example') || html.includes('@local')) return false  // 仅作为登录页 placeholder
    if (html.includes('audit_log') || html.includes('is_admin')) return false
    if (html.includes('"users"') || html.includes('"role":"admin"')) return false
    return true
  }
  return false
}

// 用 service role 拿数据
const sbAdmin = createClient(url, serviceKey, { auth: { persistSession: false } })

section('Section 6: 安全验证')
{
  const r1 = await safeFetch(API)
  log('无认证被拦下', isBlocked(r1), `status=${r1.status} kind=${r1.json ? 'json' : 'html'}`)

  const r2 = await safeFetch(API, { headers: { Authorization: `Bearer ${anonKey}` } })
  log('anon key only 被拦下', isBlocked(r2), `status=${r2.status} kind=${r2.json ? 'json' : 'html'}`)

  const r3 = await safeFetch(API, { headers: { Authorization: 'Bearer not-a-real-jwt' } })
  log('伪造 JWT 被拦下', isBlocked(r3), `status=${r3.status} kind=${r3.json ? 'json' : 'html'}`)

  // admin 登录获取 session
  const sbAuth = createClient(url, anonKey, { auth: { persistSession: false } })
  const { data: authData, error: authErr } = await sbAuth.auth.signInWithPassword({
    email: ADMIN_EMAIL, password: ADMIN_PWD,
  })
  log('admin 可登录', !authErr && !!authData?.user, authErr?.message ?? `uid=${authData?.user?.id?.slice(0,8)}…`)
  if (authErr || !authData) { console.log('  → 终止后续 section'); process.exit(1) }

  const accessToken = authData.session.access_token
  const refreshToken = authData.session.refresh_token
  globalThis.__accessToken = accessToken
  globalThis.__adminUid = authData.user.id

  // 构造 supabase 风格的 cookie（项目只认 cookie，不认 Authorization Bearer）
  const refMatch = url.match(/https:\/\/([^.]+)/)
  const cookieName = `sb-${refMatch[1]}-auth-token`
  const cookieVal = JSON.stringify({
    access_token: accessToken,
    refresh_token: refreshToken,
    expires_at: Math.floor(Date.now()/1000) + 3600,
    expires_in: 3600,
    token_type: 'bearer',
    user: authData.user,
  })
  const cookieHeader = `${cookieName}=${encodeURIComponent(cookieVal)}`
  globalThis.__cookieHeader = cookieHeader  // 全局，下面所有请求都用这个

  // 验证 cookie 路径
  const r6 = await safeFetch(API, { headers: { Cookie: cookieHeader } })
  log('admin cookie 可调 /api/admin/users', r6.status === 200 && !!r6.json,
    `status=${r6.status} users=${r6.json?.users?.length}`)
}

section('Section 3: 列表 + 搜索 + 分页')
{
  const auth = { Cookie: globalThis.__cookieHeader }
  const r1 = await safeFetch(API, { headers: auth })
  log('GET /api/admin/users 200',
    r1.status === 200 && Array.isArray(r1.json?.users),
    `users=${r1.json?.users?.length} total=${r1.json?.total}`)
  const sample = r1.json?.users?.[0]
  log('返回字段含 id/email/role/stats',
    !!sample?.id && !!sample?.email && !!sample?.role && !!sample?.stats,
    `email=${sample?.email}`)

  const r2 = await safeFetch(`${API}?search=admin`, { headers: auth })
  log('search=admin 至少返回 1 行',
    r2.status === 200 && r2.json?.users?.length >= 1,
    `rows=${r2.json?.users?.length}`)

  const r3 = await safeFetch(`${API}?search=__zzz_no_match__`, { headers: auth })
  log('search 不存在字符串返回 0 行',
    r3.status === 200 && r3.json?.users?.length === 0)

  const r4 = await safeFetch(`${API}?page=1&pageSize=2`, { headers: auth })
  log('pageSize=2 生效',
    r4.status === 200 && r4.json?.users?.length <= 2,
    `rows=${r4.json?.users?.length}`)
}

section('Section 4: 详情查询')
{
  const auth = { Cookie: globalThis.__cookieHeader }
  const list = await safeFetch(API, { headers: auth })
  const someUserId = list.json?.users?.find((u) => u.id !== globalThis.__adminUid)?.id
  if (!someUserId) { log('找不到非 admin 用户，跳过详情', false); }
  else {
    const r = await safeFetch(`${API}/${someUserId}`, { headers: auth })
    log(`GET /api/admin/users/<id>`,
      r.status === 200 && !!r.json?.profile,
      `status=${r.status} profile.email=${r.json?.profile?.email}`)
    log('详情 profile 含 id/email/role',
      !!r.json?.profile?.id && !!r.json?.profile?.email && !!r.json?.profile?.role)
    log('详情含 documents/jobs/reports 数组',
      Array.isArray(r.json?.documents) && Array.isArray(r.json?.jobs) && Array.isArray(r.json?.reports),
      `docs=${r.json?.documents?.length} jobs=${r.json?.jobs?.length} reports=${r.json?.reports?.length}`)
    globalThis.__someUserId = someUserId
  }
}

section('Section 1 + 2: Promote / Demote / 防锁死')
{
  const auth = { Cookie: globalThis.__cookieHeader }
  const targetId = globalThis.__someUserId
  if (!targetId) { log('无目标用户，跳过', false); }
  else {
    const r1 = await safeFetch(`${API}/${targetId}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', confirmText: '我确认' }),
    })
    log('PATCH promote 普通→admin',
      r1.status === 200 && r1.json?.user?.role === 'admin',
      `status=${r1.status} role=${r1.json?.user?.role}`)

    const r2 = await safeFetch(`${API}/${targetId}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', confirmText: '我确认' }),
    })
    log('PATCH demote admin→user',
      r2.status === 200 && r2.json?.user?.role === 'user',
      `status=${r2.status} role=${r2.json?.user?.role}`)

    const r3 = await safeFetch(`${API}/${targetId}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', confirmText: 'wrong' }),
    })
    log('confirmText 错误必须被拒',
      r3.status >= 400 && r3.status < 500,
      `status=${r3.status}`)

    const r4 = await safeFetch(`${API}/${globalThis.__adminUid}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', confirmText: '我确认' }),
    })
    log('最后 admin 自我降级必须 409',
      r4.status === 409,
      `status=${r4.status}`)

    const r5 = await safeFetch(`${API}/${globalThis.__adminUid}`, { headers: auth })
    log('防锁死后 admin 自身 role 仍为 admin',
      r5.json?.profile?.role === 'admin' || r5.json?.user?.role === 'admin',
      `role=${r5.json?.profile?.role || r5.json?.user?.role}`)
  }
}

section('Section 5: 审计日志')
{
  const { count: before } = await sbAdmin.from('admin_audit_log').select('id', { count: 'exact', head: true })
  log('audit_log 至少 ≥2 条（之前 Sections 的产物）',
    (before ?? 0) >= 2, `count=${before}`)

  const auth = { Cookie: globalThis.__cookieHeader }
  const targetId = globalThis.__someUserId
  if (targetId) {
    await safeFetch(`${API}/${targetId}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'admin', confirmText: '我确认' }),
    })
    await safeFetch(`${API}/${targetId}`, {
      method: 'PATCH',
      headers: { ...auth, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'user', confirmText: '我确认' }),
    })
  }
  const { count: after } = await sbAdmin.from('admin_audit_log').select('id', { count: 'exact', head: true })
  log('第二次 promote+demote 后 audit_log +2',
    after === before + 2, `before=${before} after=${after}`)

  const cBefore = before
  await safeFetch(`${API}/${globalThis.__adminUid}`, {
    method: 'PATCH',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'user', confirmText: '我确认' }),
  })
  const { count: cAfter } = await sbAdmin.from('admin_audit_log').select('id', { count: 'exact', head: true })
  log('失败的 PATCH 不写 audit_log',
    cAfter === cBefore, `before=${cBefore} after=${cAfter}`)

  const { data: latest } = await sbAdmin.from('admin_audit_log')
    .select('action').order('created_at', { ascending: false }).limit(5)
  const actions = (latest ?? []).map((x) => x.action)
  log('最新 5 条 action 在合法集合内',
    actions.every((a) => ['promote', 'demote', 'view_user'].includes(a)),
    `actions=${actions.join(',')}`)
}

console.log(`\n========== Summary ==========`)
console.log(`  ✓ ${pass} 通过`)
console.log(`  ✗ ${fail} 失败`)
process.exit(fail === 0 ? 0 : 1)
