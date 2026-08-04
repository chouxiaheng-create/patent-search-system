// 临时脚本：验证 E2E 测试账号登录 + 修复项 API 冒烟测试（用后即删）
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = readFileSync('.env.local', 'utf8')
for (const line of env.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

const API = 'http://localhost:3000'
let pass = 0, fail = 0
const log = (label, ok, detail = '') => {
  console.log(`  ${ok ? '✓ PASS' : '✗ FAIL'}  ${label}${detail ? '  — ' + detail : ''}`)
  ok ? pass++ : fail++
}
const section = (name) => console.log(`\n=== ${name} ===`)

async function api(path, opts = {}, token) {
  const headers = { ...(opts.headers || {}) }
  if (token) headers.Authorization = `Bearer ${token}`
  const res = await fetch(API + path, { ...opts, headers })
  let body = null
  try { body = await res.json() } catch { body = await res.text() }
  return { status: res.status, body }
}

// ---- 登录 ----
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
const r1 = await sb.auth.signInWithPassword({ email: 'admin-test@local.invalid', password: 'AdminTest123!' })
let adminToken = null, userToken = null
if (!r1.error && r1.data.session) adminToken = r1.data.session.access_token

// 用普通测试账号（若不存在则注册）
let r2 = await sb.auth.signInWithPassword({ email: 'e2e-user@local.invalid', password: 'E2eUser123!' })
if (r2.error) {
  r2 = await sb.auth.signUp({ email: 'e2e-user@local.invalid', password: 'E2eUser123!' })
}
if (!r2.error && r2.data.session) userToken = r2.data.session.access_token
else if (!r2.error && r2.data.user) {
  // signup 后可能未自动登录（邮箱确认关闭时通常已登录）
  const r3 = await sb.auth.signInWithPassword({ email: 'e2e-user@local.invalid', password: 'E2eUser123!' })
  if (!r3.error) userToken = r3.data.session.access_token
}

section('0. 认证前置')
log('admin-test 登录', !!adminToken)
log('e2e-user 登录', !!userToken)
if (!userToken) { console.log('   [中止] 无可用用户 token'); process.exit(1) }

// ---- 修复项定向验证（无需 admin） ----
section('L1/M13: POST /api/jobs 输入校验')
let r = await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: 'x', config: { model_ids: [], strategy_ids: [] } }) }, userToken)
log('非法 config（空数组）→ 400', r.status === 400, `status=${r.status}`)
r = await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: 'x', config: { model_ids: ['m'], strategy_ids: ['s'], per_task_limit: 0, report_limit: 10, report_model_id: 'm' } }) }, userToken)
log('非法 per_task_limit=0 → 400', r.status === 400, `status=${r.status}`)
r = await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'not-json' }, userToken)
log('非法 JSON body → 400', r.status === 400, `status=${r.status}`)
r = await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ documentId: 'x', config: { model_ids: ['m'], strategy_ids: ['s'], per_task_limit: 5, report_limit: 10, report_model_id: 'm' }, scheduledAt: 'not-a-date' }) }, userToken)
log('非法 scheduledAt → 400', r.status === 400, `status=${r.status}`)

section('L2: POST /api/documents fileType 校验')
r = await api('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fileUrl: 'u/f', fileName: 'a.exe', fileType: 'exe', parseModelId: 'm' }) }, userToken)
log('非法 fileType=exe → 400', r.status === 400, `status=${r.status}`)
r = await api('/api/documents', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'bad-json' }, userToken)
log('非法 JSON body → 400', r.status === 400, `status=${r.status}`)

section('M6: POST /api/jobs/{id}/retry-tasks 状态校验')
r = await api('/api/jobs/00000000-0000-0000-0000-000000000000/retry-tasks', { method: 'POST' }, userToken)
log('不存在任务 → 404', r.status === 404, `status=${r.status}`)

section('L7: PATCH /api/jobs 取消校验')
r = await api('/api/jobs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: '00000000-0000-0000-0000-000000000000', status: 'cancelled' }) }, userToken)
log('取消不存在任务 → 404', r.status === 404, `status=${r.status}`)
r = await api('/api/jobs', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: 'bad-json' }, userToken)
log('取消非法 JSON → 400', r.status === 400, `status=${r.status}`)

// ---- 回归：正常流程关键端点未被破坏 ----
section('回归：正常端点')
r = await api('/api/strategies', {}, userToken)
log('GET /api/strategies（登录态）→ 200/数组', r.status === 200 && Array.isArray(r.body), `status=${r.status}`)
r = await api('/api/models', {}, userToken)
log('GET /api/models（登录态）→ 200/数组', r.status === 200 && Array.isArray(r.body), `status=${r.status}`)
r = await api('/api/preferences', {}, userToken)
log('GET /api/preferences（登录态）→ 200', r.status === 200, `status=${r.status}`)
r = await api('/api/queue-status', {}, userToken)
log('GET /api/queue-status（登录态）→ 200', r.status === 200, `status=${r.status}`)
r = await api('/api/worker-ping', {}, userToken)
log('GET /api/worker-ping → 200', r.status === 200, `status=${r.status}`)

section('回归：鉴权')
r = await api('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })
log('未登录 POST /api/jobs → 401', r.status === 401, `status=${r.status}`)
r = await api('/api/admin/users', {}, null)
log('未登录 GET /api/admin/users → 401', r.status === 401 || r.status === 403, `status=${r.status}`)

console.log(`\n===== 结果: ${pass} PASS / ${fail} FAIL =====`)
process.exit(fail > 0 ? 1 : 0)
