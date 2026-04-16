import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockSelect = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: vi.fn().mockReturnValue({ select: mockSelect }),
  }),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceClient: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { preferences: { parse_model_id: 'model-1' } },
              error: null,
            }),
          }),
        }),
      }),
    }),
  }),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('GET /api/preferences', () => {
  it('未登录时返回 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { GET } = await import('@/app/api/preferences/route')
    const res = await GET(new Request('http://localhost/api/preferences') as any)
    expect(res.status).toBe(401)
  })

  it('已登录时返回用户 preferences', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'user-1' } } })
    mockSelect.mockReturnValue({
      eq: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { preferences: { parse_model_id: 'model-1' } },
          error: null,
        }),
      }),
    })
    const { GET } = await import('@/app/api/preferences/route')
    const res = await GET(new Request('http://localhost/api/preferences') as any)
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ parse_model_id: 'model-1' })
  })
})

describe('PUT /api/preferences', () => {
  it('未登录时返回 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { PUT } = await import('@/app/api/preferences/route')
    const res = await PUT(new Request('http://localhost/api/preferences', {
      method: 'PUT',
      body: JSON.stringify({ parse_model_id: 'model-1' }),
    }) as any)
    expect(res.status).toBe(401)
  })
})
