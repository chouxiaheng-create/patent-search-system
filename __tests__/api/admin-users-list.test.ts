import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

function mockAdminUser(userId = 'admin-1') {
  const server = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
        }),
      }),
    }),
  }
  return server
}

function mockListQuery(result: any) {
  return vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        range: vi.fn().mockReturnValue({
          // 关键：含子查询的 select chain 已经包含 stats
          then: undefined,
          ...result,
        }),
      }),
    }),
  })
}

describe('GET /api/admin/users', () => {
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
    const { GET } = await import('@/app/api/admin/users/route')
    const res = await GET(new Request('http://localhost/api/admin/users') as any)
    expect(res.status).toBe(403)
  })

  it('admin 查询第一页，返回用户列表含 stats', async () => {
    const server = mockAdminUser()
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(server)

    const adminRangeResult = {
      data: [
        {
          id: 'u1', email: 'a@x.com', role: 'user', created_at: '2026-01-01T00:00:00Z',
          stats: { documents: 3, jobs: 1, reports: 1 },
        },
      ],
      count: 1, error: null,
    }
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockReturnValue(adminRangeResult),
          }),
        }),
      }),
    })

    const { GET } = await import('@/app/api/admin/users/route')
    const res = await GET(new Request('http://localhost/api/admin/users?page=1&pageSize=20') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.users[0].email).toBe('a@x.com')
    expect(body.users[0].stats.documents).toBe(3)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
  })

  it('搜索参数透传到 ilike', async () => {
    const server = mockAdminUser()
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(server)

    const ilikeSpy = vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        range: vi.fn().mockReturnValue({ data: [], count: 0, error: null }),
      }),
    })
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          ilike: ilikeSpy,
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockReturnValue({ data: [], count: 0, error: null }),
          }),
        }),
      }),
    })

    const { GET } = await import('@/app/api/admin/users/route')
    await GET(new Request('http://localhost/api/admin/users?search=alice') as any)
    expect(ilikeSpy).toHaveBeenCalledWith('email', '%alice%')
  })
})
