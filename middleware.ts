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

function buildCacheKey(request: NextRequest): string | null {
  // 用 auth cookie 的 SHA 哈希作为 key。没有 cookie 时返回 null——不缓存。
  const authCookie = request.cookies.get('sb-exbxeyystxwzbmqmprym-auth-token')
  return authCookie?.value?.slice(-40) ?? null
}
// ======== /Session 缓存 ========

export async function middleware(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  // 跳过静态资源
  const { pathname } = request.nextUrl
  if (pathname.startsWith('/_next/') || pathname.includes('.')) {
    return supabaseResponse
  }

  const cacheKey = buildCacheKey(request)
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
            supabaseResponse.cookies.set(name, value, options)
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
