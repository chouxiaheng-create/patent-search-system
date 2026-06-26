import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/boss-client', () => ({ sendBossJob: vi.fn().mockResolvedValue(undefined) }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

describe('POST /api/jobs', () => {
  it('未登录时返回 401', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })
    const { POST } = await import('@/app/api/jobs/route')
    const res = await POST(new Request('http://localhost/api/jobs', { method: 'POST', body: '{}' }) as any)
    expect(res.status).toBe(401)
  })

  it('文档未解析完成时返回 400', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'doc-1', parse_status: 'parsing' }, error: null }),
            }),
          }),
        }),
      }),
    })
    const { POST } = await import('@/app/api/jobs/route')
    const res = await POST(new Request('http://localhost/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ documentId: 'doc-1', config: { model_ids: ['m1'], strategy_ids: ['s1'], per_task_limit: 5, report_limit: 10, report_model_id: 'm1', report_system_prompt: 'p' } }),
    }) as any)
    expect(res.status).toBe(400)
  })

  it('文档已解析时创建任务并返回 jobId', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }) },
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'doc-1', parse_status: 'done' }, error: null }),
            }),
          }),
        }),
      }),
    })
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({ data: { id: 'job-uuid' }, error: null }),
          }),
        }),
      }),
    })
    const { POST } = await import('@/app/api/jobs/route')
    const res = await POST(new Request('http://localhost/api/jobs', {
      method: 'POST',
      body: JSON.stringify({ documentId: 'doc-1', config: { model_ids: ['m1'], strategy_ids: ['s1'], per_task_limit: 5, report_limit: 10, report_model_id: 'm1', report_system_prompt: 'p' } }),
    }) as any)
    expect(res.status).toBe(201)
    expect((await res.json()).jobId).toBe('job-uuid')
    const { sendBossJob } = await import('@/lib/boss-client')
    expect(sendBossJob).toHaveBeenCalledTimes(1)
    expect((sendBossJob as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe('search-job')
    expect((sendBossJob as ReturnType<typeof vi.fn>).mock.calls[0][1]).toMatchObject({ jobId: 'job-uuid' })
  })
})
