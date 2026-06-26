import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/boss-client', () => ({ sendBossJob: vi.fn().mockResolvedValue(undefined) }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

describe('POST /api/documents', () => {
  it('未登录时返回 401', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })
    const { POST } = await import('@/app/api/documents/route')
    const res = await POST(new Request('http://localhost/api/documents', {
      method: 'POST',
      body: JSON.stringify({ fileUrl: 'f.pdf', fileName: 'f.pdf', fileType: 'pdf', parseModelId: 'm1', parseSystemPrompt: 'p' }),
    }) as any)
    expect(res.status).toBe(401)
  })

  it('已登录时创建文档并返回 documentId', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
    })
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'doc-uuid' }, error: null }),
          }),
        }),
      }),
    })
    const { POST } = await import('@/app/api/documents/route')
    const res = await POST(new Request('http://localhost/api/documents', {
      method: 'POST',
      body: JSON.stringify({ fileUrl: 'user-1/f.pdf', fileName: 'f.pdf', fileType: 'pdf', parseModelId: 'm1', parseSystemPrompt: 'p' }),
    }) as any)
    expect(res.status).toBe(201)
    expect((await res.json()).documentId).toBe('doc-uuid')
    const { sendBossJob } = await import('@/lib/boss-client')
    expect(sendBossJob).toHaveBeenCalledWith('parse-job', expect.objectContaining({ documentId: 'doc-uuid' }))
  })
})
