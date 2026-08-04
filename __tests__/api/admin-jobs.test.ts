import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/boss-client', () => ({ sendBossJob: vi.fn().mockResolvedValue(undefined) }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

// requireAdmin 依赖：getUser → user；profiles.select('role') → admin
async function mockAdminUser() {
  const { createClient } = await import('@/lib/supabase/server')
  ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }) }),
      }),
    }),
  })
}

async function mockNonAdminUser() {
  const { createClient } = await import('@/lib/supabase/server')
  ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { role: 'user' }, error: null }) }),
      }),
    }),
  })
}

// 构造 service client 的链式 mock：返回含 3 条任务（含嵌套 search_tasks）的列表
async function mockJobsList() {
  const { createServiceClient } = await import('@/lib/supabase/admin')
  ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnThis(),
        ilike: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        range: vi.fn().mockResolvedValue({
          count: 3,
          error: null,
          data: [
            { id: 'j1', status: 'running', retry_count: 0, created_at: '2026-08-04T01:00:00Z', started_at: null, completed_at: null, scheduled_at: null,
              user_email: [{ email: 'a@x.com' }], document_title: [{ title: '专利A' }],
              tasks: [{ id: 't1', status: 'done' }, { id: 't2', status: 'running' }] },
            { id: 'j2', status: 'failed', retry_count: 2, created_at: '2026-08-04T02:00:00Z', started_at: null, completed_at: null, scheduled_at: null,
              user_email: [{ email: 'b@x.com' }], document_title: [{ title: '专利B' }], tasks: [] },
            { id: 'j3', status: 'completed', retry_count: 0, created_at: '2026-08-04T03:00:00Z', started_at: null, completed_at: null, scheduled_at: null,
              user_email: [{ email: 'a@x.com' }], document_title: [{ title: '专利C' }],
              tasks: [{ id: 't3', status: 'done' }, { id: 't4', status: 'abandoned' }] },
          ],
        }),
      }),
    }),
  })
}

describe('GET /api/admin/jobs', () => {
  it('非 admin 返回 403', async () => {
    await mockNonAdminUser()
    const { GET } = await import('@/app/api/admin/jobs/route')
    const res = await GET(new Request('http://localhost/api/admin/jobs') as any)
    expect(res.status).toBe(403)
  })

  it('非法 status 参数返回 400', async () => {
    await mockAdminUser()
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockResolvedValue({ count: 0, error: null, data: [] }),
          }),
        }),
      }),
    })
    const { GET } = await import('@/app/api/admin/jobs/route')
    const res = await GET(new Request('http://localhost/api/admin/jobs?status=badvalue') as any)
    expect(res.status).toBe(400)
  })

  it('正常返回聚合结构与进度', async () => {
    await mockAdminUser()
    await mockJobsList()
    const { GET } = await import('@/app/api/admin/jobs/route')
    const res = await GET(new Request('http://localhost/api/admin/jobs') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.total).toBe(3)
    expect(body.jobs[0]).toMatchObject({
      id: 'j1', status: 'running', user_email: 'a@x.com', document_title: '专利A',
      task_counts: { total: 2, done: 1, running: 1, pending: 0, failed: 0, abandoned: 0 },
      progress_percent: 50,
    })
    expect(body.jobs[1].task_counts.total).toBe(0)
    expect(body.jobs[1].progress_percent).toBe(0)
  })
})

describe('POST /api/admin/jobs/[jobId]/cancel', () => {
  function mockParams() {
    return { params: Promise.resolve({ jobId: 'j1' }) }
  }

  it('非 admin 返回 403', async () => {
    await mockNonAdminUser()
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/cancel/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(403)
  })

  it('终态任务返回 400', async () => {
    await mockAdminUser()
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'failed' }, error: null }) }),
        }),
      }),
    })
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/cancel/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(400)
  })

  it('成功取消：原子迁移 + RPC 清理，返回 200', async () => {
    await mockAdminUser()
    const { createServiceClient } = await import('@/lib/supabase/admin')
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 'j1' }], error: null }) }),
      }),
    })
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'running' }, error: null }) }),
        }),
        update,
      }),
      rpc,
    })
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/cancel/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalled()
    expect(rpc).toHaveBeenCalledWith('admin_cancel_pgboss_job', {
      p_job_name: 'search-job',
      p_job_data: { jobId: 'j1' },
    })
  })

  it('乐观锁未命中返回 409', async () => {
    await mockAdminUser()
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'queued' }, error: null }) }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }),
          }),
        }),
      }),
      rpc: vi.fn().mockResolvedValue({ error: null }),
    })
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/cancel/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(409)
  })
})

describe('POST /api/admin/jobs/[jobId]/retry', () => {
  function mockParams() {
    return { params: Promise.resolve({ jobId: 'j1' }) }
  }

  it('非 admin 返回 403', async () => {
    await mockNonAdminUser()
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/retry/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(403)
  })

  it('非 failed/completed 状态返回 400', async () => {
    await mockAdminUser()
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'running', retry_count: 1, started_at: null, completed_at: null }, error: null }) }),
        }),
      }),
    })
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/retry/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(400)
  })

  it('成功重跑：置 queued + 入队，返回 200', async () => {
    await mockAdminUser()
    const { createServiceClient } = await import('@/lib/supabase/admin')
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 'j1' }], error: null }) }),
      }),
    })
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'failed', retry_count: 2, started_at: null, completed_at: null }, error: null }) }),
        }),
        update,
      }),
    })
    const { sendBossJob } = await import('@/lib/boss-client')
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/retry/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(200)
    expect(update).toHaveBeenCalled()
    expect(sendBossJob).toHaveBeenCalledWith('search-job', { jobId: 'j1' })
  })

  it('入队失败时回滚原状态返回 500', async () => {
    await mockAdminUser()
    const { createServiceClient } = await import('@/lib/supabase/admin')
    const original = { id: 'j1', status: 'failed', retry_count: 2, started_at: null, completed_at: '2026-08-04T00:00:00Z' }
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: original, error: null }) }),
        }),
        // 乐观更新链结尾 .select() 返回成功；回滚链（.eq().eq() 结尾）解构不到 error 时静默继续 → 500
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 'j1' }], error: null }) }),
          }),
        }),
      }),
    })
    const { sendBossJob } = await import('@/lib/boss-client')
    ;(sendBossJob as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('enqueue failed'))
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/retry/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(500)
  })

  it('乐观锁未命中返回 409', async () => {
    await mockAdminUser()
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'failed', retry_count: 2, started_at: null, completed_at: null }, error: null }) }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [], error: null }) }) }),
        }),
      }),
    })
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/retry/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(409)
  })
})
