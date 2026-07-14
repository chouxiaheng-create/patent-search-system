import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

async function setupAdminMocks(opts: { role?: string; user?: any } = {}) {
  const { createClient } = await import('@/lib/supabase/server')
  ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { role: opts.role ?? 'admin' }, error: null }),
        }),
      }),
    }),
  })
}

describe('GET /api/admin/users/[id]', () => {
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
    const { GET } = await import('@/app/api/admin/users/[id]/route')
    const res = await GET(new Request('http://localhost/api/admin/users/u2') as any, { params: Promise.resolve({ id: 'u2' }) })
    expect(res.status).toBe(403)
  })

  it('admin 查询返回 profile + 三栏元数据，不含 parsed_data', async () => {
    await setupAdminMocks()
    const { createServiceClient } = await import('@/lib/supabase/admin')
    const adminMock = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: 'u2', email: 'u2@x.com', role: 'user', created_at: '2026-01-01' },
                  error: null,
                }),
              }),
            }),
          }
        }
        // documents / jobs / reports：仅元数据
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              order: vi.fn().mockResolvedValue({
                data: [{ id: 'd1', filename: 'a.pdf', status: 'completed', created_at: '2026-01-02' }],
                error: null,
              }),
            }),
          }),
        }
      }),
    }
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(adminMock)

    const { GET } = await import('@/app/api/admin/users/[id]/route')
    const res = await GET(new Request('http://localhost/api/admin/users/u2') as any,
      { params: Promise.resolve({ id: 'u2' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.profile.email).toBe('u2@x.com')
    expect(body.documents).toHaveLength(1)
    // 关键：返回里不应含任何 parsed_data / report_html 字段
    const json = JSON.stringify(body)
    expect(json).not.toContain('parsed_data')
    expect(json).not.toContain('report_html')
  })
})