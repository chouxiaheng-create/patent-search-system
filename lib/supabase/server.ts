// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: {
        // 内网 HTTP 必须 false；公网 HTTPS 应改回 true
        secure: false,
        sameSite: 'lax',
        path: '/',
      },
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              // 强制覆盖 secure 为 false，防止 Supabase 返回的 secure:true
              // 导致内网 HTTP 下 cookie 被浏览器拒绝
              cookieStore.set(name, value, { ...options, secure: false })
            )
          } catch {
            // Ignore in Server Components
          }
        },
      },
    }
  )
}
