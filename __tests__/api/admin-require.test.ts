import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

describe('requireAdmin()', () => {
  it('未登录时抛 401', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })
    const { requireAdmin, ApiError } = await import('@/app/api/admin/require-admin')
    await expect(requireAdmin()).rejects.toMatchObject({ status: 401 })
    expect(ApiError).toBeDefined()
  })

  it('普通用户抛 403', async () => {
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
    const { requireAdmin } = await import('@/app/api/admin/require-admin')
    await expect(requireAdmin()).rejects.toMatchObject({ status: 403 })
  })

  it('admin 用户返回 userId + supabase + admin client', async () => {
    const mockServer = {
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
          }),
        }),
      }),
    }
    const mockAdmin = { from: vi.fn() }
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(mockServer)
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue(mockAdmin)
    const { requireAdmin } = await import('@/app/api/admin/require-admin')
    const ctx = await requireAdmin()
    expect(ctx.userId).toBe('admin-1')
    expect(ctx.supabase).toBe(mockServer)
    expect(ctx.admin).toBe(mockAdmin)
  })
})