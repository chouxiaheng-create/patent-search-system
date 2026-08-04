# 管理后台任务队列页 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让现有 admin 角色在管理后台获得"查看全部检索任务队列 + 取消任意卡住任务 + 重跑任意失败任务"的能力。

**Architecture:** 前端 App Router：`app/(app)/admin/jobs/` 新页面（RSC 鉴权 + Client 表格组件）；后端新增 3 个 `/api/admin/jobs*` 路由（全部走 `requireAdmin()` + service-role client）；新增 1 个幂等 SQL 迁移 `admin_cancel_pgboss_job` RPC（允许 service-role 调用、函数内校验 admin）。复用现有机制：worker 5s 取消轮询、handler 幂等重跑、M6 入队失败回滚、M12 upsert 子任务。

**Tech Stack:** Next.js App Router、Supabase (PostgREST nested select)、pg-boss、Vitest、shadcn (Table/Badge/Dialog/Button/Select/Input/Sonner)。

## Global Constraints

- 所有 `/api/admin/*` 路由必须通过 `requireAdmin()`（`app/api/admin/require-admin.ts`），非 admin → 403
- 不新增数据库表、不修改现有表结构、不新建角色
- 迁移 SQL 必须幂等（`CREATE OR REPLACE` / `IF NOT EXISTS`）
- 新迁移应用到远程 Supabase 数据库（服务端 key 在 `.env.local`，用 worker 目录下的 `pg` 执行，路径 `supabase/migrations/`）
- 中文 UI 文案（项目惯例）；代码注释中文
- 复用 `lib/api/handler.ts` 的 `withApiHandler` 包装所有新路由
- 测试沿用 `__tests__/api/jobs-retry-tasks.test.ts` 的 mock 链模式（vi.mock + 链式 builder）
- `npm test`（根目录 vitest）与 `npm run build` 必须通过

---

### Task 1: admin_cancel_pgboss_job RPC 迁移 + 应用

**Files:**
- Create: `supabase/migrations/20260804_admin_cancel_pgboss_job.sql`
- Apply: 远程数据库（pg 脚本）

**Interfaces:**
- Produces: `public.admin_cancel_pgboss_job(p_job_name text, p_job_data jsonb) RETURNS void` — 供 Task 3 通过 service client `admin.rpc(...)` 调用；允许 service-role（`auth.uid()` IS NULL）与 admin 用户调用，拦截其他已登录用户

- [ ] **Step 1: 编写迁移 SQL**

```sql
-- supabase/migrations/20260804_admin_cancel_pgboss_job.sql
-- 管理后台取消：清理 pg-boss 队列中尚未开始执行的 job（state ∈ created/retry）。
-- 与 20260803_cancel_pgboss_job_function.sql 的区别：不做属主校验（管理员可取消任意用户任务）。
-- 安全设计：
-- - 仅两种调用方合法：service-role（auth.uid() 为 NULL，服务端密钥，天然可信）或 role='admin' 的登录用户；
-- - 函数内显式校验，不依赖 RLS 单点防御；
-- - 仅 state ∈ ('created','retry') 的排队中 job 会被清理，执行中的 job 不受影响（由 worker 轮询协作退出）。
-- 幂等：CREATE OR REPLACE，可重复执行。

CREATE OR REPLACE FUNCTION public.admin_cancel_pgboss_job(p_job_name text, p_job_data jsonb)
RETURNS void AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  UPDATE pgboss.job
  SET state = 'cancelled'
  WHERE name = p_job_name
    AND state IN ('created', 'retry')
    AND data = p_job_data;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.admin_cancel_pgboss_job(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cancel_pgboss_job(text, jsonb) TO authenticated;
```

- [ ] **Step 2: 应用到远程数据库**

在 `worker/` 目录执行（复用 M12 应用脚本模式，读文件 → pg client 执行 → 验证函数存在）：

```bash
cd worker && node -e "
require('dotenv').config({path: require('path').resolve(__dirname, '..', '.env.local')});
const fs = require('fs');
const { Client } = require('pg');
const sql = fs.readFileSync(require('path').resolve(__dirname, '..', 'supabase', 'migrations', '20260804_admin_cancel_pgboss_job.sql'), 'utf8');
const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
client.connect().then(async () => {
  await client.query(sql);
  const r = await client.query(\"SELECT proname FROM pg_proc WHERE proname='admin_cancel_pgboss_job'\");
  console.log('admin_cancel_pgboss_job 已创建:', r.rowCount > 0);
  await client.end();
}).catch(e => { console.log('ERROR:', e.message); process.exit(1); });
"
```

Expected: `admin_cancel_pgboss_job 已创建: true`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260804_admin_cancel_pgboss_job.sql
git commit -m "feat(admin): admin_cancel_pgboss_job RPC（管理员取消任意任务用）"
```

---

### Task 2: GET /api/admin/jobs 列表 API

**Files:**
- Create: `app/api/admin/jobs/route.ts`
- Test: `__tests__/api/admin-jobs.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()`（返回 `{ userId, supabase, admin }`）、`ApiError`（`../require-admin` re-export）
- Produces: `GET /api/admin/jobs?status=&email=&page=&pageSize=` →
  ```ts
  { jobs: Array<{
      id: string; status: string; retry_count: number;
      created_at: string | null; started_at: string | null; completed_at: string | null; scheduled_at: string | null;
      user_email: string; document_title: string;
      task_counts: { total: number; done: number; running: number; pending: number; failed: number; abandoned: number };
      progress_percent: number;
    }>;
    total: number; page: number; pageSize: number }
  ```
  - 非法 status → 400；非 admin → 403；DB 错误 → 500

- [ ] **Step 1: 写失败测试** `__tests__/api/admin-jobs.test.ts`

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))
vi.mock('@/lib/boss-client', () => ({ sendBossJob: vi.fn().mockResolvedValue(undefined) }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

// requireAdmin 依赖：getUser → user；profiles.select('role') → admin
function mockAdminUser() {
  const { createClient } = require('@/lib/supabase/server') as any
  createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }) }),
      }),
    }),
  })
}

function mockNonAdminUser() {
  const { createClient } = require('@/lib/supabase/server') as any
  createClient.mockResolvedValue({
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'u1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { role: 'user' }, error: null }) }),
      }),
    }),
  })
}

// 构造 service client 的链式 mock：返回含 3 条任务（含嵌套 search_tasks）的列表
function mockJobsList() {
  const { createServiceClient } = require('@/lib/supabase/admin') as any
  createServiceClient.mockReturnValue({
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
    mockNonAdminUser()
    const { GET } = await import('@/app/api/admin/jobs/route')
    const res = await GET(new Request('http://localhost/api/admin/jobs') as any)
    expect(res.status).toBe(403)
  })

  it('非法 status 参数返回 400', async () => {
    mockAdminUser()
    const { createServiceClient } = require('@/lib/supabase/admin') as any
    createServiceClient.mockReturnValue({
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
    mockAdminUser()
    mockJobsList()
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run __tests__/api/admin-jobs.test.ts`
Expected: FAIL（路由不存在 → import 报错）

- [ ] **Step 3: 实现路由** `app/api/admin/jobs/route.ts`

```ts
// app/api/admin/jobs/route.ts
// GET: 全量检索任务列表（联表用户邮箱/文档标题 + 子任务进度聚合）
// 仅 admin 可访问（requireAdmin 校验）。

import { NextRequest, NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { requireAdmin, ApiError } from '../require-admin'

const VALID_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled']

export const GET = withApiHandler(async (request: NextRequest) => {
  const { admin } = await requireAdmin()

  const sp = new URL(request.url).searchParams
  const status = sp.get('status')?.trim() ?? ''
  const email = sp.get('email')?.trim() ?? ''
  const page = Math.max(1, Number(sp.get('page') ?? '1'))
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? '50')))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  if (status && !VALID_STATUSES.includes(status)) {
    throw new ApiError(400, `非法 status: ${status}`)
  }

  let query = admin.from('search_jobs').select(`
    id, status, retry_count, created_at, started_at, completed_at, scheduled_at,
    user_email:profiles(email),
    document_title:patent_documents(title),
    tasks:search_tasks(id, status)
  `, { count: 'exact' })

  if (status) query = query.eq('status', status)
  if (email) query = query.ilike('profiles.email', `%${email}%`)

  const { data, count, error } = await query
    .order('created_at', { ascending: false })
    .range(from, to)

  if (error) throw new ApiError(500, `DB 查询失败: ${error.message}`)

  const jobs = (data ?? []).map((j: any) => {
    const tasks: Array<{ status: string }> = Array.isArray(j.tasks) ? j.tasks : []
    const task_counts = {
      total: tasks.length,
      done: tasks.filter(t => t.status === 'done').length,
      running: tasks.filter(t => t.status === 'running').length,
      pending: tasks.filter(t => t.status === 'pending' || t.status === 'retrying').length,
      failed: tasks.filter(t => t.status === 'abandoned').length,
      abandoned: tasks.filter(t => t.status === 'abandoned').length,
    }
    return {
      id: j.id,
      status: j.status,
      retry_count: j.retry_count,
      created_at: j.created_at,
      started_at: j.started_at,
      completed_at: j.completed_at,
      scheduled_at: j.scheduled_at,
      user_email: Array.isArray(j.user_email) ? (j.user_email[0]?.email ?? '') : '',
      document_title: Array.isArray(j.document_title) ? (j.document_title[0]?.title ?? '') : '',
      task_counts,
      progress_percent: task_counts.total === 0 ? 0 : Math.round((task_counts.done / task_counts.total) * 100),
    }
  })

  return NextResponse.json({ jobs, total: count ?? 0, page, pageSize })
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run __tests__/api/admin-jobs.test.ts`
Expected: PASS（3 个用例全绿）

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/jobs/route.ts __tests__/api/admin-jobs.test.ts
git commit -m "feat(admin): GET /api/admin/jobs 全量任务队列列表（联表+进度聚合）"
```

---

### Task 3: POST /api/admin/jobs/[jobId]/cancel

**Files:**
- Create: `app/api/admin/jobs/[jobId]/cancel/route.ts`
- Modify: `__tests__/api/admin-jobs.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: `requireAdmin()`、`ApiError`、Task 1 的 `admin_cancel_pgboss_job` RPC
- Produces: `POST /api/admin/jobs/:jobId/cancel` → 200 `{ ok: true }`；终态 400；乐观锁未命中 409；非 admin 403

- [ ] **Step 1: 追加失败测试**（`__tests__/api/admin-jobs.test.ts` 末尾追加）

```ts
describe('POST /api/admin/jobs/[jobId]/cancel', () => {
  function mockParams() {
    return { params: Promise.resolve({ jobId: 'j1' }) }
  }

  it('非 admin 返回 403', async () => {
    mockNonAdminUser()
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/cancel/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(403)
  })

  it('终态任务返回 400', async () => {
    mockAdminUser()
    const { createServiceClient } = require('@/lib/supabase/admin') as any
    createServiceClient.mockReturnValue({
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
    mockAdminUser()
    const { createServiceClient } = require('@/lib/supabase/admin') as any
    const rpc = vi.fn().mockResolvedValue({ error: null })
    const update = vi.fn().mockResolvedValue({ data: [{ id: 'j1' }], error: null })
    createServiceClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'running' }, error: null }) }),
        }),
        update: vi.fn().mockReturnValue({
          set: undefined,
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(update) }),
          }),
        }),
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
    mockAdminUser()
    const { createServiceClient } = require('@/lib/supabase/admin') as any
    createServiceClient.mockReturnValue({
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run __tests__/api/admin-jobs.test.ts`
Expected: FAIL（cancel 路由不存在）

- [ ] **Step 3: 实现路由** `app/api/admin/jobs/[jobId]/cancel/route.ts`

```ts
// app/api/admin/jobs/[jobId]/cancel/route.ts
// 管理员取消任意用户的任务（queued/running → cancelled）。
// - 原子迁移复用用户取消路径的模式（.in('status', ['queued','running']) 防竞争）
// - pg-boss 队列清理走 admin_cancel_pgboss_job RPC（Task 1 迁移），失败不阻塞
// - 运行中任务由 worker 5s 轮询感知 cancelled 后在批次边界退出

import { NextRequest, NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { requireAdmin, ApiError } from '../../../require-admin'

export const POST = withApiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) => {
  const { jobId } = await params
  const { admin } = await requireAdmin()

  const { data: job, error: fetchErr } = await admin
    .from('search_jobs')
    .select('id, status')
    .eq('id', jobId)
    .single()

  if (fetchErr || !job) throw new ApiError(404, '任务不存在')
  if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
    throw new ApiError(400, '任务已结束，无法取消')
  }

  // 原子迁移：仅 queued/running → cancelled，防止与 worker 终态写入竞争
  const { data: updated, error } = await admin
    .from('search_jobs')
    .update({ status: 'cancelled', completed_at: new Date().toISOString() })
    .eq('id', jobId)
    .in('status', ['queued', 'running'])
    .select('id')

  if (error) throw new ApiError(500, error.message)
  if (!updated || updated.length === 0) {
    throw new ApiError(409, '任务状态已变化，无法取消')
  }

  // 清理 pg-boss 队列中排队中的 job（best-effort：失败不阻塞，worker 消费时会检查 cancelled 跳过）
  const { error: rpcErr } = await admin.rpc('admin_cancel_pgboss_job', {
    p_job_name: 'search-job',
    p_job_data: { jobId },
  })
  if (rpcErr) console.warn('[admin-cancel] RPC admin_cancel_pgboss_job failed:', rpcErr.message)

  return NextResponse.json({ ok: true })
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run __tests__/api/admin-jobs.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/jobs/[jobId]/cancel/route.ts __tests__/api/admin-jobs.test.ts
git commit -m "feat(admin): POST 管理员取消任务（原子迁移+队列清理 RPC）"
```

---

### Task 4: POST /api/admin/jobs/[jobId]/retry

**Files:**
- Create: `app/api/admin/jobs/[jobId]/retry/route.ts`
- Modify: `__tests__/api/admin-jobs.test.ts`（追加 describe 块）

**Interfaces:**
- Consumes: `requireAdmin()`、`ApiError`、`sendBossJob`（`@/lib/boss-client`）
- Produces: `POST /api/admin/jobs/:jobId/retry` → 200 `{ ok: true }`；非 failed/completed 400；乐观锁未命中 409；入队失败回滚原状态 → 500

- [ ] **Step 1: 追加失败测试**（`__tests__/api/admin-jobs.test.ts` 末尾追加）

```ts
describe('POST /api/admin/jobs/[jobId]/retry', () => {
  function mockParams() {
    return { params: Promise.resolve({ jobId: 'j1' }) }
  }

  it('非 admin 返回 403', async () => {
    mockNonAdminUser()
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/retry/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(403)
  })

  it('非 failed/completed 状态返回 400', async () => {
    mockAdminUser()
    const { createServiceClient } = require('@/lib/supabase/admin') as any
    createServiceClient.mockReturnValue({
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
    mockAdminUser()
    const { createServiceClient } = require('@/lib/supabase/admin') as any
    const update = vi.fn().mockResolvedValue({ data: [{ id: 'j1' }], error: null })
    createServiceClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 'j1', status: 'failed', retry_count: 2, started_at: null, completed_at: null }, error: null }) }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue(update) }) }),
        }),
      }),
    })
    const { sendBossJob } = require('@/lib/boss-client') as any
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/retry/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(200)
    expect(sendBossJob).toHaveBeenCalledWith('search-job', { jobId: 'j1' })
  })

  it('入队失败时回滚原状态返回 500', async () => {
    mockAdminUser()
    const { createServiceClient } = require('@/lib/supabase/admin') as any
    const original = { id: 'j1', status: 'failed', retry_count: 2, started_at: null, completed_at: '2026-08-04T00:00:00Z' }
    createServiceClient.mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: original, error: null }) }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ select: vi.fn().mockResolvedValue({ data: [{ id: 'j1' }], error: null }) }) }),
        }),
      }),
    })
    const { sendBossJob } = require('@/lib/boss-client') as any
    sendBossJob.mockRejectedValueOnce(new Error('enqueue failed'))
    const { POST } = await import('@/app/api/admin/jobs/[jobId]/retry/route')
    const res = await POST(new Request('http://localhost', { method: 'POST' }) as any, mockParams() as any)
    expect(res.status).toBe(500)
  })

  it('乐观锁未命中返回 409', async () => {
    mockAdminUser()
    const { createServiceClient } = require('@/lib/supabase/admin') as any
    createServiceClient.mockReturnValue({
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
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npx vitest run __tests__/api/admin-jobs.test.ts`
Expected: FAIL（retry 路由不存在）

- [ ] **Step 3: 实现路由** `app/api/admin/jobs/[jobId]/retry/route.ts`

```ts
// app/api/admin/jobs/[jobId]/retry/route.ts
// 管理员重跑任意用户的任务（failed 全量重跑 / completed 部分重试）。
// - handler 幂等：首次运行时自动创建子任务；重跑时跳过 done、重跑非 done（无需改动 worker）
// - 乐观锁 .eq('status', job.status) 防并发双跑；入队失败回滚原状态（M6 模式）

import { NextRequest, NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { requireAdmin, ApiError } from '../../../require-admin'
import { sendBossJob } from '@/lib/boss-client'

export const POST = withApiHandler(async (
  _request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> }
) => {
  const { jobId } = await params
  const { admin } = await requireAdmin()

  const { data: job, error: fetchErr } = await admin
    .from('search_jobs')
    .select('id, status, retry_count, started_at, completed_at')
    .eq('id', jobId)
    .single()

  if (fetchErr || !job) throw new ApiError(404, '任务不存在')
  if (job.status !== 'failed' && job.status !== 'completed') {
    throw new ApiError(400, '仅失败或已完成的任务可重跑')
  }

  // 乐观锁：置回 queued，清时间戳与重排计数
  const { data: updated, error } = await admin
    .from('search_jobs')
    .update({
      status: 'queued',
      retry_count: 0,
      started_at: null,
      completed_at: null,
    })
    .eq('id', jobId)
    .eq('status', job.status)
    .select('id')

  if (error) throw new ApiError(500, error.message)
  if (!updated || updated.length === 0) {
    throw new ApiError(409, '任务状态已被其他请求修改，请刷新后重试')
  }

  try {
    await sendBossJob('search-job', { jobId })
  } catch (bossErr) {
    // 入队失败：回滚到原状态，避免留下无 pg-boss job 的 queued 记录（M6 模式）
    console.error('[admin-retry] sendBossJob failed:', (bossErr as Error).message)
    const { error: rollbackErr } = await admin
      .from('search_jobs')
      .update({
        status: job.status,
        retry_count: job.retry_count,
        started_at: job.started_at,
        completed_at: job.completed_at,
      })
      .eq('id', jobId)
      .eq('status', 'queued')
    if (rollbackErr) console.error('[admin-retry] 回滚任务状态失败:', rollbackErr.message)
    throw new ApiError(500, `入队失败: ${(bossErr as Error).message}`)
  }

  return NextResponse.json({ ok: true })
})
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npx vitest run __tests__/api/admin-jobs.test.ts`
Expected: PASS（全部用例）

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/jobs/[jobId]/retry/route.ts __tests__/api/admin-jobs.test.ts
git commit -m "feat(admin): POST 管理员重跑任务（乐观锁+入队失败回滚）"
```

---

### Task 5: 侧边栏「任务队列」导航入口

**Files:**
- Modify: `components/sidebar.tsx`（admin 区块，约 line 92-115）

**Interfaces:**
- Produces: 管理后台分组下新增「任务队列」链接 → `/admin/jobs`，图标 `ListChecks`；高亮条件 `pathname.startsWith('/admin/jobs')`；原「管理后台」高亮条件保持 `pathname.startsWith('/admin')`

- [ ] **Step 1: 修改 sidebar.tsx**

在 `components/sidebar.tsx` 的 admin 区块（`{isAdmin && (...)}`）内、"管理后台" Link 之后追加：

```tsx
            <Link
              href="/admin/jobs"
              onClick={onNavigate}
              className={cn(
                'flex items-center rounded-xl text-sm font-medium transition-all duration-200',
                collapsed ? 'justify-center p-2.5' : 'gap-2.5 px-3 py-2',
                pathname.startsWith('/admin/jobs')
                  ? 'bg-white/10 text-sidebar-foreground'
                  : 'text-sidebar-foreground/60 hover:text-sidebar-accent-foreground hover:bg-white/10'
              )}
            >
              <ListChecks size={iconSize} strokeWidth={2} />
              {!collapsed && '任务队列'}
            </Link>
```

并在文件顶部 lucide-react import 中追加 `ListChecks`。

- [ ] **Step 2: 类型检查**

Run: `npx tsc --noEmit`（根目录）
Expected: 无错误

- [ ] **Step 3: Commit**

```bash
git add components/sidebar.tsx
git commit -m "feat(admin): 侧边栏新增任务队列入口"
```

---

### Task 6: /admin/jobs 页面 + 表格组件

**Files:**
- Create: `app/(app)/admin/jobs/page.tsx`
- Create: `components/admin/jobs-table.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/jobs`、`POST /api/admin/jobs/:jobId/cancel`、`POST /api/admin/jobs/:jobId/retry`（前面任务定义）
- Produces: 可交互任务队列页（筛选/刷新/取消/重跑/查看报告），报告链接指向 `/admin/reports/[jobId]`（现有页面）

- [ ] **Step 1: 创建 RSC 页面** `app/(app)/admin/jobs/page.tsx`

```tsx
// app/(app)/admin/jobs/page.tsx
// 任务队列页：服务端做初次鉴权，客户端组件接管交互（与 admin/users 页同模式）。

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { JobsTable } from '@/components/admin/jobs-table'

export default async function AdminJobsPage() {
  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()
  const user = authData?.user
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (profile?.role !== 'admin') {
    return <div className="p-8 text-red-600">需要管理员权限</div>
  }

  return (
    <div className="p-6 lg:p-10 max-w-6xl">
      <h1 className="text-2xl font-semibold">任务队列</h1>
      <p className="text-muted-foreground mt-1">
        查看所有用户的任务执行情况；任务卡住时可手动取消，修复后可一键重跑失败任务。
      </p>
      <JobsTable />
    </div>
  )
}
```

- [ ] **Step 2: 创建客户端表格组件** `components/admin/jobs-table.tsx`

```tsx
'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { RefreshCw, RotateCcw, XCircle, Eye, Loader2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

type TaskCounts = { total: number; done: number; running: number; pending: number; failed: number; abandoned: number }
type JobRow = {
  id: string; status: string; retry_count: number
  created_at: string | null; started_at: string | null; completed_at: string | null; scheduled_at: string | null
  user_email: string; document_title: string
  task_counts: TaskCounts; progress_percent: number
}

const STATUS_OPTIONS = [
  { value: '', label: '全部状态' },
  { value: 'queued', label: '排队中' },
  { value: 'running', label: '执行中' },
  { value: 'completed', label: '已完成' },
  { value: 'failed', label: '失败' },
  { value: 'cancelled', label: '已取消' },
]

const statusVariant: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  queued: 'secondary',
  running: 'default',
  completed: 'default',
  failed: 'destructive',
  cancelled: 'outline',
}

const statusLabel: Record<string, string> = {
  queued: '排队中', running: '执行中', completed: '已完成', failed: '失败', cancelled: '已取消',
}

export function JobsTable() {
  const router = useRouter()
  const [jobs, setJobs] = useState<JobRow[]>([])
  const [total, setTotal] = useState(0)
  const [status, setStatus] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ type: 'cancel' | 'retry'; job: JobRow } | null>(null)
  const [acting, setActing] = useState(false)

  const fetchJobs = useCallback(async () => {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (email.trim()) params.set('email', email.trim())
    try {
      const res = await fetch(`/api/admin/jobs?${params.toString()}`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? '加载失败')
      const body = await res.json()
      setJobs(body.jobs ?? [])
      setTotal(body.total ?? 0)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [status, email])

  useEffect(() => { fetchJobs() }, [fetchJobs])
  useEffect(() => {
    const t = setInterval(fetchJobs, 30_000) // 30s 自动刷新
    return () => clearInterval(t)
  }, [fetchJobs])

  async function handleConfirm() {
    if (!confirm) return
    setActing(true)
    try {
      const res = await fetch(`/api/admin/jobs/${confirm.job.id}/${confirm.type}`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error ?? '操作失败')
      toast.success(confirm.type === 'cancel' ? '任务已取消' : '任务已重新入队')
      setConfirm(null)
      fetchJobs()
      router.refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '操作失败')
    } finally {
      setActing(false)
    }
  }

  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—'

  return (
    <div className="mt-6 space-y-4">
      {/* 筛选工具栏 */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={status} onValueChange={setStatus}>
          {/* shadcn Select 需要 SelectTrigger/SelectValue/SelectContent/SelectItem —— 见下方说明 */}
        </Select>
        <Input
          placeholder="按用户邮箱搜索"
          value={email}
          onChange={e => setEmail(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') fetchJobs() }}
          className="w-56"
        />
        <Button variant="outline" size="sm" onClick={fetchJobs} disabled={loading}>
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          刷新
        </Button>
        <span className="text-xs text-muted-foreground">共 {total} 个任务（每 30s 自动刷新）</span>
      </div>

      {error && <div className="text-sm text-red-600">加载失败：{error}</div>}

      <div className="rounded-2xl border bg-white">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>任务</TableHead>
              <TableHead>用户</TableHead>
              <TableHead>文档</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>进度</TableHead>
              <TableHead>创建时间</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 && !loading && (
              <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-8">暂无任务</TableCell></TableRow>
            )}
            {jobs.map(j => (
              <TableRow key={j.id}>
                <TableCell className="font-mono text-xs">{j.id.slice(0, 8)}</TableCell>
                <TableCell>{j.user_email}</TableCell>
                <TableCell className="max-w-[220px] truncate">{j.document_title || '—'}</TableCell>
                <TableCell><Badge variant={statusVariant[j.status]}>{statusLabel[j.status]}</Badge></TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-emerald-500" style={{ width: `${j.progress_percent}%` }} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {j.task_counts.done}/{j.task_counts.total} ({j.progress_percent}%)
                    </span>
                  </div>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{fmt(j.created_at)}</TableCell>
                <TableCell className="text-right whitespace-nowrap">
                  <div className="flex justify-end gap-1.5">
                    {(j.status === 'queued' || j.status === 'running') && (
                      <Button variant="ghost" size="sm" className="text-red-600" onClick={() => setConfirm({ type: 'cancel', job: j })}>
                        <XCircle size={14} /> 取消
                      </Button>
                    )}
                    {(j.status === 'failed' || j.status === 'completed') && (
                      <Button variant="ghost" size="sm" onClick={() => setConfirm({ type: 'retry', job: j })}>
                        <RotateCcw size={14} /> 重跑
                      </Button>
                    )}
                    {j.status === 'completed' && (
                      <Button variant="ghost" size="sm" onClick={() => router.push(`/admin/reports/${j.id}`)}>
                        <Eye size={14} /> 报告
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* 二次确认对话框 */}
      <Dialog open={confirm !== null} onOpenChange={open => { if (!open) setConfirm(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {confirm?.type === 'cancel' ? '确认取消该任务？' : '确认重跑该任务？'}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {confirm?.type === 'cancel'
              ? `任务 ${confirm?.job.id.slice(0, 8)}（${confirm?.job.user_email}）将被立即取消，正在执行的子任务会在批次边界停止。`
              : `任务 ${confirm?.job.id.slice(0, 8)}（${confirm?.job.user_email}）将重新入队执行${confirm?.job.status === 'completed' ? '，仅重跑未完成的子任务' : ''}。`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirm(null)} disabled={acting}>取消</Button>
            <Button
              variant={confirm?.type === 'cancel' ? 'destructive' : 'default'}
              onClick={handleConfirm}
              disabled={acting}
            >
              {acting && <Loader2 size={14} className="animate-spin mr-1" />}
              确认{confirm?.type === 'cancel' ? '取消' : '重跑'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
```

**shadcn Select 说明**：`components/ui/select.tsx` 为标准 shadcn Select（`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`），在上方代码的 `<Select>` 内补全：

```tsx
<SelectTrigger className="w-40"><SelectValue placeholder="全部状态" /></SelectTrigger>
<SelectContent>
  {STATUS_OPTIONS.map(o => (
    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
  ))}
</SelectContent>
```

（`Select` 的 `value`/`onValueChange` 语义：空字符串代表"全部状态"。）

- [ ] **Step 3: 验证**

Run: `npx tsc --noEmit`（根目录）
Expected: 无类型错误

Run: `npm run build`
Expected: 构建成功（新页面、新路由无编译错误）

- [ ] **Step 4: Commit**

```bash
git add app/'(app)'/admin/jobs/page.tsx components/admin/jobs-table.tsx
git commit -m "feat(admin): 任务队列页面（筛选/刷新/取消/重跑/报告入口）"
```

---

### Task 7: 全量验证

**Files:**
- Modify: 无（仅验证）

- [ ] **Step 1: 全量测试**

Run: `npm test`（vitest 单跑 `npx vitest run`）
Expected: 全部通过（含既有用例，不回归）

- [ ] **Step 2: 生产构建**

Run: `npm run build`
Expected: 成功

- [ ] **Step 3: 冒烟验证（浏览器）**

1. `npm run dev` 已运行（端口 3000）
2. 浏览器访问 `http://localhost:3000/admin/jobs`，以 admin 账号登录
3. 验证：任务列表渲染（含进度条）、状态筛选、邮箱搜索、30s 自动刷新提示
4. 对一个 queued/running 任务执行「取消」→ 确认对话框 → 列表状态变为"已取消"
5. 对一个 failed 任务执行「重跑」→ 确认对话框 → 列表状态变为"排队中"，worker 日志出现 `[search-job] Starting job`
6. 对 completed 任务点「报告」→ 跳转 `/admin/reports/[jobId]` 正常

- [ ] **Step 4: 最终提交（如有遗漏）**

```bash
git add -A
git commit -m "chore: 任务队列功能收尾"
```

- [ ] **Step 5: 汇总**

向用户汇报：功能清单、测试/构建结果、迁移已应用、如何访问。
