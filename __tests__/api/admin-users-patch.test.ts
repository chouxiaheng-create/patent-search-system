import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

async function loadRoute() {
  return await import('@/app/api/admin/users/[id]/route')
}

function adminServer() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
        }),
      }),
    }),
  }
}

describe('PATCH /api/admin/users/[id]', () => {
  it('非 admin 返回 403', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { role: 'user' }, error: null }),
          }),
        }),
      }),
    })
    const { PATCH } = await loadRoute()
    const req = new Request('http://localhost/api/admin/users/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin', confirmText: '我确认' }),
    }) as Parameters<typeof PATCH>[0]
    const res = await PATCH(req, { params: Promise.resolve({ id: 'u2' }) })
    expect(res.status).toBe(403)
  })

  it('confirmText 错误返回 400', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(adminServer())
    const { PATCH } = await loadRoute()
    const req = new Request('http://localhost/api/admin/users/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin', confirmText: '确认' }),
    }) as Parameters<typeof PATCH>[0]
    const res = await PATCH(req, { params: Promise.resolve({ id: 'u2' }) })
    expect(res.status).toBe(400)
  })

  it('成功升级 user→admin，写 audit_log', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(adminServer())
    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'admin_audit_log') {
          return { insert: insertSpy }
        }
        if (table === 'profiles') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: 'u2', role: 'admin' }, error: null }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    })

    const { PATCH } = await loadRoute()
    const req = new Request('http://localhost/api/admin/users/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin', confirmText: '我确认' }),
    }) as Parameters<typeof PATCH>[0]
    const res = await PATCH(req, { params: Promise.resolve({ id: 'u2' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.role).toBe('admin')
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      admin_id: 'admin-1',
      target_user: 'u2',
      action: 'promote',
    }))
  })

  it('防锁死：唯一 admin 降级自己返回 409', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(adminServer())
    const { createServiceClient } = await import('@/lib/supabase/admin')
    // countAdmins -> 1，目标 admin-1 试图把自己降级
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn((columns: string) => {
              if (columns === 'role') {
                return {
                  eq: vi.fn().mockReturnValue({
                    single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
                  }),
                }
              }
              return {
                eq: vi.fn().mockResolvedValue({ count: 1, data: [], error: null }),
              }
            }),
          }
        }
        return {}
      }),
    })

    const { PATCH } = await loadRoute()
    const req = new Request('http://localhost/api/admin/users/admin-1', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'user', confirmText: '我确认' }),
    }) as Parameters<typeof PATCH>[0]
    const res = await PATCH(req, { params: Promise.resolve({ id: 'admin-1' }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.error).toMatch(/至少需要 1 个管理员/)
  })

  it('audit_log 写入失败不影响主操作', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(adminServer())
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'admin_audit_log') {
          return {
            insert: vi.fn().mockResolvedValue({ error: { message: 'audit write failed' } }),
          }
        }
        if (table === 'profiles') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: 'u2', role: 'admin' }, error: null }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    })

    const { PATCH } = await loadRoute()
    const req = new Request('http://localhost/api/admin/users/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin', confirmText: '我确认' }),
    }) as Parameters<typeof PATCH>[0]
    const res = await PATCH(req, { params: Promise.resolve({ id: 'u2' }) })
    // 主操作成功，即使 audit 失败
    expect(res.status).toBe(200)
  })
})
