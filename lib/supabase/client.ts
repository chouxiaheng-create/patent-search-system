// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'
import type { SupabaseClient } from '@supabase/supabase-js'

let clientInstance: SupabaseClient | null = null

/**
 * 浏览器端 Supabase 客户端（单例）。
 *
 * 内网 HTTP 部署说明：
 *   - 默认情况下，@supabase/ssr 给 auth cookie 设 `Secure` 标志
 *   - 浏览器在 HTTP（非 localhost）下会直接丢弃 Secure cookie，
 *     导致登录/注册后 session 无法保存，middleware 看不到 user
 *   - 这里把 secure 显式设为 false，让内网同事/手机能正常登录
 *   - 生产环境（公网 HTTPS）部署时请把 secure 改回 true 或删除 cookieOptions
 */
export function createClient(): SupabaseClient {
  if (clientInstance) return clientInstance
  clientInstance = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        // 内网 HTTP 必须 false；公网 HTTPS 应改回 true
        secure: false,
        sameSite: 'lax',
        path: '/',
      },
    }
  )
  return clientInstance
}