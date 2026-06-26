import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/boss-client', () => ({ sendBossJob: vi.fn().mockResolvedValue(undefined) }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

function mockParams() {
  return { params: Promise.resolve({ jobId: 'j1' }) }
}

describe('POST /api/jobs/[jobId]/retry-tasks (部分重试)', () => {
  it('未登录时返回 401', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })
    const { POST } = await import('@/app/api/jobs/[jobId]/retry-tasks/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(401)
  })

  it('非 completed/failed 状态返回 400', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'running' }, error: null }),
            }),
          }),
        }),
      }),
    })
    const { POST } = await import('@/app/api/jobs/[jobId]/retry-tasks/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(400)
  })

  it('无可重跑子任务(count=0)返回 400', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'failed' }, error: null }),
            }),
          }),
        }),
      }),
    })
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            neq: vi.fn().mockResolvedValue({ count: 0, error: null }),
          }),
        }),
      }),
    })
    const { POST } = await import('@/app/api/jobs/[jobId]/retry-tasks/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(400)
  })

  it('成功时置回 queued 并入队，返回 200', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'completed' }, error: null }),
            }),
          }),
        }),
      }),
    })
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'search_tasks') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                neq: vi.fn().mockResolvedValue({ count: 2, error: null }),
              }),
            }),
          }
        }
        // search_jobs update
        return {
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockResolvedValue({ error: null }),
          }),
        }
      }),
    })
    const { POST } = await import('@/app/api/jobs/[jobId]/retry-tasks/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(200)
    const { sendBossJob } = await import('@/lib/boss-client')
    expect(sendBossJob).toHaveBeenCalledWith('search-job', expect.objectContaining({ jobId: 'j1' }))
  })
})
