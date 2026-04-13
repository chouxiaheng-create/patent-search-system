// __tests__/middleware.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import * as supabaseSSR from '@supabase/ssr'

// Mock @supabase/ssr
vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(),
}))

const mockGetUser = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(supabaseSSR.createServerClient).mockReturnValue({
    auth: { getUser: mockGetUser },
  } as ReturnType<typeof supabaseSSR.createServerClient>)
})

describe('middleware', () => {
  it('未登录用户访问 /dashboard 时重定向到 /login', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const { middleware } = await import('../middleware')
    const req = new NextRequest('http://localhost:3000/dashboard')
    const res = await middleware(req)
    expect(res?.status).toBe(307)
    expect(res?.headers.get('location')).toContain('/login')
  })

  it('已登录用户访问 /login 时重定向到 /dashboard', async () => {
    mockGetUser.mockResolvedValue({
      data: { user: { id: 'user-1', email: 'test@example.com' } },
      error: null,
    })
    const { middleware } = await import('../middleware')
    const req = new NextRequest('http://localhost:3000/login')
    const res = await middleware(req)
    expect(res?.status).toBe(307)
    expect(res?.headers.get('location')).toContain('/dashboard')
  })

  it('未登录用户访问 /login 时正常通过', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null })
    const { middleware } = await import('../middleware')
    const req = new NextRequest('http://localhost:3000/login')
    const res = await middleware(req)
    // NextResponse.next() 不设置 location header
    expect(res?.headers.get('location')).toBeNull()
  })
})
