// scripts/reset-admin-password.mjs
// 一键修复：用 admin API 给指定 email 强制重置密码 + 确认邮箱
//
// 用法（PowerShell 友好）：
//   node scripts\reset-admin-password.mjs <path-to-env-file>
//   例如（从 worktree 跑）：
//   node scripts\reset-admin-password.mjs ..\..\..\..\.env.local
//   或（绝对路径，单条命令不会自动折行）：
//   node "D:\full\path\to\script.mjs" "D:\full\path\to\.env.local"
//
// 默认 email = admin-test@local.invalid，password = AdminTest123!

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const email = process.env.RESET_EMAIL || 'admin-test@local.invalid'
const newPassword = process.env.RESET_PASSWORD || 'AdminTest123!'

// 1. 自己读 env 文件（不依赖 --env-file，避免 PowerShell 折行问题）
const envPath = process.argv[2]
if (!envPath) {
  console.error('用法：node scripts\\reset-admin-password.mjs <env-file-path>')
  console.error('例：node scripts\\reset-admin-password.mjs ..\\..\\.env.local')
  process.exit(1)
}

const envText = readFileSync(envPath, 'utf8')
for (const line of envText.split(/\r?\n/)) {
  // 不复制 .env.local 内容到日志，跳过注释
  const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/)
  if (m) process.env[m[1]] = m[2]
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!url) { console.error('env 中缺少 NEXT_PUBLIC_SUPABASE_URL'); process.exit(1) }
if (!key) { console.error('env 中缺少 SUPABASE_SERVICE_ROLE_KEY'); process.exit(1) }

const sb = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
})

console.log(`[1/3] 查找用户: ${email}`)
const { data: list, error: listErr } = await sb.auth.admin.listUsers()
if (listErr) {
  console.error('listUsers 失败:', listErr.message)
  process.exit(1)
}
const user = list.users.find((u) => u.email === email)
if (!user) {
  console.error(`未找到用户: ${email}`)
  process.exit(1)
}
console.log(`       user_id = ${user.id}`)
console.log(`       has_password = ${!!user.encrypted_password}`)
console.log(`       email_confirmed_at = ${user.email_confirmed_at || '(null)'}`)

console.log(`[2/3] 重置密码 + 确认邮箱`)
const { error: updErr } = await sb.auth.admin.updateUserById(user.id, {
  password: newPassword,
  email_confirm: true,
})
if (updErr) {
  console.error('updateUserById 失败:', updErr.message)
  process.exit(1)
}

console.log(`[3/3] 验证结果`)
const { data: reList } = await sb.auth.admin.listUsers()
const refreshed = reList.users.find((u) => u.id === user.id)
console.log(`       has_password = ${!!refreshed.encrypted_password}`)
console.log(`       email_confirmed_at = ${refreshed.email_confirmed_at || '(null)'}`)

console.log(`\n✅ 完成。请用以下凭证登录:`)
console.log(`   email:    ${email}`)
console.log(`   password: ${newPassword}`)
