import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

// ---- POST /api/models ----
describe('POST /api/models', () => {
  it('未登录时返回 401', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })
    const { POST } = await import('@/app/api/models/route')
    const res = await POST(new Request('http://localhost/api/models', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', api_base_url: 'https://x.com/v1', model_id: 'model-x', api_key: 'sk-123', usage_types: ['search'], capabilities: { deep_reasoning: true, web_search: false } }),
    }) as any)
    expect(res.status).toBe(401)
  })

  it('已登录时插入模型并返回 201', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    })
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'model-uuid', name: 'Test' }, error: null }),
          }),
        }),
      }),
    })
    const { POST } = await import('@/app/api/models/route')
    const res = await POST(new Request('http://localhost/api/models', {
      method: 'POST',
      body: JSON.stringify({ name: 'Test', api_base_url: 'https://x.com/v1', model_id: 'model-x', api_key: 'sk-123', usage_types: ['search'], capabilities: { deep_reasoning: true, web_search: false } }),
    }) as any)
    expect(res.status).toBe(201)
    expect((await res.json()).id).toBe('model-uuid')
  })
})

// ---- PUT /api/models/[modelId] ----
describe('PUT /api/models/[modelId]', () => {
  it('未登录时返回 401', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })
    const { PUT } = await import('@/app/api/models/[modelId]/route')
    const res = await PUT(new Request('http://localhost/api/models/abc', { method: 'PUT', body: '{}' }) as any,
      { params: Promise.resolve({ modelId: 'abc' }) })
    expect(res.status).toBe(401)
  })

  // TODO Task 9: this test will be updated when builtin model API key update is supported (403 → 200)
  it('尝试修改内置模型时返回 403', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'abc', owner_id: null, is_builtin: true }, error: null }),
          }),
        }),
      }),
    })
    const { PUT } = await import('@/app/api/models/[modelId]/route')
    const res = await PUT(new Request('http://localhost/api/models/abc', { method: 'PUT', body: '{}' }) as any,
      { params: Promise.resolve({ modelId: 'abc' }) })
    expect(res.status).toBe(403)
  })
})

// ---- DELETE /api/models/[modelId] ----
describe('DELETE /api/models/[modelId]', () => {
  it('删除不属于自己的模型时返回 403', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'abc', owner_id: 'other-user', is_builtin: false }, error: null }),
          }),
        }),
      }),
    })
    const { DELETE } = await import('@/app/api/models/[modelId]/route')
    const res = await DELETE(new Request('http://localhost/api/models/abc', { method: 'DELETE' }) as any,
      { params: Promise.resolve({ modelId: 'abc' }) })
    expect(res.status).toBe(403)
  })
})
