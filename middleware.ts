// middleware.ts
import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// ======== Session 缓存（避免每次请求都 HTTPS → Supabase 验证 session）========
// TTL 60s，缓存命中时 middleware 耗时从 200-1100ms → <1ms。
interface CacheEntry {
  user: { id: string; email?: string } | null
  expires: number
}
const sessionCache = new Map<string, CacheEntry>()
const SESSION_CACHE_TTL_MS = 60_000 // 60 秒
const MAX_CACHE_SIZE = 1000

function getCachedUser(cacheKey: string): { id: string; email?: string } | null | undefined {
  const entry = sessionCache.get(cacheKey)
  if (!entry) return undefined // 未命中
  if (Date.now() > entry.expires) {
    sessionCache.delete(cacheKey)
    return undefined // 过期
  }
  return entry.user
}

function setCachedUser(cacheKey: string, user: { id: string; email?: string } | null): void {
  // 只缓存已登录用户（正向缓存），未登录状态变化快且缓存 null 会导致测试污染
  if (!user) return
  if (sessionCache.size >= MAX_CACHE_SIZE) {
    const firstKey = sessionCache.keys().next().value
    if (firstKey !== undefined) sessionCache.delete(firstKey)
  }
  sessionCache.set(cacheKey, { user, expires: Date.now() + SESSION_CACHE_TTL_MS })
}

async function buildCacheKey(request: NextRequest): Promise<string | null> {
  // M4 修复：用完整 auth cookie 值的 SHA-256 哈希作为 key（Web Crypto，兼容 Edge Runtime）。
  // 原实现 `value.slice(-40)` 是截断切片而非哈希（注释声称 SHA 哈希，实际不符），
  // 存在碰撞风险且语义混乱。无 cookie 时返回 null——不缓存（未登录状态变化快）。
  const authCookie = request.cookies.get('sb-exbxeyystxwzbmqmprym-auth-token')
  if (!authCookie?.value) return null
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(authCookie.value))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}
// ======== /Session 缓存 ========

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // 跳过静态资源
  const { pathname } = request.nextUrl
  if (pathname.startsWith('/_next/') || pathname.includes('.')) {
    return supabaseResponse
  }

  const cacheKey = await buildCacheKey(request)
  // 有 cookie 时先查缓存；无 cookie 时直接真实验证（不缓存未登录状态）
  const cachedUser = cacheKey ? getCachedUser(cacheKey) : undefined

  const isAuthPage = pathname.startsWith('/login') || pathname.startsWith('/register')

  // 缓存命中：沿用缓存结果
  if (cachedUser !== undefined) {
    if (!cachedUser && !isAuthPage) {
      const url = request.nextUrl.clone()
      url.pathname = '/login'
      return NextResponse.redirect(url)
    }
    if (cachedUser && isAuthPage) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // 缓存未命中：真实请求 Supabase
  const supabase = createServerClient(
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
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          )
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            // 强制覆盖 secure 为 false，防止 Supabase 返回的 secure:true
            // 导致内网 HTTP 下浏览器拒绝 cookie，session 丢失反复跳登录
            supabaseResponse.cookies.set(name, value, { ...options, secure: false })
          )
        },
      },
    }
  )

  const { data: { user } } = await supabase.auth.getUser()

  // 写入缓存
  if (cacheKey) setCachedUser(cacheKey, user ?? null)

  if (!user && !isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  if (user && isAuthPage) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
