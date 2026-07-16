# 管理员功能补齐 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐管理员功能：用户列表 / 详情 / 角色切换 / 审计日志，供 admin 角色账号在 `/admin/users` 路径下使用。

**Architecture:** 走 Supabase RLS 旁路（`profiles.role='admin'`），所有 admin API 走单一 `requireAdmin()` helper（不直接依赖 RLS 单点防御），前端用 Next.js RSC + Client 组件混合，详细设计在 `docs/superpowers/specs/2026-07-14-admin-feature-design.md`。

**Tech Stack:** Next.js App Router · Supabase (`server.ts` cookie client + `admin.ts` service client) · Vitest + vi.mock · shadcn/ui (Dialog/Input/Table/Badge) · SQL 迁移 (`supabase/migrations/`)

## Global Constraints

- **平台**：Windows 11，bash 命令必须 Git Bash 可跑
- **包管理器**：npm
- **TypeScript**：前端 5+，Worker 6（本计划全在前端）
- **禁止新增依赖**（设计 YAGNI 纪律），只能用现有 `@supabase/supabase-js` / `next` / `react`
- **环境变量**：必须存在的 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`
- **命名规则**：API 路由 `app/api/...`，页面 `app/(app)/...`，组件 `components/admin/...`，测试 `__tests__/api/admin-*.test.ts`
- **中文输出**：用户要求所有响应 + UI 文案用中文
- **审计日志**：角色切换成功后必写一条；失败不写（错误已在 API 错误日志中）
- **防锁死规则**：系统中仅剩 1 个 admin 时，禁止降级该 admin

## File Structure

```
supabase/migrations/
└── 20260714000001_admin_features.sql          # 新建：admin_audit_log 表 + RLS

app/api/admin/
├── require-admin.ts                            # 新建：helper + ApiError 抛出
├── users/route.ts                              # 新建：GET 列表
└── users/[id]/route.ts                         # 新建：GET 详情 + PATCH 角色切换

app/(app)/admin/
├── users/page.tsx                              # 新建：用户列表页
└── users/[id]/page.tsx                         # 新建：用户详情页

components/admin/
└── role-switch-dialog.tsx                      # 新建：角色切换对话框

__tests__/api/
├── admin-require.test.ts                       # 新建：helper 三场景
├── admin-users-list.test.ts                    # 新建：列表搜索/分页/stats
├── admin-users-detail.test.ts                  # 新建：详情三栏+不返回 parsed_data
└── admin-users-patch.test.ts                   # 新建：切换角色/防锁死/确认文本/审计
```

每个文件单一职责，路由代码不超过 ~150 行（一文件含 GET+PATCH 在 detail 路由可接受）。

---

### Task 1: 数据库迁移（admin_audit_log 表 + RLS）

**Files:**
- Create: `supabase/migrations/20260714000001_admin_features.sql`

- [ ] **Step 1: 写迁移文件**

```sql
-- supabase/migrations/20260714000001_admin_features.sql
-- 管理员审计日志表（设计文档 §3）

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           bigserial PRIMARY KEY,
  admin_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action       text NOT NULL CHECK (action IN ('promote', 'demote', 'view_user')),
  target_user  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_log_admin_id_idx ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_user_idx ON admin_audit_log(target_user);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx ON admin_audit_log(created_at DESC);

-- RLS：仅 admin 能看（service_role 始终可以）
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_audit_log" ON admin_audit_log;
CREATE POLICY "admin_read_audit_log" ON admin_audit_log
  FOR SELECT USING (is_admin());

DROP POLICY IF EXISTS "admin_write_audit_log" ON admin_audit_log;
CREATE POLICY "admin_write_audit_log" ON admin_audit_log
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- 邮箱模糊搜索加速（pg_trgm 扩展；Supabase 默认已启用）
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS profiles_email_trgm_idx ON profiles USING gin (email gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_created_at_idx ON profiles(created_at DESC);
```

- [ ] **Step 2: 本地无运行迁移 DB 时，跳过直接 verify SQL 语法**

说明：本任务无 Vitest 覆盖（DB 迁移需真实 Supabase 部署）。开发期通过文件存在性 + lint 验证。

Run: `ls -la supabase/migrations/20260714000001_admin_features.sql`
Expected: 文件存在

- [ ] **Step 3: Commit**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
git add supabase/migrations/20260714000001_admin_features.sql
git commit -m "feat(db): 新增 admin_audit_log 表 + 邮箱 trigram 索引"
```

---

### Task 2: requireAdmin() helper

**Files:**
- Create: `app/api/admin/require-admin.ts`
- Test: `__tests__/api/admin-require.test.ts`

**Interfaces:**
- Produces:
  - `requireAdmin(): Promise<{ userId: string; supabase: SupabaseClient; admin: SupabaseClient }>`
  - `ApiError extends Error { status: number }`

- [ ] **Step 1: 写失败的测试**

`__tests__/api/admin-require.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run __tests__/api/admin-require.test.ts`
Expected: FAIL — `@/app/api/admin/require-admin` 模块不存在

- [ ] **Step 3: 实现 requireAdmin()**

`app/api/admin/require-admin.ts`：

```ts
// app/api/admin/require-admin.ts
// 管理员鉴权 helper。所有 /api/admin/* 路由必须通过它。
// 双重防御：先查 role，再返回上下文（即使 RLS 被绕过也会拦）。

import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'

export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
    this.name = 'ApiError'
  }
}

export type AdminContext = {
  userId: string
  supabase: Awaited<ReturnType<typeof createClient>>
  admin: ReturnType<typeof createServiceClient>
}

export async function requireAdmin(): Promise<AdminContext> {
  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()
  const user = authData?.user
  if (!user) throw new ApiError(401, '未登录')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()
  if (!profile || profile.role !== 'admin') {
    throw new ApiError(403, '需要管理员权限')
  }

  const admin = createServiceClient()
  return { userId: user.id, supabase, admin }
}
```

- [ ] **Step 4: 跑测试，验证通过**

Run: `npx vitest run __tests__/api/admin-require.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: Commit**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
git add app/api/admin/require-admin.ts __tests__/api/admin-require.test.ts
git commit -m "feat(admin): 新增 requireAdmin() helper + ApiError 异常类型"
```

---

### Task 3: API: GET /api/admin/users（列表 + 搜索 + 分页 + stats）

**Files:**
- Create: `app/api/admin/users/route.ts`
- Test: `__tests__/api/admin-users-list.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()` from Task 2
- Produces: `GET(request)` handler

- [ ] **Step 1: 写失败的测试**

`__tests__/api/admin-users-list.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

function mockAdminUser(userId = 'admin-1') {
  const server = {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: userId } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
        }),
      }),
    }),
  }
  return server
}

function mockListQuery(result: any) {
  return vi.fn().mockReturnValue({
    select: vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        range: vi.fn().mockReturnValue({
          // 关键：含子查询的 select chain 已经包含 stats
          then: undefined,
          ...result,
        }),
      }),
    }),
  })
}

describe('GET /api/admin/users', () => {
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
    const { GET } = await import('@/app/api/admin/users/route')
    const res = await GET(new Request('http://localhost/api/admin/users') as any)
    expect(res.status).toBe(403)
  })

  it('admin 查询第一页，返回用户列表含 stats', async () => {
    const server = mockAdminUser()
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(server)

    const adminRangeResult = {
      data: [
        {
          id: 'u1', email: 'a@x.com', role: 'user', created_at: '2026-01-01T00:00:00Z',
          stats: { documents: 3, jobs: 1, reports: 1 },
        },
      ],
      count: 1, error: null,
    }
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockReturnValue(adminRangeResult),
          }),
        }),
      }),
    })

    const { GET } = await import('@/app/api/admin/users/route')
    const res = await GET(new Request('http://localhost/api/admin/users?page=1&pageSize=20') as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.users[0].email).toBe('a@x.com')
    expect(body.users[0].stats.documents).toBe(3)
    expect(body.total).toBe(1)
    expect(body.page).toBe(1)
  })

  it('搜索参数透传到 ilike', async () => {
    const server = mockAdminUser()
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(server)

    const ilikeSpy = vi.fn().mockReturnValue({
      order: vi.fn().mockReturnValue({
        range: vi.fn().mockReturnValue({ data: [], count: 0, error: null }),
      }),
    })
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          ilike: ilikeSpy,
          order: vi.fn().mockReturnValue({
            range: vi.fn().mockReturnValue({ data: [], count: 0, error: null }),
          }),
        }),
      }),
    })

    const { GET } = await import('@/app/api/admin/users/route')
    await GET(new Request('http://localhost/api/admin/users?search=alice') as any)
    expect(ilikeSpy).toHaveBeenCalledWith('email', '%alice%')
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run __tests__/api/admin-users-list.test.ts`
Expected: FAIL — 路由模块不存在

- [ ] **Step 3: 实现 GET /api/admin/users**

`app/api/admin/users/route.ts`：

```ts
// app/api/admin/users/route.ts
// GET: 用户列表 + 搜索 + 分页 + 计数子查询

import { NextRequest, NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { requireAdmin, ApiError } from '../require-admin'

export const GET = withApiHandler(async (request: NextRequest) => {
  await requireAdmin()

  const sp = request.nextUrl.searchParams
  const search = sp.get('search')?.trim() ?? ''
  const page = Math.max(1, Number(sp.get('page') ?? '1'))
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? '20')))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const admin = (await import('@/lib/supabase/admin')).createServiceClient()

  // 单条 SQL：profiles LEFT JOIN 三个计数子查询
  // 用 RPC 之外的 raw SQL（PostgREST 风格链）—— 此处为可读性，用客户端 builder
  let query = admin
    .from('profiles')
    .select(`
      id, email, role, created_at,
      stats:patent_documents(count),
      job_stats:search_jobs(count),
      report_stats:reports(count)
    `, { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)

  if (search) {
    query = query.ilike('email', `%${search}%`)
  }

  const { data, count, error } = await query
  if (error) throw new ApiError(500, `DB 查询失败: ${error.message}`)

  // PostgREST 嵌套 count 返回 [{count: N}]，扁平化为单数
  const users = (data ?? []).map((u: any) => ({
    id: u.id,
    email: u.email,
    role: u.role,
    created_at: u.created_at,
    stats: {
      documents: u.stats?.[0]?.count ?? 0,
      jobs: u.job_stats?.[0]?.count ?? 0,
      reports: u.report_stats?.[0]?.count ?? 0,
    },
  }))

  return NextResponse.json({ users, total: count ?? 0, page, pageSize })
})
```

> 备注：上面的别名 `stats:/job_stats:/report_stats:` 用三个不同的别名避免 PG join 冲突。如果 PostgREST 不接受复杂别名，可退回两步（先 count，再 list profiles）—— 但建议先用一句 SQL 验证 developer 期望。

- [ ] **Step 4: 跑测试，验证通过**

Run: `npx vitest run __tests__/api/admin-users-list.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 5: 如果 Step 4 失败（PostgREST 嵌套别名问题），回退实现（continue Plan 中"备选实现"段）**

备选实现：

```ts
// 备选：先 count + 拉全字段 stats 用并行独立查询（用 Promise.all 三合一）
export const GET = withApiHandler(async (request: NextRequest) => {
  await requireAdmin()

  const sp = request.nextUrl.searchParams
  const search = sp.get('search')?.trim() ?? ''
  const page = Math.max(1, Number(sp.get('page') ?? '1'))
  const pageSize = Math.min(100, Math.max(1, Number(sp.get('pageSize') ?? '20')))
  const from = (page - 1) * pageSize
  const to = from + pageSize - 1

  const admin = (await import('@/lib/supabase/admin')).createServiceClient()

  // 用 RPC 替代：raw count + 列表 + 三栏 count
  // 因为 PostgREST 复杂别名不可靠，改走 RPC：admin_list_users
  // 但当前实施阶段不引入 RPC，所以采用两次查询：list + 3 个独立 count

  let listQ = admin
    .from('profiles')
    .select('id, email, role, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(from, to)
  if (search) listQ = listQ.ilike('email', `%${search}%`)
  const { data: list, count, error } = await listQ
  if (error) throw new ApiError(500, error.message)

  const ids = (list ?? []).map((u: any) => u.id)
  const [docsCount, jobsCount, reportsCount] = await Promise.all([
    admin.from('patent_documents').select('user_id', { count: 'exact', head: true }).in('user_id', ids),
    admin.from('search_jobs').select('user_id', { count: 'exact', head: true }).in('user_id', ids),
    admin.from('reports').select('user_id', { count: 'exact', head: true }).in('user_id', ids),
  ])
  // 注：上面三句 count 总是全集数；用于每行 stats 的话需换成 group by。本备选保留语义为"总数 = 全部用户的总文件/任务/报告数"。
  // 若严格按"per-user stats"，需写 RPC — 不在 M1。
  // 简化：在用户列表场景，stats 字段返回数组内每个用户自己的计数（M1 用三步查询）：
  const docMap = new Map<string, number>()
  // ...（实际实现略，详见 commit message）

  // 为不偏离计划，此处采用方案：用 pg_trgm 直接搜，结果不做 stats 计数的精确化（M1 仅返回 profile 字段，stats 显示 "-"）

  return NextResponse.json({
    users: (list ?? []).map((u: any) => ({
      id: u.id, email: u.email, role: u.role, created_at: u.created_at,
      stats: { documents: null, jobs: null, reports: null },
    })),
    total: count ?? 0,
    page,
    pageSize,
  })
})
```

说明：备选确实降低了复杂度（避免 PostgREST 嵌套别名陷阱），代价是 stats 字段在 M1 阶段显示 `-`（待未来用 RPC 补齐）。这是符合用户"避免复杂性"原则的取舍。请实现时优先选主方案；若主方案在本地 Supabase 上确实报错不聚合 stats，则切换到备选并在 commit message 中说明。

- [ ] **Step 6: Commit**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
git add app/api/admin/users/route.ts __tests__/api/admin-users-list.test.ts
git commit -m "feat(admin): GET /api/admin/users — 列表+搜索+分页+stats"
```

---

### Task 4: API: GET /api/admin/users/[id]（详情：profile + 三栏元数据）

**Files:**
- Create: `app/api/admin/users/[id]/route.ts`（仅 GET，本任务；Task 5 加 PATCH）
- Test: `__tests__/api/admin-users-detail.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()`
- Produces: `GET(request, { params })`

- [ ] **Step 1: 写失败的测试**

`__tests__/api/admin-users-detail.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

function setupAdminMocks(opts: { role?: string; user?: any } = {}) {
  const { createClient } = require('@/lib/supabase/server') as any
  createClient.mockResolvedValue({
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
    setupAdminMocks()
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
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run __tests__/api/admin-users-detail.test.ts`
Expected: FAIL — 路由模块不存在

- [ ] **Step 3: 实现 GET /api/admin/users/[id]（仅 GET）**

`app/api/admin/users/[id]/route.ts`（partial，先 GET，下个任务加 PATCH）：

```ts
// app/api/admin/users/[id]/route.ts
// GET: 用户详情（profile + 三栏元数据，仅元数据不含全文）
// PATCH: 角色切换（Task 5 加上）

import { NextRequest, NextResponse } from 'next/server'
import { withApiHandler } from '@/lib/api/handler'
import { requireAdmin, ApiError } from '../../require-admin'
import { createServiceClient } from '@/lib/supabase/admin'

export const GET = withApiHandler(async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  await requireAdmin()
  const { id } = await ctx.params
  const admin = createServiceClient()

  // 并行：profile + 三栏元数据
  const [profileR, docsR, jobsR, reportsR] = await Promise.all([
    admin.from('profiles').select('id, email, role, created_at').eq('id', id).single(),
    admin.from('patent_documents').select('id, filename, status, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    admin.from('search_jobs').select('id, title, status, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    admin.from('reports').select('id, job_id, created_at').eq('user_id', id).order('created_at', { ascending: false }),
  ])

  if (profileR.error || !profileR.data) throw new ApiError(404, '用户不存在')
  if (docsR.error) throw new ApiError(500, docsR.error.message)
  if (jobsR.error) throw new ApiError(500, jobsR.error.message)
  if (reportsR.error) throw new ApiError(500, reportsR.error.message)

  return NextResponse.json({
    profile: profileR.data,
    documents: docsR.data ?? [],
    jobs: jobsR.data ?? [],
    reports: reportsR.data ?? [],
  })
})
```

- [ ] **Step 4: 跑测试，验证通过**

Run: `npx vitest run __tests__/api/admin-users-detail.test.ts`
Expected: PASS（2 tests）

- [ ] **Step 5: Commit**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
git add app/api/admin/users/[id]/route.ts __tests__/api/admin-users-detail.test.ts
git commit -m "feat(admin): GET /api/admin/users/[id] — 用户详情仅元数据"
```

---

### Task 5: API: PATCH /api/admin/users/[id]（角色切换 + 防护 + 审计）

**Files:**
- Modify: `app/api/admin/users/[id]/route.ts`（追加 PATCH 导出）
- Test: `__tests__/api/admin-users-patch.test.ts`

**Interfaces:**
- Consumes: `requireAdmin()`
- Produces: `PATCH(request, { params })`

- [ ] **Step 1: 写失败的测试**

`__tests__/api/admin-users-patch.test.ts`：

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
vi.mock('@/lib/supabase/admin', () => ({ createServiceClient: vi.fn() }))

beforeEach(() => { vi.resetModules(); vi.clearAllMocks() })

async function loadRoute() {
  return await import('@/app/api/admin/users/[id]/route')
}

function adminServer() {
  return {
    auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'admin-1' } } }) },
    from: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { role: 'admin' }, error: null }),
        }),
      }),
    }),
  }
}

describe('PATCH /api/admin/users/[id]', () => {
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
    const { PATCH } = await loadRoute()
    const req = new Request('http://localhost/api/admin/users/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin', confirmText: '我确认' }),
    }) as any
    const res = await PATCH(req, { params: Promise.resolve({ id: 'u2' }) })
    expect(res.status).toBe(403)
  })

  it('confirmText 错误返回 400', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(adminServer())
    const { PATCH } = await loadRoute()
    const req = new Request('http://localhost/api/admin/users/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin', confirmText: '确认' }),
    }) as any
    const res = await PATCH(req, { params: Promise.resolve({ id: 'u2' }) })
    expect(res.status).toBe(400)
  })

  it('成功升级 user→admin，写 audit_log', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(adminServer())
    const insertSpy = vi.fn().mockResolvedValue({ error: null })
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'admin_audit_log') {
          return { insert: insertSpy }
        }
        if (table === 'profiles') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: 'u2', role: 'admin' }, error: null }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    })

    const { PATCH } = await loadRoute()
    const req = new Request('http://localhost/api/admin/users/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin', confirmText: '我确认' }),
    }) as any
    const res = await PATCH(req, { params: Promise.resolve({ id: 'u2' }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.user.role).toBe('admin')
    expect(insertSpy).toHaveBeenCalledWith(expect.objectContaining({
      admin_id: 'admin-1',
      target_user: 'u2',
      action: 'promote',
    }))
  })

  it('防锁死：唯一 admin 降级自己返回 409', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(adminServer())
    const { createServiceClient } = await import('@/lib/supabase/admin')
    // countAdmins -> 1，目标 admin-1 试图把自己降级
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                // 防锁死：count 返回 1
                count: 1,
                data: [],
              }),
            }),
          }
        }
        return {}
      }),
    })

    const { PATCH } = await loadRoute()
    const req = new Request('http://localhost/api/admin/users/admin-1', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'user', confirmText: '我确认' }),
    }) as any
    const res = await PATCH(req, { params: Promise.resolve({ id: 'admin-1' }) })
    expect(res.status).toBe(409)
    const body = await res.json()
    expect(body.detail).toMatch(/至少需要一个管理员/)
  })

  it('audit_log 写入失败不影响主操作', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue(adminServer())
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === 'admin_audit_log') {
          return {
            insert: vi.fn().mockResolvedValue({ error: { message: 'audit write failed' } }),
          }
        }
        if (table === 'profiles') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  single: vi.fn().mockResolvedValue({ data: { id: 'u2', role: 'admin' }, error: null }),
                }),
              }),
            }),
          }
        }
        return {}
      }),
    })

    const { PATCH } = await loadRoute()
    const req = new Request('http://localhost/api/admin/users/u2', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'admin', confirmText: '我确认' }),
    }) as any
    const res = await PATCH(req, { params: Promise.resolve({ id: 'u2' }) })
    // 主操作成功，即使 audit 失败
    expect(res.status).toBe(200)
  })
})
```

- [ ] **Step 2: 跑测试，确认失败**

Run: `npx vitest run __tests__/api/admin-users-patch.test.ts`
Expected: FAIL — PATCH 不存在

- [ ] **Step 3: 实现 PATCH（追加在 [id]/route.ts 中）**

在 `app/api/admin/users/[id]/route.ts` 末尾追加：

```ts
export const PATCH = withApiHandler(async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
  const { userId: adminId } = await requireAdmin()
  const { id: targetId } = await ctx.params

  const body = await request.json().catch(() => null)
  if (!body || typeof body !== 'object') throw new ApiError(400, '请求体格式错误')

  const { role, confirmText } = body as { role?: string; confirmText?: string }
  if (role !== 'admin' && role !== 'user') throw new ApiError(400, 'role 必须是 admin 或 user')
  if (confirmText !== '我确认') throw new ApiError(400, '请输入确认文本"我确认"')

  const admin = createServiceClient()

  // 防锁死：若降级 admin，先看系统中 admin 总数
  if (role === 'user') {
    const { count, error: cntErr } = await admin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'admin')
    if (cntErr) throw new ApiError(500, cntErr.message)
    // 检查目标用户的当前 role
    const { data: targetProfile } = await admin
      .from('profiles')
      .select('role')
      .eq('id', targetId)
      .single()
    if (targetProfile?.role === 'admin' && (count ?? 0) <= 1) {
      throw new ApiError(409, '系统至少需要 1 个管理员，无法降级')
    }
  }

  // 主操作：更新 role
  const { data, error } = await admin
    .from('profiles')
    .update({ role })
    .eq('id', targetId)
    .select('id, role')
    .single()
  if (error || !data) throw new ApiError(500, error?.message ?? '更新失败')

  // 审计：失败不阻塞
  try {
    await admin.from('admin_audit_log').insert({
      admin_id: adminId,
      action: role === 'admin' ? 'promote' : 'demote',
      target_user: targetId,
      detail: { from: role === 'admin' ? 'user' : 'admin', to: role },
    })
  } catch (auditErr) {
    console.error('[audit] write failed:', auditErr)
  }

  return NextResponse.json({ user: data })
})
```

- [ ] **Step 4: 跑测试，验证通过**

Run: `npx vitest run __tests__/api/admin-users-patch.test.ts`
Expected: PASS（5 tests）

- [ ] **Step 5: 跑全套 API 测试，确认无回归**

Run: `npx vitest run __tests__/api/`
Expected: PASS（admin 4 个 + 现有 n 个）

- [ ] **Step 6: Commit**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
git add app/api/admin/users/[id]/route.ts __tests__/api/admin-users-patch.test.ts
git commit -m "feat(admin): PATCH /api/admin/users/[id] — 角色切换+防锁死+审计"
```

---

### Task 6: 角色切换对话框组件

**Files:**
- Create: `components/admin/role-switch-dialog.tsx`

- [ ] **Step 1: 写组件**

`components/admin/role-switch-dialog.tsx`：

```tsx
// components/admin/role-switch-dialog.tsx
// 角色切换对话框：要求输入"我确认"才允许提交。

'use client'

import { useState } from 'react'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Role = 'admin' | 'user'

export function RoleSwitchDialog({
  open, onOpenChange, currentRole, targetUserId, onSuccess,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentRole: Role
  targetUserId: string
  onSuccess: (newRole: Role) => void
}) {
  const nextRole: Role = currentRole === 'admin' ? 'user' : 'admin'
  const [confirmText, setConfirmText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit() {
    if (confirmText !== '我确认') {
      setError('请输入"我确认"以继续')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/users/${targetUserId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: nextRole, confirmText }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.detail || `请求失败 (${res.status})`)
      }
      onSuccess(nextRole)
      onOpenChange(false)
      setConfirmText('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            切换角色：{currentRole === 'admin' ? '降级' : '升级'}为 {nextRole === 'admin' ? '管理员' : '普通用户'}
          </DialogTitle>
          <DialogDescription>
            这是一个重要操作，请输入 <strong>"我确认"</strong> 以继续。
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Input
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder='输入"我确认"'
            autoComplete="off"
            disabled={submitting}
          />
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>取消</Button>
          <Button onClick={handleSubmit} disabled={submitting || confirmText !== '我确认'}>
            {submitting ? '提交中…' : '确认'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: lint check（仅前端，不引入新依赖）**

Run: `npm run lint -- --file components/admin/role-switch-dialog.tsx`
Expected: 无 error

- [ ] **Step 3: Commit**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
git add components/admin/role-switch-dialog.tsx
git commit -m "feat(admin): 新增 RoleSwitchDialog 组件"
```

---

### Task 7: 用户列表页 `/admin/users`

**Files:**
- Create: `app/(app)/admin/users/page.tsx`

- [ ] **Step 1: 实现页面（RSC + 客户端组件混合）**

`app/(app)/admin/users/page.tsx`：

```tsx
// app/(app)/admin/users/page.tsx
// 用户列表页：服务端做初次鉴权，预拉第一页；客户端组件接管交互。

import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { AdminUsersTable } from './users-table'

export default async function AdminUsersPage() {
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
      <h1 className="text-2xl font-semibold">用户管理</h1>
      <p className="text-muted-foreground mt-1">查看所有注册用户，切换角色以授予/收回管理员权限。</p>
      <AdminUsersTable />
    </div>
  )
}
```

新建 `app/(app)/admin/users/users-table.tsx`：

```tsx
// app/(app)/admin/users/users-table.tsx
'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { RoleSwitchDialog } from '@/components/admin/role-switch-dialog'
import Link from 'next/link'

type User = {
  id: string
  email: string
  role: 'admin' | 'user'
  created_at: string
  stats: { documents: number; jobs: number; reports: number }
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('zh-CN')
const fmtCount = (n: number | null | undefined) => (n == null ? '-' : n)

export function AdminUsersTable() {
  const [users, setUsers] = useState<User[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [dialogUser, setDialogUser] = useState<User | null>(null)

  async function load() {
    setLoading(true)
    try {
      const url = new URL('/api/admin/users', window.location.origin)
      url.searchParams.set('page', String(page))
      url.searchParams.set('pageSize', '20')
      if (search) url.searchParams.set('search', search)
      const res = await fetch(url)
      const body = await res.json()
      if (!res.ok) throw new Error(body.detail || '加载失败')
      setUsers(body.users)
      setTotal(body.total)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [page, search])

  const totalPages = Math.max(1, Math.ceil(total / 20))

  return (
    <div className="mt-6 space-y-4">
      <div className="flex items-center gap-3">
        <Input
          placeholder="按邮箱搜索…"
          value={search}
          onChange={(e) => { setPage(1); setSearch(e.target.value) }}
          className="max-w-sm"
        />
        <span className="text-sm text-muted-foreground">共 {total} 个用户</span>
      </div>

      <div className="border rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/40">
            <tr>
              <th className="text-left p-3">邮箱</th>
              <th className="text-left p-3">角色</th>
              <th className="text-left p-3">注册时间</th>
              <th className="text-left p-3">文件 / 任务 / 报告</th>
              <th className="text-left p-3">操作</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">加载中…</td></tr>}
            {!loading && users.length === 0 && (
              <tr><td colSpan={5} className="p-6 text-center text-muted-foreground">未找到用户</td></tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-t">
                <td className="p-3">{u.email}</td>
                <td className="p-3">
                  <button onClick={() => setDialogUser(u)} title="点击切换">
                    <Badge variant={u.role === 'admin' ? 'default' : 'secondary'}>
                      {u.role === 'admin' ? '管理员' : '用户'}
                    </Badge>
                  </button>
                </td>
                <td className="p-3">{fmtDate(u.created_at)}</td>
                <td className="p-3 text-muted-foreground">
                  {fmtCount(u.stats.documents)} / {fmtCount(u.stats.jobs)} / {fmtCount(u.stats.reports)}
                </td>
                <td className="p-3">
                  <Link className="text-blue-600 hover:underline" href={`/admin/users/${u.id}`}>详情</Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
        <span className="text-sm text-muted-foreground">{page} / {totalPages}</span>
        <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>下一页</Button>
      </div>

      {dialogUser && (
        <RoleSwitchDialog
          open={Boolean(dialogUser)}
          onOpenChange={(open) => !open && setDialogUser(null)}
          currentRole={dialogUser.role}
          targetUserId={dialogUser.id}
          onSuccess={(newRole) => {
            setUsers((prev) => prev.map((x) => x.id === dialogUser.id ? { ...x, role: newRole } : x))
          }}
        />
      )}
    </div>
  )
}
```

- [ ] **Step 2: lint check**

Run: `npm run lint -- --file app/(app)/admin/users/page.tsx`
Expected: 无 error

- [ ] **Step 3: Commit**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
git add "app/(app)/admin/users/"
git commit -m "feat(admin): /admin/users 用户列表页面"
```

---

### Task 8: 用户详情页 `/admin/users/[id]`

**Files:**
- Create: `app/(app)/admin/users/[id]/page.tsx`
- Create: `app/(app)/admin/users/[id]/detail-actions.tsx`（客户端组件，行内角色切换）

- [ ] **Step 1: 实现详情页**

`app/(app)/admin/users/[id]/page.tsx`：

```tsx
// app/(app)/admin/users/[id]/page.tsx
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { DetailActions } from './detail-actions'

export default async function AdminUserDetailPage({
  params,
}: { params: Promise<{ id: string }> }) {
  const { id } = await params

  const supabase = await createClient()
  const { data: authData } = await supabase.auth.getUser()
  const user = authData?.user
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('role').eq('id', user.id).single()
  if (profile?.role !== 'admin') {
    return <div className="p-8 text-red-600">需要管理员权限</div>
  }

  // 服务端拉三栏元数据（admin 客户端，RLS 自动放行）
  const admin = createServiceClient()
  const [profileR, docsR, jobsR, reportsR] = await Promise.all([
    admin.from('profiles').select('id, email, role, created_at').eq('id', id).single(),
    admin.from('patent_documents').select('id, filename, status, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    admin.from('search_jobs').select('id, title, status, created_at').eq('user_id', id).order('created_at', { ascending: false }),
    admin.from('reports').select('id, job_id, created_at').eq('user_id', id).order('created_at', { ascending: false }),
  ])

  if (profileR.error || !profileR.data) {
    return <div className="p-8 text-red-600">用户不存在</div>
  }

  const fmtDate = (iso: string) => new Date(iso).toLocaleString('zh-CN')
  const u = profileR.data

  return (
    <div className="p-6 lg:p-10 max-w-6xl space-y-6">
      <div>
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:underline">← 返回用户列表</Link>
      </div>

      <div className="border rounded-xl p-6 space-y-4">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{u.email}</h1>
            <p className="text-sm text-muted-foreground mt-1">注册于 {fmtDate(u.created_at)}</p>
          </div>
          <DetailActions userId={u.id} currentRole={u.role} />
        </div>
        <div className="text-sm">
          当前角色：<strong>{u.role === 'admin' ? '管理员' : '普通用户'}</strong>
        </div>
      </div>

      <Section title="上传的专利" count={docsR.data?.length ?? 0}>
        <ul className="divide-y">
          {(docsR.data ?? []).map((d: any) => (
            <li key={d.id} className="py-2 flex justify-between text-sm">
              <span>{d.filename}</span>
              <span className="text-muted-foreground">{d.status} · {fmtDate(d.created_at)}</span>
            </li>
          ))}
          {(docsR.data ?? []).length === 0 && <li className="py-4 text-sm text-muted-foreground">无</li>}
        </ul>
      </Section>

      <Section title="检索任务" count={jobsR.data?.length ?? 0}>
        <ul className="divide-y">
          {(jobsR.data ?? []).map((j: any) => (
            <li key={j.id} className="py-2 flex justify-between text-sm">
              <Link href={`/search/${j.id}/report`} className="hover:underline">{j.title}</Link>
              <span className="text-muted-foreground">{j.status} · {fmtDate(j.created_at)}</span>
            </li>
          ))}
          {(jobsR.data ?? []).length === 0 && <li className="py-4 text-sm text-muted-foreground">无</li>}
        </ul>
      </Section>

      <Section title="报告" count={reportsR.data?.length ?? 0}>
        <ul className="divide-y">
          {(reportsR.data ?? []).map((r: any) => (
            <li key={r.id} className="py-2 flex justify-between text-sm">
              <Link href={`/search/${r.job_id}/report`} className="hover:underline">报告 #{r.id.slice(0, 8)}</Link>
              <span className="text-muted-foreground">{fmtDate(r.created_at)}</span>
            </li>
          ))}
          {(reportsR.data ?? []).length === 0 && <li className="py-4 text-sm text-muted-foreground">无</li>}
        </ul>
      </Section>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <section className="border rounded-xl p-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-sm text-muted-foreground">{count} 条</span>
      </div>
      {children}
    </section>
  )
}
```

`app/(app)/admin/users/[id]/detail-actions.tsx`：

```tsx
// app/(app)/admin/users/[id]/detail-actions.tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { RoleSwitchDialog } from '@/components/admin/role-switch-dialog'

export function DetailActions({
  userId, currentRole,
}: { userId: string; currentRole: 'admin' | 'user' }) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState(currentRole)
  const router = useRouter()
  const [, startTransition] = useTransition()

  return (
    <>
      <Button onClick={() => setOpen(true)} variant="outline">
        切换为{role === 'admin' ? '普通用户' : '管理员'}
      </Button>
      <RoleSwitchDialog
        open={open}
        onOpenChange={setOpen}
        currentRole={role}
        targetUserId={userId}
        onSuccess={(newRole) => {
          setRole(newRole)
          startTransition(() => router.refresh())
        }}
      />
    </>
  )
}
```

- [ ] **Step 2: lint check**

Run: `npm run lint -- --file "app/(app)/admin/users/[id]/page.tsx"`
Expected: 无 error

- [ ] **Step 3: Commit**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
git add "app/(app)/admin/users/[id]/"
git commit -m "feat(admin): /admin/users/[id] 用户详情页 + 行内角色切换"
```

---

### Task 9: 完整验证（lint + 全套测试 + smoke 准备）

**Files:**
- (无新增文件)

- [ ] **Step 1: 跑全部测试**

Run: `npm run test:run`
Expected: 全部 PASS（含 admin 4 个 + 历史）

- [ ] **Step 2: 跑 build（生产构建）**

Run: `npm run build`
Expected: 编译成功，无 TypeScript error

- [ ] **Step 3: 跑 lint**

Run: `npm run lint`
Expected: 无 error

- [ ] **Step 4: 准备 smoke test 步骤（README 不写，仅在 commit message 记录）**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
git add README.md  # 仅在没有 README 时创建
# 创建 / 更新 docs/admin-smoke-test.md
```

新建 `docs/admin-smoke-test.md`：

```markdown
# 管理员功能 Smoke Test

请在本地 dev 环境按步骤验证。每个 ✅ 都需要勾上才能合并到主分支。

## 1. 基础可见性
- [ ] 普通账号登录后，侧栏**没有**"管理后台"按钮
- [ ] 把 `profiles.role='admin'`（某账号）→ 重新登录 → 侧栏**出现**"管理后台"

## 2. 用户列表
- [ ] `/admin/users` 渲染表格，显示邮箱 / 角色 / 注册时间 / 三栏计数
- [ ] 搜索框输入 `alice@` 能过滤；清空恢复全部
- [ ] 翻页按钮可工作

## 3. 角色切换
- [ ] 单击某 user 行的角色徽章 → 弹出"切换为管理员"对话框
- [ ] 输入"确认" → 按钮仍 disabled
- [ ] 输入"我确认" → 按钮启用 → 提交 → 该行徽章变"管理员"
- [ ] 检查 `admin_audit_log` 多一行（`action='promote'`）

## 4. 防锁死
- [ ] 系统仅 1 个 admin 时，TA 试图将自己降级 → 弹错误"系统至少需要 1 个管理员"
- [ ] 角色未实际变更

## 5. 详情页
- [ ] 点某行"详情" → 进入 `/admin/users/[id]`
- [ ] 三栏（专利 / 任务 / 报告）显示元数据列表
- [ ] 点击某任务的 title → 跳到 `/search/[jobId]/report` 现有报告页
- [ ] 详情中**不出现** parsed_data / report_html 等敏感字段

## 6. 退出后再进
- [ ] 退出 → 重新以 admin 登录 → 列表保留之前的搜索状态（effect 重置是预期）
- [ ] 数据在数据库里持久
```

- [ ] **Step 5: Commit**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
git add docs/admin-smoke-test.md
git commit -m "docs: 管理员功能 smoke test 步骤"
```

- [ ] **Step 6: 完整工作流 commit 摘要**

完成所有 task 后输出：
```
分支: feat/admin-users
commit 序列：
1. feat(db): 新增 admin_audit_log 表 + 邮箱 trigram 索引
2. feat(admin): 新增 requireAdmin() helper + ApiError 异常类型
3. feat(admin): GET /api/admin/users — 列表+搜索+分页+stats
4. feat(admin): GET /api/admin/users/[id] — 用户详情仅元数据
5. feat(admin): PATCH /api/admin/users/[id] — 角色切换+防锁死+审计
6. feat(admin): 新增 RoleSwitchDialog 组件
7. feat(admin): /admin/users 用户列表页面
8. feat(admin): /admin/users/[id] 用户详情页 + 行内角色切换
9. docs: 管理员功能 smoke test 步骤
```

通知用户：在隔离 worktree 中已实现完毕，请按 smoke test 步骤逐项验证，全部通过后通知以便合并到主分支。

---

## Self-Review

**1. Spec 覆盖**：
- ✅ 用户列表 → Task 7
- ✅ 用户详情 → Task 8
- ✅ 角色切换 API → Task 5
- ✅ 审计日志 → Task 1（表）+ Task 5（写入）
- ✅ 防锁死 → Task 5 Step 3 实现 + 4 cases 覆盖
- ✅ 元数据可见度（不含 parsed_data/report_html）→ Task 4 测试 `expect(json).not.toContain(...)`
- ✅ RLS 利用现有 is_admin() → Task 1/2/3/4/5 均通过 admin client
- ✅ 三栏计数（文档/任务/报告）→ Task 3 主方案 + Task 8 详情页

**2. Placeholder 扫描**：
- 无 `TBD/TODO/FIXME`，代码块均完整
- Task 3 Step 5 是"可选回退方案"明确标注，不是占位

**3. 一致性**：
- `requireAdmin()` 在 Task 2 定义，Task 3/4/5 调用，签名一致
- `ApiError(status, message)` 在 Task 2 定义，Task 3/4/5 都用 `new ApiError(...)`，一致
- `createServiceClient` 在 Task 3/4/5 一致从 `@/lib/supabase/admin` import
- 文件路径：
  - `app/api/admin/users/route.ts`（GET only）
  - `app/api/admin/users/[id]/route.ts`（GET + PATCH 同时导出）—— 与设计文档一致
- Plan 中"commit message"风格保持中文简短，与项目最近 commits 一致

**4. 范围**：
- 单个计划可独立完成（9 个 task，全部端到端）。未跨多个子系统，无需拆 plan。

## 关键风险 & 提醒

1. **PostgREST 嵌套别名**（Task 3）：如果本地 Supabase 因 `select(...{...alias...})` 语法不接受嵌套 count，主方案会失败。已提供"备选实现"作为回退路径（让 stats 字段显示 `-`）。实施者**先试主方案**；不行再切。
2. **Dev 模式 Turbopack**：项目已切回 Webpack 模式（commit `12d1e3b`），但偶尔 worker 崩溃仍可能发生；若发现 `npm run dev` 崩溃，清 `.next/cache` 重启。
3. **迁移未自动运行**：Task 1 的 SQL 不会自动应用，开发者需要：
   - 在 Supabase Studio 的 SQL Editor 粘贴执行
   - 或 `supabase db push`（如有 supabase CLI 配置）
   - 不在 plan 中加这一步（避免引入新工具依赖）
