// scripts/test-security.mjs
// 安全验证脚本：测试 admin API 的访问控制
// 必须从 worktree 跑，且 dev server 必须正在跑
//
// 用法：node scripts\test-security.mjs

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 从 worktree 出发回到父项目的 .env.local（父项目才有 .env.local）
// worktree 在 D:\...\Project\.worktrees\admin-users\，父项目在 D:\...\Project\
const envPath = resolve(process.cwd(), '..', '..', '.env.local')
const envText = readFileSync(envPath, 'utf8')
for (const line of envText.split(/\r?\n/)) {
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !anonKey) {
  console.error('env 缺少 NEXT_PUBLIC_SUPABASE_URL 或 NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}

const API = 'http://localhost:3000/api/admin/users'
const results = []

async function probe(label, headers = {}) {
  try {
    const res = await fetch(API, { headers })
    const text = await res.text()
    let body
    try { body = JSON.parse(text) } catch { body = text }
    const ok = `${res.status} ${JSON.stringify(body).slice(0, 100)}`
    console.log(`[${label}] status=${res.status} body=${ok}`)
    results.push({ label, status: res.status, body })
  } catch (e) {
    console.log(`[${label}] ERROR: ${e.message}`)
    results.push({ label, status: 0, body: e.message })
  }
}

console.log('===== Security verification =====')
console.log(`Target: ${API}`)
console.log()

// 1. 无任何认证 → 401
console.log('[1] no auth at all')
await probe('no-auth', {})

// 2. 仅 anon key → 401（中间件拦下）
console.log('[2] anon key only')
await probe('anon-key', {
  apikey: anonKey,
  Authorization: `Bearer ${anonKey}`,
})

// 3. 错误格式 bearer → 401
console.log('[3] bogus bearer')
await probe('bogus-bearer', {
  apikey: anonKey,
  Authorization: 'Bearer obviously-not-a-jwt',
})

console.log()
console.log('===== Results =====')
const expectations = [
  { label: 'no-auth', minStatus: 400, maxStatus: 403, desc: '无认证必须被拒' },
  { label: 'anon-key', minStatus: 400, maxStatus: 403, desc: 'anon key 必须被拒' },
  { label: 'bogus-bearer', minStatus: 400, maxStatus: 403, desc: '错误 JWT 必须被拒' },
]

let pass = 0
for (const exp of expectations) {
  const r = results.find((x) => x.label === exp.label)
  if (!r) { console.log(`[FAIL] ${exp.label}: 无响应`); continue }
  const inRange = r.status >= exp.minStatus && r.status <= exp.maxStatus
  const verdict = inRange ? 'PASS' : 'FAIL'
  console.log(`[${verdict}] ${exp.label} (status=${r.status}): ${exp.desc}`)
  if (inRange) pass++
}

console.log()
console.log(`Summary: ${pass}/${expectations.length} 通过`)
process.exit(pass === expectations.length ? 0 : 1)
