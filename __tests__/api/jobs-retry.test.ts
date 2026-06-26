import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/boss-client', () => ({ sendBossJob: vi.fn().mockResolvedValue(undefined) }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

const CFG = { model_ids: ['m1'], strategy_ids: ['s1'], per_task_limit: 5, report_limit: 10, report_model_id: 'm1', report_system_prompt: 'p' }

describe('POST /api/jobs/retry (全量重试)', () => {
  it('未登录时返回 401', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })
    const { POST } = await import('@/app/api/jobs/retry/route')
    const res = await POST(new Request('http://localhost/api/jobs/retry', {
      method: 'POST', body: JSON.stringify({ jobId: 'j1' }),
    }) as any)
    expect(res.status).toBe(401)
  })

  it('非 failed/cancelled 状态返回 400', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'running', user_id: 'u1', document_id: 'd1', config: CFG }, error: null }),
            }),
          }),
        }),
      }),
    })
    const { POST } = await import('@/app/api/jobs/retry/route')
    const res = await POST(new Request('http://localhost/api/jobs/retry', {
      method: 'POST', body: JSON.stringify({ jobId: 'j1' }),
    }) as any)
    expect(res.status).toBe(400)
  })

  it('文档解析不可用时返回 400', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'failed', user_id: 'u1', document_id: 'd1', config: CFG }, error: null }),
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
            single: vi.fn().mockResolvedValue({ data: { id: 'd1', parse_status: 'failed' }, error: null }),
          }),
        }),
      }),
    })
    const { POST } = await import('@/app/api/jobs/retry/route')
    const res = await POST(new Request('http://localhost/api/jobs/retry', {
      method: 'POST', body: JSON.stringify({ jobId: 'j1' }),
    }) as any)
    expect(res.status).toBe(400)
  })

  it('成功时新建 job 并入队，返回 201', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'failed', user_id: 'u1', document_id: 'd1', config: CFG }, error: null }),
            }),
          }),
        }),
      }),
    })
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        // 文档校验
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'd1', parse_status: 'done' }, error: null }),
          }),
        }),
        // 新建 job
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'new-job' }, error: null }),
          }),
        }),
      }),
    })
    const { POST } = await import('@/app/api/jobs/retry/route')
    const res = await POST(new Request('http://localhost/api/jobs/retry', {
      method: 'POST', body: JSON.stringify({ jobId: 'j1' }),
    }) as any)
    expect(res.status).toBe(201)
    expect((await res.json()).jobId).toBe('new-job')
    const { sendBossJob } = await import('@/lib/boss-client')
    expect(sendBossJob).toHaveBeenCalledWith('search-job', expect.objectContaining({ jobId: 'new-job' }))
  })
})
