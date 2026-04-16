# Plan 2: 三步检索向导 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 `/search/new` 三步向导，允许用户上传/复用专利文献、配置 AI 检索平台与策略，并提交检索任务（支持立即或定时执行），同时支持"自动挡"模式（保存偏好一键提交）。

**Architecture:** Next.js API Routes 提供 9 个 REST 端点（服务端用 Supabase service_role_key 写入，并通过 pg-boss 向 Worker 投递任务）；前端三个 `(app)/search/new/step-N/page.tsx` 页面组合 10 个向导专用 UI 组件，通过 Supabase Realtime 订阅解析状态变更；手动挡走 Step 1→2→3，自动挡通过 URL `auto=1` 跳过 Step 2。

**Tech Stack:** Next.js 16 App Router (TypeScript), Supabase JS SDK v2 (@supabase/ssr), pg-boss v12, shadcn/ui (含新增 tooltip/select/textarea/checkbox), Tailwind CSS, Vitest

---

## 文件结构

```
app/
  api/
    documents/
      route.ts                          # POST: 创建文档记录 + 入队 parse-job
    documents/[documentId]/
      route.ts                          # GET + PATCH: 查询文档状态 / 编辑解析结果
    jobs/
      route.ts                          # POST: 创建 search_job + 入队 search-job
    models/
      route.ts                          # GET: 列出可用 AI 模型
    strategies/
      route.ts                          # GET + POST: 列出/新建检索策略
    strategies/[strategyId]/
      route.ts                          # PUT: 更新自定义策略
    queue-status/
      route.ts                          # GET: 查询排队数量
    preferences/
      route.ts                          # GET + PUT: 用户偏好配置
    worker-ping/
      route.ts                          # GET: 唤醒 Render Worker（fire-and-forget）
  (app)/
    search/
      new/
        step-1/page.tsx                 # 上传 & 解析步骤
        step-2/page.tsx                 # 配置检索步骤
        step-3/page.tsx                 # 确认提交步骤
components/
  wizard/
    wizard-progress.tsx                 # 顶部三步进度条
    model-selector.tsx                  # 模型多/单选，不满足条件的灰显+tooltip
    prompt-editor.tsx                   # 可折叠的提示词 Textarea（含默认值）
    file-upload-zone.tsx                # 拖拽上传区，含上传进度
    history-doc-picker.tsx              # 历史文档下拉复用
    parse-result-form.tsx               # 解析结果展示与编辑（6 字段 + user_notes）
    strategy-sheet.tsx                  # 提示词查看/编辑侧抽屉（Sheet）
    queue-status-banner.tsx             # 队列状态横幅，30s 轮询
    job-summary-card.tsx                # Step 3 任务摘要卡片
    schedule-toggle.tsx                 # 立即/定时切换 + datetime-local 选择器
lib/
  supabase/
    admin.ts                            # NEW: createServiceClient()（使用 service_role_key）
    types.ts                            # MODIFY: 新增 ParseConfig / UserPreferences，更新 PatentDocument
  boss-client.ts                        # NEW: 单例 pg-boss 客户端（仅用于 send，供 API Routes 使用）
supabase/
  migrations/
    20260415000001_add_preferences.sql  # ALTER TABLE profiles ADD COLUMN preferences
    20260415000002_add_parse_config.sql # ALTER TABLE patent_documents ADD COLUMN parse_config
    20260415000003_storage_setup.sql    # Storage bucket + RLS policies
__tests__/
  api/
    preferences.test.ts                 # GET + PUT /api/preferences
    documents.test.ts                   # POST /api/documents
    jobs.test.ts                        # POST /api/jobs
```

---

## Task 1: DB Migrations + 类型扩展

**Files:**
- Create: `supabase/migrations/20260415000001_add_preferences.sql`
- Create: `supabase/migrations/20260415000002_add_parse_config.sql`
- Create: `supabase/migrations/20260415000003_storage_setup.sql`
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1: 创建 preferences migration**

```sql
-- supabase/migrations/20260415000001_add_preferences.sql
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS preferences JSONB DEFAULT NULL;
```

- [ ] **Step 2: 创建 parse_config migration**

```sql
-- supabase/migrations/20260415000002_add_parse_config.sql
ALTER TABLE patent_documents
  ADD COLUMN IF NOT EXISTS parse_config JSONB DEFAULT NULL;
```

- [ ] **Step 3: 创建 Storage bucket + RLS migration**

```sql
-- supabase/migrations/20260415000003_storage_setup.sql

-- 创建文档存储桶（私有）
INSERT INTO storage.buckets (id, name, public)
VALUES ('documents', 'documents', false)
ON CONFLICT (id) DO NOTHING;

-- 用户只能上传到自己的路径
CREATE POLICY "users_upload_own_documents"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 用户只能读取自己上传的文件
CREATE POLICY "users_read_own_documents"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);

-- 用户只能删除自己上传的文件
CREATE POLICY "users_delete_own_documents"
ON storage.objects FOR DELETE
USING (
  bucket_id = 'documents'
  AND auth.uid()::text = (storage.foldername(name))[1]
);
```

- [ ] **Step 4: 推送 migrations**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
supabase db push
```

预期：三个新 migration 按顺序执行，终端无报错。

- [ ] **Step 5: 更新 lib/supabase/types.ts**

在文件末尾追加以下新接口（保留所有现有内容不变），并更新 `PatentDocument` 和 `Profile` 接口：

将 `PatentDocument` 接口替换为：

```ts
export interface ParseConfig {
  model_id: string
  system_prompt: string
}

export interface UserPreferences {
  parse_model_id: string
  parse_system_prompt: string
  search_model_ids: string[]
  strategy_ids: string[]
  per_task_limit: number
  report_limit: number
  report_model_id: string
  report_system_prompt: string
}

export interface PatentDocument {
  id: string
  user_id: string
  title: string
  file_url: string
  file_type: FileType
  parse_status: ParseStatus
  parsed_data: {
    tech_theme?: string
    applicant?: string
    inventor?: string
    filing_date?: string
    main_tech_steps?: string
    core_invention?: string
    custom_fields?: Record<string, string>
  } | null
  parse_config: ParseConfig | null
  quality_warning: boolean
  user_notes: string | null
  created_at: string
}
```

将 `Profile` 接口替换为：

```ts
export interface Profile {
  id: string
  role: UserRole
  display_name: string | null
  preferences: UserPreferences | null
  created_at: string
}
```

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/ lib/supabase/types.ts
git commit -m "feat: add preferences/parse_config migrations and type extensions"
```

---

## Task 2: 安装缺失的 shadcn/ui 组件 + 工具函数

**Files:**
- Installs: `components/ui/tooltip.tsx`, `components/ui/select.tsx`, `components/ui/textarea.tsx`, `components/ui/checkbox.tsx`
- Create: `lib/supabase/admin.ts`
- Create: `lib/boss-client.ts`
- Modify: `.env.local.example`

- [ ] **Step 1: 安装缺失的 shadcn/ui 组件**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
npx shadcn@latest add tooltip select textarea checkbox
```

预期：四个组件文件出现在 `components/ui/`，终端无报错。

- [ ] **Step 2: 创建 Supabase service role 客户端**

```ts
// lib/supabase/admin.ts
import { createClient } from '@supabase/supabase-js'

/**
 * 使用 service_role_key 创建绕过 RLS 的 Supabase 客户端。
 * 仅在服务端（API Routes / Server Actions）使用，绝不暴露到浏览器。
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  )
}
```

- [ ] **Step 3: 创建 pg-boss 单例客户端**

```ts
// lib/boss-client.ts
import PgBoss from 'pg-boss'

// 模块级单例：在同一 Node.js 进程中复用，避免重复初始化
declare global {
  // eslint-disable-next-line no-var
  var _pgBoss: PgBoss | undefined
}

export async function getBossClient(): Promise<PgBoss> {
  if (!global._pgBoss) {
    global._pgBoss = new PgBoss(process.env.DATABASE_URL!)
    await global._pgBoss.start()
  }
  return global._pgBoss
}
```

> **说明：** 此客户端仅用于 `boss.send()`（投递任务），不用于 `boss.work()`。pg-boss 会自动创建队列 schema（若不存在）。

- [ ] **Step 4: 安装 pg-boss 到主项目依赖**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
npm install pg-boss
```

- [ ] **Step 5: 更新 .env.local.example**

```bash
# .env.local.example
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
# pg-boss 队列（Supabase 直连 URI，在 Supabase 控制台 Settings → Database → Connection String → URI）
DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
# Worker 服务 URL（用于唤醒 Render，本地开发可留空）
WORKER_URL=https://your-worker.onrender.com
```

- [ ] **Step 6: Commit**

```bash
git add lib/supabase/admin.ts lib/boss-client.ts .env.local.example components/ui/
git commit -m "feat: add service client, pg-boss singleton, and missing shadcn components"
```

---

## Task 3: API Routes — 查询类端点

**Files:**
- Create: `app/api/models/route.ts`
- Create: `app/api/strategies/route.ts`
- Create: `app/api/queue-status/route.ts`
- Create: `app/api/worker-ping/route.ts`

- [ ] **Step 1: 创建 GET /api/models**

```ts
// app/api/models/route.ts
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('ai_models')
    .select('*')
    .or(`owner_id.is.null,owner_id.eq.${user.id}`)
    .order('is_builtin', { ascending: false })
    .order('name')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
```

- [ ] **Step 2: 创建 GET /api/strategies 和 POST /api/strategies**

```ts
// app/api/strategies/route.ts
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('search_strategies')
    .select('*')
    .or(`owner_id.is.null,owner_id.eq.${user.id}`)
    .order('is_builtin', { ascending: false })
    .order('name')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, prompt_template } = body as { name: string; prompt_template: string }

  if (!name?.trim() || !prompt_template?.trim()) {
    return Response.json({ error: '名称和提示词模板不能为空' }, { status: 400 })
  }

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('search_strategies')
    .insert({ owner_id: user.id, name: name.trim(), prompt_template: prompt_template.trim(), is_builtin: false })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
```

- [ ] **Step 3: 创建 PUT /api/strategies/[strategyId]**

```ts
// app/api/strategies/[strategyId]/route.ts
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ strategyId: string }> }
) {
  const { strategyId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, prompt_template } = body as { name?: string; prompt_template?: string }

  // 仅允许修改自己的策略（不可修改内置策略）
  const { data: existing } = await supabase
    .from('search_strategies')
    .select('id, owner_id, is_builtin')
    .eq('id', strategyId)
    .single()

  if (!existing) return Response.json({ error: '策略不存在' }, { status: 404 })
  if (existing.is_builtin || existing.owner_id !== user.id) {
    return Response.json({ error: '无权修改此策略' }, { status: 403 })
  }

  const updates: Record<string, string> = {}
  if (name?.trim()) updates.name = name.trim()
  if (prompt_template?.trim()) updates.prompt_template = prompt_template.trim()

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('search_strategies')
    .update(updates)
    .eq('id', strategyId)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
```

- [ ] **Step 4: 创建 GET /api/queue-status**

```ts
// app/api/queue-status/route.ts
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { count, error } = await supabase
    .from('search_jobs')
    .select('*', { count: 'exact', head: true })
    .eq('status', 'queued')

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ queuedCount: count ?? 0 })
}
```

- [ ] **Step 5: 创建 GET /api/worker-ping**

```ts
// app/api/worker-ping/route.ts
import { NextRequest } from 'next/server'

export async function GET(_request: NextRequest) {
  const workerUrl = process.env.WORKER_URL
  if (workerUrl) {
    // fire-and-forget：唤醒 Render Worker，不等待结果
    fetch(`${workerUrl}/health`, {
      signal: AbortSignal.timeout(3000),
    }).catch(() => {
      // 忽略错误——仅唤醒，不阻塞用户提交流程
    })
  }
  return Response.json({ ok: true })
}
```

- [ ] **Step 6: Commit**

```bash
git add app/api/models/ app/api/strategies/ app/api/queue-status/ app/api/worker-ping/
git commit -m "feat: add models, strategies, queue-status, worker-ping API routes"
```

---

## Task 4: API Routes — 偏好配置端点（含测试）

**Files:**
- Create: `app/api/preferences/route.ts`
- Create: `__tests__/api/preferences.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// __tests__/api/preferences.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockSelect = vi.fn()
const mockUpdate = vi.fn()
const mockEq = vi.fn()
const mockSingle = vi.fn()

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: { getUser: mockGetUser },
    from: vi.fn().mockReturnValue({
      select: mockSelect,
      update: mockUpdate,
    }),
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
    const req = new Request('http://localhost/api/preferences')
    const res = await GET(req as any)
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
    const req = new Request('http://localhost/api/preferences')
    const res = await GET(req as any)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toEqual({ parse_model_id: 'model-1' })
  })
})

describe('PUT /api/preferences', () => {
  it('未登录时返回 401', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null } })
    const { PUT } = await import('@/app/api/preferences/route')
    const req = new Request('http://localhost/api/preferences', {
      method: 'PUT',
      body: JSON.stringify({ parse_model_id: 'model-1' }),
    })
    const res = await PUT(req as any)
    expect(res.status).toBe(401)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
npm run test:run -- __tests__/api/preferences.test.ts
```

预期：FAIL（`Cannot find module '@/app/api/preferences/route'`）

- [ ] **Step 3: 实现 GET/PUT /api/preferences**

```ts
// app/api/preferences/route.ts
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import type { UserPreferences } from '@/lib/supabase/types'

export async function GET(_request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('profiles')
    .select('preferences')
    .eq('id', user.id)
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data?.preferences ?? null)
}

export async function PUT(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const preferences = await request.json() as UserPreferences

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('profiles')
    .update({ preferences })
    .eq('id', user.id)
    .select('preferences')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data?.preferences)
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npm run test:run -- __tests__/api/preferences.test.ts
```

预期：所有测试通过。

- [ ] **Step 5: Commit**

```bash
git add app/api/preferences/ __tests__/api/preferences.test.ts
git commit -m "feat: add preferences API route (GET/PUT) with tests"
```

---

## Task 5: API Routes — 文档端点（含测试）

**Files:**
- Create: `app/api/documents/route.ts`
- Create: `app/api/documents/[documentId]/route.ts`
- Create: `__tests__/api/documents.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// __tests__/api/documents.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()
const mockBossClient = { send: vi.fn().mockResolvedValue('job-id') }

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/boss-client', () => ({
  getBossClient: vi.fn().mockResolvedValue(mockBossClient),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('POST /api/documents', () => {
  it('未登录时返回 401', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })

    const { POST } = await import('@/app/api/documents/route')
    const req = new Request('http://localhost/api/documents', {
      method: 'POST',
      body: JSON.stringify({ fileUrl: 'path/file.pdf', fileName: 'test.pdf', fileType: 'pdf', parseModelId: 'model-1', parseSystemPrompt: 'prompt' }),
    })
    const res = await POST(req as any)
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
            single: vi.fn().mockResolvedValue({
              data: { id: 'doc-uuid' },
              error: null,
            }),
          }),
        }),
      }),
    })

    const { POST } = await import('@/app/api/documents/route')
    const req = new Request('http://localhost/api/documents', {
      method: 'POST',
      body: JSON.stringify({
        fileUrl: 'user-1/test.pdf',
        fileName: 'test.pdf',
        fileType: 'pdf',
        parseModelId: 'model-1',
        parseSystemPrompt: '解析提示词',
      }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.documentId).toBe('doc-uuid')
    expect(mockBossClient.send).toHaveBeenCalledWith(
      'parse-job',
      expect.objectContaining({ documentId: 'doc-uuid' })
    )
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm run test:run -- __tests__/api/documents.test.ts
```

预期：FAIL（模块不存在）

- [ ] **Step 3: 实现 POST /api/documents**

```ts
// app/api/documents/route.ts
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { getBossClient } from '@/lib/boss-client'
import type { FileType } from '@/lib/supabase/types'

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { fileUrl, fileName, fileType, parseModelId, parseSystemPrompt } = body as {
    fileUrl: string
    fileName: string
    fileType: FileType
    parseModelId: string
    parseSystemPrompt: string
  }

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('patent_documents')
    .insert({
      user_id: user.id,
      title: fileName,
      file_url: fileUrl,
      file_type: fileType,
      parse_status: 'pending',
      parse_config: { model_id: parseModelId, system_prompt: parseSystemPrompt },
    })
    .select('id')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const boss = await getBossClient()
  await boss.send('parse-job', {
    documentId: data.id,
    parseModelId,
    parseSystemPrompt,
  })

  return Response.json({ documentId: data.id }, { status: 201 })
}
```

- [ ] **Step 4: 实现 GET/PATCH /api/documents/[documentId]**

```ts
// app/api/documents/[documentId]/route.ts
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data, error } = await supabase
    .from('patent_documents')
    .select('*')
    .eq('id', documentId)
    .eq('user_id', user.id)
    .single()

  if (error || !data) return Response.json({ error: '文档不存在' }, { status: 404 })
  return Response.json(data)
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const { documentId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  // 校验文档归属
  const { data: doc } = await supabase
    .from('patent_documents')
    .select('id')
    .eq('id', documentId)
    .eq('user_id', user.id)
    .single()

  if (!doc) return Response.json({ error: '文档不存在或无权修改' }, { status: 404 })

  const body = await request.json()
  const { parsed_data, user_notes } = body as {
    parsed_data?: Record<string, unknown>
    user_notes?: string
  }

  const updates: Record<string, unknown> = {}
  if (parsed_data !== undefined) updates.parsed_data = parsed_data
  if (user_notes !== undefined) updates.user_notes = user_notes

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('patent_documents')
    .update(updates)
    .eq('id', documentId)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
npm run test:run -- __tests__/api/documents.test.ts
```

预期：所有测试通过。

- [ ] **Step 6: Commit**

```bash
git add app/api/documents/ __tests__/api/documents.test.ts
git commit -m "feat: add documents API routes (POST, GET, PATCH) with tests"
```

---

## Task 6: API Routes — 任务创建端点（含测试）

**Files:**
- Create: `app/api/jobs/route.ts`
- Create: `__tests__/api/jobs.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// __tests__/api/jobs.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockBossClient = { send: vi.fn().mockResolvedValue('job-id') }

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createServiceClient: vi.fn(),
}))

vi.mock('@/lib/boss-client', () => ({
  getBossClient: vi.fn().mockResolvedValue(mockBossClient),
}))

beforeEach(() => {
  vi.resetModules()
  vi.clearAllMocks()
})

describe('POST /api/jobs', () => {
  it('未登录时返回 401', async () => {
    const { createClient } = await import('@/lib/supabase/server')
    ;(createClient as ReturnType<typeof vi.fn>).mockResolvedValue({
      auth: { getUser: vi.fn().mockResolvedValue({ data: { user: null } }) },
    })
    const { POST } = await import('@/app/api/jobs/route')
    const req = new Request('http://localhost/api/jobs', { method: 'POST', body: '{}' })
    const res = await POST(req as any)
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
              single: vi.fn().mockResolvedValue({
                data: { id: 'doc-1', parse_status: 'parsing' },
                error: null,
              }),
            }),
          }),
        }),
      }),
    })

    const { POST } = await import('@/app/api/jobs/route')
    const req = new Request('http://localhost/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        documentId: 'doc-1',
        config: { model_ids: ['m1'], strategy_ids: ['s1'], per_task_limit: 5, report_limit: 10, report_model_id: 'm1', report_system_prompt: 'prompt' },
      }),
    })
    const res = await POST(req as any)
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
              single: vi.fn().mockResolvedValue({
                data: { id: 'doc-1', parse_status: 'done' },
                error: null,
              }),
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
    const req = new Request('http://localhost/api/jobs', {
      method: 'POST',
      body: JSON.stringify({
        documentId: 'doc-1',
        config: { model_ids: ['m1'], strategy_ids: ['s1'], per_task_limit: 5, report_limit: 10, report_model_id: 'm1', report_system_prompt: 'prompt' },
      }),
    })
    const res = await POST(req as any)
    expect(res.status).toBe(201)
    const body = await res.json()
    expect(body.jobId).toBe('job-uuid')
    expect(mockBossClient.send).toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm run test:run -- __tests__/api/jobs.test.ts
```

预期：FAIL

- [ ] **Step 3: 实现 POST /api/jobs**

```ts
// app/api/jobs/route.ts
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'
import { getBossClient } from '@/lib/boss-client'

interface JobConfig {
  model_ids: string[]
  strategy_ids: string[]
  per_task_limit: number
  report_limit: number
  report_model_id: string
  report_system_prompt: string
}

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { documentId, config, scheduledAt } = body as {
    documentId: string
    config: JobConfig
    scheduledAt?: string
  }

  // 验证文档属于当前用户且已解析完成
  const { data: doc } = await supabase
    .from('patent_documents')
    .select('id, parse_status')
    .eq('id', documentId)
    .eq('user_id', user.id)
    .single()

  if (!doc) return Response.json({ error: '文档不存在' }, { status: 404 })
  if (doc.parse_status !== 'done') {
    return Response.json({ error: '文档尚未解析完成，无法发起检索' }, { status: 400 })
  }

  const admin = createServiceClient()
  const { data: job, error } = await admin
    .from('search_jobs')
    .insert({
      user_id: user.id,
      document_id: documentId,
      status: 'queued',
      config,
      scheduled_at: scheduledAt ?? null,
    })
    .select('id')
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })

  const boss = await getBossClient()
  await boss.send(
    'search-job',
    { jobId: job.id },
    scheduledAt ? { startAfter: new Date(scheduledAt) } : undefined
  )

  return Response.json({ jobId: job.id }, { status: 201 })
}
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npm run test:run -- __tests__/api/jobs.test.ts
```

预期：所有测试通过。

- [ ] **Step 5: Commit**

```bash
git add app/api/jobs/ __tests__/api/jobs.test.ts
git commit -m "feat: add jobs API route (POST) with tests"
```

---

## Task 7: 向导基础 UI 组件

**Files:**
- Create: `components/wizard/wizard-progress.tsx`
- Create: `components/wizard/model-selector.tsx`
- Create: `components/wizard/prompt-editor.tsx`

- [ ] **Step 1: 创建 WizardProgress（三步进度条）**

```tsx
// components/wizard/wizard-progress.tsx
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Step {
  label: string
}

const STEPS: Step[] = [
  { label: '上传文件' },
  { label: '配置检索' },
  { label: '确认提交' },
]

interface WizardProgressProps {
  currentStep: 1 | 2 | 3
}

export function WizardProgress({ currentStep }: WizardProgressProps) {
  return (
    <nav aria-label="检索向导进度" className="flex items-center gap-0 mb-8">
      {STEPS.map((step, index) => {
        const stepNumber = index + 1
        const isCompleted = stepNumber < currentStep
        const isActive = stepNumber === currentStep

        return (
          <div key={step.label} className="flex items-center">
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  'w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium border-2 shrink-0',
                  isCompleted && 'bg-blue-600 border-blue-600 text-white',
                  isActive && 'bg-white border-blue-600 text-blue-600',
                  !isCompleted && !isActive && 'bg-white border-slate-300 text-slate-400'
                )}
              >
                {isCompleted ? <Check size={14} /> : stepNumber}
              </span>
              <span
                className={cn(
                  'text-sm font-medium',
                  isActive && 'text-blue-600',
                  isCompleted && 'text-slate-700',
                  !isCompleted && !isActive && 'text-slate-400'
                )}
              >
                {step.label}
              </span>
            </div>
            {index < STEPS.length - 1 && (
              <div
                className={cn(
                  'h-px w-12 mx-3',
                  stepNumber < currentStep ? 'bg-blue-600' : 'bg-slate-200'
                )}
              />
            )}
          </div>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: 创建 ModelSelector（模型选择器，支持灰显 + tooltip）**

```tsx
// components/wizard/model-selector.tsx
import { cn } from '@/lib/utils'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import type { AIModel } from '@/lib/supabase/types'

/** 判断模型是否满足检索要求（deep_reasoning + web_search） */
function isSearchCapable(model: AIModel): boolean {
  return model.capabilities.deep_reasoning && model.capabilities.web_search
}

/** 判断模型是否满足解析/报告要求（deep_reasoning） */
function isReasoningCapable(model: AIModel): boolean {
  return model.capabilities.deep_reasoning
}

function getDisabledReason(model: AIModel, mode: 'search' | 'parse' | 'report'): string | null {
  if (mode === 'search') {
    if (!model.capabilities.deep_reasoning) return '需要深度推理能力'
    if (!model.capabilities.web_search) return '需要联网搜索能力'
  } else {
    if (!model.capabilities.deep_reasoning) return '需要深度推理能力'
  }
  return null
}

interface ModelSelectorProps {
  models: AIModel[]
  /** 'search' 要求 deep_reasoning + web_search，'parse'/'report' 仅要求 deep_reasoning */
  mode: 'search' | 'parse' | 'report'
  /** 多选模式（检索平台）或单选模式（解析/汇总模型） */
  multiSelect?: boolean
  selectedIds: string[]
  onChange: (ids: string[]) => void
}

export function ModelSelector({
  models,
  mode,
  multiSelect = false,
  selectedIds,
  onChange,
}: ModelSelectorProps) {
  function handleToggle(modelId: string, disabled: boolean) {
    if (disabled) return
    if (multiSelect) {
      onChange(
        selectedIds.includes(modelId)
          ? selectedIds.filter((id) => id !== modelId)
          : [...selectedIds, modelId]
      )
    } else {
      onChange([modelId])
    }
  }

  return (
    <TooltipProvider>
      <div className="flex flex-wrap gap-2">
        {models.map((model) => {
          const isCapable = mode === 'search' ? isSearchCapable(model) : isReasoningCapable(model)
          const disabledReason = getDisabledReason(model, mode)
          const isSelected = selectedIds.includes(model.id)

          const chip = (
            <button
              key={model.id}
              type="button"
              disabled={!isCapable}
              onClick={() => handleToggle(model.id, !isCapable)}
              className={cn(
                'px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                isSelected && isCapable
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : isCapable
                  ? 'bg-white border-slate-300 text-slate-700 hover:border-blue-400'
                  : 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
              )}
            >
              {model.name}
            </button>
          )

          if (!isCapable && disabledReason) {
            return (
              <Tooltip key={model.id}>
                <TooltipTrigger asChild>{chip}</TooltipTrigger>
                <TooltipContent>
                  <p>{disabledReason}</p>
                </TooltipContent>
              </Tooltip>
            )
          }
          return chip
        })}
      </div>
    </TooltipProvider>
  )
}
```

- [ ] **Step 3: 创建 PromptEditor（可折叠提示词编辑器）**

```tsx
// components/wizard/prompt-editor.tsx
'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Textarea } from '@/components/ui/textarea'

interface PromptEditorProps {
  label?: string
  value: string
  onChange: (value: string) => void
  defaultExpanded?: boolean
  placeholder?: string
}

export function PromptEditor({
  label = '编辑提示词',
  value,
  onChange,
  defaultExpanded = false,
  placeholder = '输入系统提示词...',
}: PromptEditorProps) {
  const [expanded, setExpanded] = useState(defaultExpanded)

  return (
    <div className="border border-slate-200 rounded-md overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
      >
        <span className="font-medium">{label}</span>
        {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {expanded && (
        <div className="border-t border-slate-200 p-3">
          <Textarea
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            rows={5}
            className="text-sm resize-none"
          />
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add components/wizard/wizard-progress.tsx components/wizard/model-selector.tsx components/wizard/prompt-editor.tsx
git commit -m "feat: add WizardProgress, ModelSelector, PromptEditor components"
```

---

## Task 8: 向导上传与解析相关组件

**Files:**
- Create: `components/wizard/file-upload-zone.tsx`
- Create: `components/wizard/history-doc-picker.tsx`
- Create: `components/wizard/parse-result-form.tsx`

- [ ] **Step 1: 创建 FileUploadZone（拖拽上传区）**

```tsx
// components/wizard/file-upload-zone.tsx
'use client'

import { useRef, useState } from 'react'
import { Upload, FileText, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

const ACCEPTED_TYPES = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/plain']
const ACCEPTED_EXTENSIONS = '.pdf,.docx,.xlsx,.txt'
const MAX_SIZE_MB = 20
const LARGE_PDF_PAGES_WARNING = 50 // 仅作提示，实际页数由后端返回

interface FileUploadZoneProps {
  onFileSelect: (file: File) => Promise<void>
  uploading: boolean
  uploadProgress?: number
  disabled?: boolean
}

export function FileUploadZone({
  onFileSelect,
  uploading,
  uploadProgress = 0,
  disabled = false,
}: FileUploadZoneProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function validateFile(file: File): string | null {
    if (!ACCEPTED_TYPES.includes(file.type) && !file.name.match(/\.(pdf|docx|xlsx|txt)$/i)) {
      return '仅支持 PDF、Word (.docx)、Excel (.xlsx) 和 TXT 文件'
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      return `文件大小不能超过 ${MAX_SIZE_MB}MB`
    }
    return null
  }

  async function handleFile(file: File) {
    const err = validateFile(file)
    if (err) { setError(err); return }
    setError(null)
    await onFileSelect(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    if (disabled || uploading) return
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    // 重置 input，允许重复选择同一文件
    e.target.value = ''
  }

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-label="上传专利文件，点击或拖拽"
        onDragOver={(e) => { e.preventDefault(); if (!disabled && !uploading) setDragging(true) }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => { if (!disabled && !uploading) inputRef.current?.click() }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
        className={cn(
          'border-2 border-dashed rounded-lg p-8 text-center transition-colors',
          dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300',
          (disabled || uploading) ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-blue-400 hover:bg-slate-50'
        )}
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-3">
            <Loader2 className="animate-spin text-blue-600" size={32} />
            <p className="text-sm text-slate-600">上传中... {uploadProgress}%</p>
            <div className="w-48 h-1.5 bg-slate-200 rounded-full overflow-hidden">
              <div className="h-full bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} />
            </div>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-blue-50 flex items-center justify-center">
              <Upload className="text-blue-600" size={24} />
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">点击或拖拽文件到此处</p>
              <p className="text-xs text-slate-500 mt-1">支持 PDF、Word、Excel、TXT，单文件 ≤ 20MB</p>
            </div>
          </div>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_EXTENSIONS}
        className="hidden"
        onChange={handleInputChange}
        disabled={disabled || uploading}
      />
      {error && <p className="mt-2 text-sm text-red-500">{error}</p>}
    </div>
  )
}
```

- [ ] **Step 2: 创建 HistoryDocPicker（历史文档下拉选择器）**

```tsx
// components/wizard/history-doc-picker.tsx
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PatentDocument } from '@/lib/supabase/types'

interface HistoryDocPickerProps {
  documents: PatentDocument[]
  onSelect: (documentId: string) => void
  disabled?: boolean
}

export function HistoryDocPicker({ documents, onSelect, disabled }: HistoryDocPickerProps) {
  if (documents.length === 0) return null

  return (
    <div>
      <p className="text-sm text-slate-500 text-center my-3">— 或从历史文献复用 —</p>
      <Select onValueChange={onSelect} disabled={disabled}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="选择历史文献..." />
        </SelectTrigger>
        <SelectContent>
          {documents.map((doc) => (
            <SelectItem key={doc.id} value={doc.id}>
              <span className="truncate">{doc.title}</span>
              <span className="ml-2 text-xs text-slate-400">
                {new Date(doc.created_at).toLocaleDateString('zh-CN')}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
```

- [ ] **Step 3: 创建 ParseResultForm（解析结果展示与编辑）**

```tsx
// components/wizard/parse-result-form.tsx
'use client'

import { useState } from 'react'
import { AlertTriangle, CheckCircle2 } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { PatentDocument } from '@/lib/supabase/types'

interface ParseResultFormProps {
  document: PatentDocument
  onSave: (updates: { parsed_data: PatentDocument['parsed_data']; user_notes: string }) => Promise<void>
}

export function ParseResultForm({ document, onSave }: ParseResultFormProps) {
  const pd = document.parsed_data ?? {}
  const [techTheme, setTechTheme] = useState(pd.tech_theme ?? '')
  const [applicant, setApplicant] = useState(pd.applicant ?? '')
  const [inventor, setInventor] = useState(pd.inventor ?? '')
  const [filingDate, setFilingDate] = useState(pd.filing_date ?? '')
  const [coreInvention, setCoreInvention] = useState(pd.core_invention ?? '')
  const [mainTechSteps, setMainTechSteps] = useState(pd.main_tech_steps ?? '')
  const [userNotes, setUserNotes] = useState(document.user_notes ?? '')
  const [dirty, setDirty] = useState(false)
  const [saving, setSaving] = useState(false)

  function markDirty() { setDirty(true) }

  async function handleSave() {
    setSaving(true)
    await onSave({
      parsed_data: { tech_theme: techTheme, applicant, inventor, filing_date: filingDate, core_invention: coreInvention, main_tech_steps: mainTechSteps, custom_fields: pd.custom_fields },
      user_notes: userNotes,
    })
    setDirty(false)
    setSaving(false)
  }

  return (
    <div className="space-y-4">
      {document.quality_warning && (
        <div className="flex items-start gap-2 px-4 py-3 bg-orange-50 border border-orange-200 rounded-md text-orange-800 text-sm">
          <AlertTriangle size={16} className="shrink-0 mt-0.5" />
          <span>文件排版复杂，解析结果可能不准确，建议逐项核对并在备注栏补充说明</span>
        </div>
      )}

      {document.parse_status === 'done' && !document.quality_warning && (
        <div className="flex items-center gap-2 text-green-700 text-sm">
          <CheckCircle2 size={16} />
          <span>解析完成，请确认以下字段</span>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-1">
          <Label htmlFor="tech-theme">技术主题</Label>
          <Input id="tech-theme" value={techTheme} onChange={(e) => { setTechTheme(e.target.value); markDirty() }} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="applicant">申请人</Label>
          <Input id="applicant" value={applicant} onChange={(e) => { setApplicant(e.target.value); markDirty() }} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="inventor">发明人</Label>
          <Input id="inventor" value={inventor} onChange={(e) => { setInventor(e.target.value); markDirty() }} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="filing-date">申请日</Label>
          <Input id="filing-date" value={filingDate} onChange={(e) => { setFilingDate(e.target.value); markDirty() }} placeholder="YYYY-MM-DD" />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="core-invention">核心发明构思</Label>
        <Textarea id="core-invention" value={coreInvention} rows={3}
          onChange={(e) => { setCoreInvention(e.target.value); markDirty() }} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="main-tech-steps">主要技术方案步骤</Label>
        <Textarea id="main-tech-steps" value={mainTechSteps} rows={3}
          onChange={(e) => { setMainTechSteps(e.target.value); markDirty() }} />
      </div>

      <div className="space-y-1">
        <Label htmlFor="user-notes">备注（补充说明）</Label>
        <Textarea id="user-notes" value={userNotes} rows={2} placeholder="在此补充解析结果中未涵盖的信息..."
          onChange={(e) => { setUserNotes(e.target.value); markDirty() }} />
      </div>

      {dirty && (
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? '保存中...' : '保存修改'}
        </Button>
      )}
    </div>
  )
}
```

- [ ] **Step 4: Commit**

```bash
git add components/wizard/file-upload-zone.tsx components/wizard/history-doc-picker.tsx components/wizard/parse-result-form.tsx
git commit -m "feat: add FileUploadZone, HistoryDocPicker, ParseResultForm components"
```

---

## Task 9: 向导策略与提交相关组件

**Files:**
- Create: `components/wizard/strategy-sheet.tsx`
- Create: `components/wizard/queue-status-banner.tsx`
- Create: `components/wizard/job-summary-card.tsx`
- Create: `components/wizard/schedule-toggle.tsx`

- [ ] **Step 1: 创建 StrategySheet（提示词查看/编辑侧抽屉）**

```tsx
// components/wizard/strategy-sheet.tsx
'use client'

import { useState } from 'react'
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from '@/components/ui/sheet'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { SearchStrategy } from '@/lib/supabase/types'

interface StrategySheetProps {
  strategy: SearchStrategy | null
  open: boolean
  onOpenChange: (open: boolean) => void
  /** 保存自定义策略修改 */
  onSave?: (strategyId: string, updates: { name: string; prompt_template: string }) => Promise<void>
  /** 将内置策略另存为自定义策略 */
  onSaveAs?: (data: { name: string; prompt_template: string }) => Promise<void>
  /** 新建模式（strategy=null） */
  onCreate?: (data: { name: string; prompt_template: string }) => Promise<void>
}

export function StrategySheet({
  strategy,
  open,
  onOpenChange,
  onSave,
  onSaveAs,
  onCreate,
}: StrategySheetProps) {
  const isNew = strategy === null
  const isBuiltin = strategy?.is_builtin ?? false
  const isEditable = !isBuiltin

  const [name, setName] = useState(strategy?.name ?? '')
  const [promptTemplate, setPromptTemplate] = useState(strategy?.prompt_template ?? '')
  const [saving, setSaving] = useState(false)

  // 当 strategy 改变时（打开新抽屉）重置表单
  function resetForm(s: SearchStrategy | null) {
    setName(s?.name ?? '')
    setPromptTemplate(s?.prompt_template ?? '')
  }

  async function handleSave() {
    setSaving(true)
    try {
      if (isNew) {
        await onCreate?.({ name, prompt_template: promptTemplate })
      } else if (isBuiltin) {
        await onSaveAs?.({ name: `${name}（自定义副本）`, prompt_template: promptTemplate })
      } else {
        await onSave?.(strategy!.id, { name, prompt_template: promptTemplate })
      }
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Sheet open={open} onOpenChange={(v) => { if (!v) resetForm(strategy); onOpenChange(v) }}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle>
            {isNew ? '新建检索策略' : isBuiltin ? `查看策略：${strategy.name}` : `编辑策略：${strategy.name}`}
          </SheetTitle>
        </SheetHeader>

        <div className="space-y-4 py-4">
          <div className="space-y-1">
            <Label htmlFor="strategy-name">策略名称</Label>
            <Input
              id="strategy-name"
              value={name}
              readOnly={isBuiltin && !isNew}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="strategy-prompt">提示词模板</Label>
            <p className="text-xs text-slate-500">
              可用变量：{`{{tech_theme}}`}、{`{{applicant}}`}、{`{{inventor}}`}、
              {`{{filing_date}}`}、{`{{main_tech_steps}}`}、{`{{core_invention}}`}
            </p>
            <Textarea
              id="strategy-prompt"
              value={promptTemplate}
              readOnly={isBuiltin && !isNew}
              rows={8}
              onChange={(e) => setPromptTemplate(e.target.value)}
              className="font-mono text-sm"
            />
          </div>
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          {isBuiltin ? (
            <Button onClick={handleSave} disabled={saving}>
              {saving ? '保存中...' : '另存为我的策略'}
            </Button>
          ) : (
            <Button onClick={handleSave} disabled={saving || !name.trim() || !promptTemplate.trim()}>
              {saving ? '保存中...' : isNew ? '创建策略' : '保存修改'}
            </Button>
          )}
        </SheetFooter>
      </SheetContent>
    </Sheet>
  )
}
```

- [ ] **Step 2: 创建 QueueStatusBanner（队列状态横幅，30s 轮询）**

```tsx
// components/wizard/queue-status-banner.tsx
'use client'

import { useEffect, useState } from 'react'
import { Clock, CheckCircle2 } from 'lucide-react'

const POLL_INTERVAL_MS = 30_000
const MINUTES_PER_JOB = 8

export function QueueStatusBanner() {
  const [queuedCount, setQueuedCount] = useState<number | null>(null)

  async function fetchQueueStatus() {
    try {
      const res = await fetch('/api/queue-status')
      if (res.ok) {
        const data = await res.json()
        setQueuedCount(data.queuedCount)
      }
    } catch {
      // 忽略网络错误，不影响提交流程
    }
  }

  useEffect(() => {
    fetchQueueStatus()
    const timer = setInterval(fetchQueueStatus, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [])

  if (queuedCount === null) return null

  const estimatedMinutes = queuedCount * MINUTES_PER_JOB

  return (
    <div className="flex items-center gap-2 px-4 py-3 rounded-md border text-sm">
      {queuedCount === 0 ? (
        <>
          <CheckCircle2 size={16} className="text-green-600 shrink-0" />
          <span className="text-green-700">队列空闲，提交后将立即开始</span>
        </>
      ) : (
        <>
          <Clock size={16} className="text-amber-600 shrink-0" />
          <span className="text-amber-700">
            队列中有 {queuedCount} 个任务，预计约 {estimatedMinutes} 分钟后开始
          </span>
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 3: 创建 JobSummaryCard（任务摘要卡片）**

```tsx
// components/wizard/job-summary-card.tsx
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import type { AIModel, SearchStrategy } from '@/lib/supabase/types'

interface JobSummaryCardProps {
  searchModels: AIModel[]
  strategies: SearchStrategy[]
  parseModelName: string
  reportModelName: string
  perTaskLimit: number
  reportLimit: number
  isAuto?: boolean
  onEditConfig?: () => void
}

export function JobSummaryCard({
  searchModels,
  strategies,
  parseModelName,
  reportModelName,
  perTaskLimit,
  reportLimit,
  isAuto = false,
  onEditConfig,
}: JobSummaryCardProps) {
  const subtaskCount = searchModels.length * strategies.length

  return (
    <Card>
      <CardContent className="pt-5 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">任务摘要</h3>
          <div className="flex items-center gap-2">
            {isAuto && <Badge variant="secondary" className="text-blue-600 bg-blue-50">自动挡</Badge>}
            {isAuto && onEditConfig && (
              <button
                type="button"
                onClick={onEditConfig}
                className="text-xs text-blue-600 hover:underline"
              >
                修改配置 →
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-slate-800">{searchModels.length}</p>
            <p className="text-xs text-slate-500">检索平台</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-slate-800">{strategies.length}</p>
            <p className="text-xs text-slate-500">检索策略</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-blue-600">{subtaskCount}</p>
            <p className="text-xs text-slate-500">子任务总数</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 text-sm text-slate-600">
          <div><span className="text-slate-400">解析模型：</span>{parseModelName}</div>
          <div><span className="text-slate-400">汇总模型：</span>{reportModelName}</div>
          <div><span className="text-slate-400">每路径文献数：</span>{perTaskLimit}</div>
          <div><span className="text-slate-400">报告输出文献数：</span>{reportLimit}</div>
        </div>
      </CardContent>
    </Card>
  )
}
```

- [ ] **Step 4: 创建 ScheduleToggle（立即/定时切换）**

```tsx
// components/wizard/schedule-toggle.tsx
'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'

interface ScheduleToggleProps {
  scheduledAt: string | null
  onChange: (value: string | null) => void
}

export function ScheduleToggle({ scheduledAt, onChange }: ScheduleToggleProps) {
  const [mode, setMode] = useState<'immediate' | 'scheduled'>(
    scheduledAt ? 'scheduled' : 'immediate'
  )

  function handleModeChange(newMode: 'immediate' | 'scheduled') {
    setMode(newMode)
    if (newMode === 'immediate') onChange(null)
  }

  // 最小可选时间：当前时间 + 5 分钟（避免选择过去时间）
  const minDateTime = new Date(Date.now() + 5 * 60 * 1000)
    .toISOString()
    .slice(0, 16)

  return (
    <div className="space-y-3">
      <div className="flex rounded-md border border-slate-200 overflow-hidden w-fit">
        <button
          type="button"
          onClick={() => handleModeChange('immediate')}
          className={cn(
            'px-4 py-2 text-sm font-medium transition-colors',
            mode === 'immediate'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          )}
        >
          立即提交
        </button>
        <button
          type="button"
          onClick={() => handleModeChange('scheduled')}
          className={cn(
            'px-4 py-2 text-sm font-medium border-l border-slate-200 transition-colors',
            mode === 'scheduled'
              ? 'bg-blue-600 text-white'
              : 'bg-white text-slate-600 hover:bg-slate-50'
          )}
        >
          定时执行
        </button>
      </div>

      {mode === 'scheduled' && (
        <input
          type="datetime-local"
          min={minDateTime}
          value={scheduledAt ?? ''}
          onChange={(e) => onChange(e.target.value ? new Date(e.target.value).toISOString() : null)}
          className="block border border-slate-300 rounded-md px-3 py-1.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      )}
    </div>
  )
}
```

- [ ] **Step 5: Commit**

```bash
git add components/wizard/strategy-sheet.tsx components/wizard/queue-status-banner.tsx components/wizard/job-summary-card.tsx components/wizard/schedule-toggle.tsx
git commit -m "feat: add StrategySheet, QueueStatusBanner, JobSummaryCard, ScheduleToggle components"
```

---

## Task 10: Step 1 页面（上传文件 & 解析）

**Files:**
- Create: `app/(app)/search/new/step-1/page.tsx`

- [ ] **Step 1: 创建 Step 1 页面**

```tsx
// app/(app)/search/new/step-1/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { WizardProgress } from '@/components/wizard/wizard-progress'
import { ModelSelector } from '@/components/wizard/model-selector'
import { PromptEditor } from '@/components/wizard/prompt-editor'
import { FileUploadZone } from '@/components/wizard/file-upload-zone'
import { HistoryDocPicker } from '@/components/wizard/history-doc-picker'
import { ParseResultForm } from '@/components/wizard/parse-result-form'
import { Button } from '@/components/ui/button'
import { Loader2 } from 'lucide-react'
import type { AIModel, PatentDocument, UserPreferences } from '@/lib/supabase/types'

const DEFAULT_PARSE_PROMPT = `你是专利文献解析专家。请从以下专利文献中提取结构化信息，输出 JSON 格式，包含字段：
tech_theme（技术主题）、applicant（申请人）、inventor（发明人）、
filing_date（申请日，格式 YYYY-MM-DD）、main_tech_steps（主要技术方案步骤）、
core_invention（核心发明构思）。若字段无法确定则输出空字符串。`

export default function Step1Page() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [models, setModels] = useState<AIModel[]>([])
  const [historyDocs, setHistoryDocs] = useState<PatentDocument[]>([])
  const [preferences, setPreferences] = useState<UserPreferences | null>(null)

  // 表单状态
  const [selectedModelIds, setSelectedModelIds] = useState<string[]>([])
  const [parsePrompt, setParsePrompt] = useState(DEFAULT_PARSE_PROMPT)
  const [autoMode, setAutoMode] = useState(false)

  // 上传状态
  const [uploading, setUploading] = useState(false)
  const [uploadProgress, setUploadProgress] = useState(0)

  // 解析状态
  const [documentId, setDocumentId] = useState<string | null>(null)
  const [document, setDocument] = useState<PatentDocument | null>(null)
  const [parsing, setParsing] = useState(false)

  const supabase = createClient()

  useEffect(() => {
    // 并行加载模型列表、历史文档、用户偏好
    async function init() {
      const [modelsRes, prefsRes] = await Promise.all([
        fetch('/api/models').then((r) => r.json()),
        fetch('/api/preferences').then((r) => r.json()),
      ])
      setModels(modelsRes)
      setPreferences(prefsRes)

      // 若有偏好配置，默认选中偏好中的解析模型
      if (prefsRes?.parse_model_id) {
        setSelectedModelIds([prefsRes.parse_model_id])
        setParsePrompt(prefsRes.parse_system_prompt ?? DEFAULT_PARSE_PROMPT)
      }

      // 加载 parse_status='done' 的历史文档
      const { data: docs } = await supabase
        .from('patent_documents')
        .select('*')
        .eq('parse_status', 'done')
        .order('created_at', { ascending: false })
        .limit(20)
      setHistoryDocs(docs ?? [])
    }
    init()
  }, [])

  // Supabase Realtime 订阅文档解析状态
  useEffect(() => {
    if (!documentId) return
    const channel = supabase
      .channel(`doc-${documentId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'patent_documents', filter: `id=eq.${documentId}` },
        async (payload) => {
          const updated = payload.new as PatentDocument
          setDocument(updated)
          if (updated.parse_status !== 'parsing') setParsing(false)
        }
      )
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [documentId])

  async function handleFileSelect(file: File) {
    if (selectedModelIds.length === 0) return
    setUploading(true)
    setUploadProgress(0)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) return

      // 直传 Supabase Storage（绕过 Vercel 限制）
      const filePath = `${user.id}/${Date.now()}-${file.name}`
      const { error: storageError } = await supabase.storage
        .from('documents')
        .upload(filePath, file, {
          onUploadProgress: (progress) => {
            setUploadProgress(Math.round((progress.loaded / progress.total) * 100))
          },
        } as Parameters<typeof supabase.storage.from>[0] extends never ? never : any)

      if (storageError) throw storageError
      setUploadProgress(100)

      // 创建文档记录并入队 parse-job
      const ext = file.name.split('.').pop()?.toLowerCase() as PatentDocument['file_type']
      const res = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileUrl: filePath,
          fileName: file.name,
          fileType: ext,
          parseModelId: selectedModelIds[0],
          parseSystemPrompt: parsePrompt,
        }),
      })
      const { documentId: newDocId } = await res.json()
      setDocumentId(newDocId)
      setParsing(true)

      // 加载初始文档状态
      const docRes = await fetch(`/api/documents/${newDocId}`)
      setDocument(await docRes.json())
    } catch (err) {
      console.error('上传失败:', err)
    } finally {
      setUploading(false)
    }
  }

  async function handleHistoryDocSelect(docId: string) {
    const docRes = await fetch(`/api/documents/${docId}`)
    const doc = await docRes.json()
    setDocument(doc)
    setDocumentId(docId)
  }

  async function handleSaveParsedData(updates: { parsed_data: PatentDocument['parsed_data']; user_notes: string }) {
    if (!documentId) return
    await fetch(`/api/documents/${documentId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    setDocument((prev) => prev ? { ...prev, ...updates } : prev)
  }

  function handleNext() {
    if (!documentId) return
    if (autoMode && preferences) {
      const params = new URLSearchParams({
        documentId,
        modelIds: preferences.search_model_ids.join(','),
        strategyIds: preferences.strategy_ids.join(','),
        perTaskLimit: String(preferences.per_task_limit),
        reportLimit: String(preferences.report_limit),
        reportModelId: preferences.report_model_id,
        reportSystemPrompt: preferences.report_system_prompt,
        auto: '1',
      })
      router.push(`/search/new/step-3?${params}`)
    } else {
      router.push(`/search/new/step-2?documentId=${documentId}`)
    }
  }

  const parseModels = models.filter((m) => m.usage_types.includes('parse'))
  const canProceed = document?.parse_status === 'done'
  const hasPreferences = preferences !== null

  return (
    <div className="max-w-2xl mx-auto">
      <WizardProgress currentStep={1} />

      <div className="space-y-6">
        {/* 模式切换：仅有偏好配置时显示 */}
        {hasPreferences && (
          <div className="flex items-center gap-3">
            <span className="text-sm text-slate-600">模式：</span>
            <div className="flex rounded-md border border-slate-200 overflow-hidden">
              <button
                type="button"
                onClick={() => setAutoMode(false)}
                className={`px-3 py-1.5 text-sm font-medium transition-colors ${!autoMode ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                手动配置
              </button>
              <button
                type="button"
                onClick={() => setAutoMode(true)}
                className={`px-3 py-1.5 text-sm font-medium border-l border-slate-200 transition-colors ${autoMode ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
              >
                使用偏好配置
              </button>
            </div>
          </div>
        )}

        {/* ① 选择解析模型 */}
        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">① 选择解析模型</h3>
          <ModelSelector
            models={parseModels}
            mode="parse"
            multiSelect={false}
            selectedIds={selectedModelIds}
            onChange={setSelectedModelIds}
          />
          <PromptEditor label="编辑解析提示词" value={parsePrompt} onChange={setParsePrompt} />
        </section>

        {/* ② 上传或复用历史文档 */}
        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">② 选择专利文献</h3>
          <FileUploadZone
            onFileSelect={handleFileSelect}
            uploading={uploading}
            uploadProgress={uploadProgress}
            disabled={selectedModelIds.length === 0 || !!documentId}
          />
          {selectedModelIds.length === 0 && (
            <p className="text-xs text-amber-600">请先选择解析模型再上传文件</p>
          )}
          <HistoryDocPicker
            documents={historyDocs}
            onSelect={handleHistoryDocSelect}
            disabled={!!documentId}
          />
        </section>

        {/* ③ 解析结果 */}
        {documentId && (
          <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-700">③ 解析结果</h3>
              {parsing && (
                <span className="flex items-center gap-1.5 text-xs text-blue-600">
                  <Loader2 size={14} className="animate-spin" />
                  解析中...
                </span>
              )}
            </div>
            {document && document.parse_status !== 'pending' && (
              <ParseResultForm document={document} onSave={handleSaveParsedData} />
            )}
          </section>
        )}

        <div className="flex justify-end">
          <Button onClick={handleNext} disabled={!canProceed}>
            下一步 →
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 验证 Step 1 渲染**

```bash
npm run dev
```

访问 http://localhost:3000/search/new/step-1，验证：
- 进度条显示步骤 ①
- 模型选择器加载并显示解析模型
- 文件上传区可交互
- 历史文档下拉正常显示

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/search/
git commit -m "feat: add Step 1 upload-and-parse wizard page"
```

---

## Task 11: Step 2 页面（配置检索）

**Files:**
- Create: `app/(app)/search/new/step-2/page.tsx`

- [ ] **Step 1: 创建 Step 2 页面**

```tsx
// app/(app)/search/new/step-2/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { WizardProgress } from '@/components/wizard/wizard-progress'
import { ModelSelector } from '@/components/wizard/model-selector'
import { PromptEditor } from '@/components/wizard/prompt-editor'
import { StrategySheet } from '@/components/wizard/strategy-sheet'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import type { AIModel, SearchStrategy, PatentDocument } from '@/lib/supabase/types'

const DEFAULT_REPORT_PROMPT = `你是专业专利检索分析师。以下是针对一件专利申请的多路检索结果，请综合评估，
去除重复条目，按相关程度从高到低筛选最相关的文献，输出 JSON 数组，
每项包含：rank、title、authors、url、pub_date、relevance_desc、citation_gb。`

export default function Step2Page() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const documentId = searchParams.get('documentId') ?? ''

  const [document, setDocument] = useState<PatentDocument | null>(null)
  const [models, setModels] = useState<AIModel[]>([])
  const [strategies, setStrategies] = useState<SearchStrategy[]>([])

  // 配置状态
  const [selectedSearchModelIds, setSelectedSearchModelIds] = useState<string[]>([])
  const [selectedStrategyIds, setSelectedStrategyIds] = useState<string[]>([])
  const [perTaskLimit, setPerTaskLimit] = useState(5)
  const [reportLimit, setReportLimit] = useState(10)
  const [selectedReportModelIds, setSelectedReportModelIds] = useState<string[]>([])
  const [reportPrompt, setReportPrompt] = useState(DEFAULT_REPORT_PROMPT)
  const [savePreferences, setSavePreferences] = useState(false)

  // 策略抽屉状态
  const [sheetOpen, setSheetOpen] = useState(false)
  const [activeStrategy, setActiveStrategy] = useState<SearchStrategy | null>(null)
  const [sheetMode, setSheetMode] = useState<'view' | 'new'>('view')

  useEffect(() => {
    if (!documentId) { router.replace('/search/new/step-1'); return }

    async function init() {
      const [docRes, modelsRes, strategiesRes] = await Promise.all([
        fetch(`/api/documents/${documentId}`),
        fetch('/api/models'),
        fetch('/api/strategies'),
      ])

      const doc: PatentDocument = await docRes.json()
      if (doc.parse_status !== 'done') {
        router.replace(`/search/new/step-1`)
        return
      }
      setDocument(doc)

      const allModels: AIModel[] = await modelsRes.json()
      const allStrategies: SearchStrategy[] = await strategiesRes.json()
      setModels(allModels)
      setStrategies(allStrategies)

      // 默认选中全部满足条件的内置检索平台
      const defaultSearchModels = allModels.filter(
        (m) => m.usage_types.includes('search') && m.capabilities.deep_reasoning && m.capabilities.web_search && m.is_builtin
      )
      setSelectedSearchModelIds(defaultSearchModels.map((m) => m.id))

      // 默认选中全部内置策略
      const defaultStrategies = allStrategies.filter((s) => s.is_builtin)
      setSelectedStrategyIds(defaultStrategies.map((s) => s.id).slice(0, 2))

      // 默认选中第一个可用报告模型
      const reportModels = allModels.filter((m) => m.usage_types.includes('report') && m.capabilities.deep_reasoning)
      if (reportModels.length > 0) setSelectedReportModelIds([reportModels[0].id])
    }
    init()
  }, [documentId])

  function openStrategySheet(strategy: SearchStrategy) {
    setActiveStrategy(strategy)
    setSheetMode('view')
    setSheetOpen(true)
  }

  function openNewStrategySheet() {
    setActiveStrategy(null)
    setSheetMode('new')
    setSheetOpen(true)
  }

  async function handleSaveStrategy(strategyId: string, updates: { name: string; prompt_template: string }) {
    await fetch(`/api/strategies/${strategyId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    })
    // 刷新策略列表
    const res = await fetch('/api/strategies')
    setStrategies(await res.json())
  }

  async function handleSaveAsStrategy(data: { name: string; prompt_template: string }) {
    const res = await fetch('/api/strategies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const newStrategy = await res.json()
    setStrategies((prev) => [...prev, newStrategy])
    setSelectedStrategyIds((prev) => [...prev, newStrategy.id])
  }

  async function handleCreateStrategy(data: { name: string; prompt_template: string }) {
    await handleSaveAsStrategy(data)
  }

  function handleNext() {
    if (savePreferences) {
      // 保存偏好配置（fire-and-forget，不阻塞导航）
      const prefs = {
        parse_model_id: document?.parse_config?.model_id ?? '',
        parse_system_prompt: document?.parse_config?.system_prompt ?? '',
        search_model_ids: selectedSearchModelIds,
        strategy_ids: selectedStrategyIds,
        per_task_limit: perTaskLimit,
        report_limit: reportLimit,
        report_model_id: selectedReportModelIds[0] ?? '',
        report_system_prompt: reportPrompt,
      }
      fetch('/api/preferences', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(prefs),
      }).catch(() => {})
    }

    const params = new URLSearchParams({
      documentId,
      modelIds: selectedSearchModelIds.join(','),
      strategyIds: selectedStrategyIds.join(','),
      perTaskLimit: String(perTaskLimit),
      reportLimit: String(reportLimit),
      reportModelId: selectedReportModelIds[0] ?? '',
      reportSystemPrompt: reportPrompt,
    })
    router.push(`/search/new/step-3?${params}`)
  }

  const searchModels = models.filter((m) => m.usage_types.includes('search'))
  const reportModels = models.filter((m) => m.usage_types.includes('report'))
  const canProceed = selectedSearchModelIds.length > 0 && selectedStrategyIds.length > 0 && selectedReportModelIds.length > 0

  return (
    <div className="max-w-2xl mx-auto">
      <WizardProgress currentStep={2} />

      <div className="space-y-6">
        {/* 检索平台 */}
        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">检索平台（多选）</h3>
          <ModelSelector
            models={searchModels}
            mode="search"
            multiSelect
            selectedIds={selectedSearchModelIds}
            onChange={setSelectedSearchModelIds}
          />
        </section>

        {/* 检索策略 */}
        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-3">
          <h3 className="text-sm font-semibold text-slate-700">检索策略（多选）</h3>
          <div className="space-y-2">
            {strategies.map((strategy) => (
              <div key={strategy.id} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`strategy-${strategy.id}`}
                    checked={selectedStrategyIds.includes(strategy.id)}
                    onCheckedChange={(checked) => {
                      setSelectedStrategyIds(
                        checked
                          ? [...selectedStrategyIds, strategy.id]
                          : selectedStrategyIds.filter((id) => id !== strategy.id)
                      )
                    }}
                  />
                  <Label htmlFor={`strategy-${strategy.id}`} className="text-sm cursor-pointer">
                    {strategy.name}
                  </Label>
                  {strategy.is_builtin && (
                    <span className="text-xs text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">内置</span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => openStrategySheet(strategy)}
                  className="text-xs text-blue-600 hover:underline"
                >
                  查看/编辑提示词
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={openNewStrategySheet}
              className="text-sm text-blue-600 hover:underline mt-1"
            >
              + 新建自定义策略
            </button>
          </div>
        </section>

        {/* 参数配置 */}
        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">参数</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label htmlFor="per-task-limit" className="text-sm">每路径备选文献数</Label>
              <Input
                id="per-task-limit"
                type="number"
                min={1}
                max={20}
                value={perTaskLimit}
                onChange={(e) => setPerTaskLimit(Number(e.target.value))}
                className="w-24"
              />
            </div>
            <div className="space-y-1">
              <Label htmlFor="report-limit" className="text-sm">报告输出文献数</Label>
              <Input
                id="report-limit"
                type="number"
                min={1}
                max={30}
                value={reportLimit}
                onChange={(e) => setReportLimit(Number(e.target.value))}
                className="w-24"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">汇总模型</Label>
            <ModelSelector
              models={reportModels}
              mode="report"
              multiSelect={false}
              selectedIds={selectedReportModelIds}
              onChange={setSelectedReportModelIds}
            />
            <PromptEditor label="编辑报告生成提示词" value={reportPrompt} onChange={setReportPrompt} />
          </div>
        </section>

        {/* 保存偏好配置 */}
        <div className="flex items-center gap-2">
          <Checkbox
            id="save-preferences"
            checked={savePreferences}
            onCheckedChange={(v) => setSavePreferences(!!v)}
          />
          <Label htmlFor="save-preferences" className="text-sm cursor-pointer">
            保存当前配置为我的偏好配置
          </Label>
        </div>

        <div className="flex justify-between">
          <Button variant="outline" onClick={() => router.push(`/search/new/step-1`)}>
            ← 上一步
          </Button>
          <Button onClick={handleNext} disabled={!canProceed}>
            下一步 →
          </Button>
        </div>
      </div>

      <StrategySheet
        strategy={activeStrategy}
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        onSave={handleSaveStrategy}
        onSaveAs={handleSaveAsStrategy}
        onCreate={handleCreateStrategy}
      />
    </div>
  )
}
```

- [ ] **Step 2: 验证 Step 2 渲染**

打开 http://localhost:3000/search/new/step-2?documentId=some-done-doc-id（使用真实已解析文档 ID），验证：
- 进度条显示步骤 ②
- 模型/策略加载正确
- 策略侧抽屉可打开/关闭
- "下一步"在选择完毕后激活

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/search/new/step-2/
git commit -m "feat: add Step 2 configure-search wizard page"
```

---

## Task 12: Step 3 页面（确认提交）

**Files:**
- Create: `app/(app)/search/new/step-3/page.tsx`

- [ ] **Step 1: 创建 Step 3 页面**

```tsx
// app/(app)/search/new/step-3/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { WizardProgress } from '@/components/wizard/wizard-progress'
import { JobSummaryCard } from '@/components/wizard/job-summary-card'
import { QueueStatusBanner } from '@/components/wizard/queue-status-banner'
import { ScheduleToggle } from '@/components/wizard/schedule-toggle'
import { Button } from '@/components/ui/button'
import type { AIModel, SearchStrategy } from '@/lib/supabase/types'

export default function Step3Page() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const documentId = searchParams.get('documentId') ?? ''
  const modelIdsParam = searchParams.get('modelIds') ?? ''
  const strategyIdsParam = searchParams.get('strategyIds') ?? ''
  const perTaskLimit = Number(searchParams.get('perTaskLimit') ?? '5')
  const reportLimit = Number(searchParams.get('reportLimit') ?? '10')
  const reportModelId = searchParams.get('reportModelId') ?? ''
  const reportSystemPrompt = searchParams.get('reportSystemPrompt') ?? ''
  const isAuto = searchParams.get('auto') === '1'

  const modelIds = modelIdsParam ? modelIdsParam.split(',') : []
  const strategyIds = strategyIdsParam ? strategyIdsParam.split(',') : []

  const [selectedModels, setSelectedModels] = useState<AIModel[]>([])
  const [selectedStrategies, setSelectedStrategies] = useState<SearchStrategy[]>([])
  const [reportModel, setReportModel] = useState<AIModel | null>(null)
  const [parseModelName, setParseModelName] = useState('')

  const [scheduledAt, setScheduledAt] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!documentId || modelIds.length === 0 || strategyIds.length === 0) {
      router.replace('/search/new/step-1')
      return
    }

    async function init() {
      const [modelsRes, strategiesRes, docRes] = await Promise.all([
        fetch('/api/models').then((r) => r.json()),
        fetch('/api/strategies').then((r) => r.json()),
        fetch(`/api/documents/${documentId}`).then((r) => r.json()),
      ])

      const allModels: AIModel[] = modelsRes
      const allStrategies: SearchStrategy[] = strategiesRes

      setSelectedModels(allModels.filter((m) => modelIds.includes(m.id)))
      setSelectedStrategies(allStrategies.filter((s) => strategyIds.includes(s.id)))
      setReportModel(allModels.find((m) => m.id === reportModelId) ?? null)
      setParseModelName(
        allModels.find((m) => m.id === docRes?.parse_config?.model_id)?.name ?? '未知模型'
      )
    }
    init()
  }, [])

  async function handleSubmit() {
    setSubmitting(true)
    setError(null)

    try {
      // fire-and-forget 唤醒 Worker
      fetch('/api/worker-ping').catch(() => {})

      const res = await fetch('/api/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          documentId,
          config: {
            model_ids: modelIds,
            strategy_ids: strategyIds,
            per_task_limit: perTaskLimit,
            report_limit: reportLimit,
            report_model_id: reportModelId,
            report_system_prompt: reportSystemPrompt,
          },
          scheduledAt,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.error ?? '提交失败')
      }

      const { jobId } = await res.json()
      router.push(`/search/${jobId}/progress`)
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : '提交时发生错误，请重试')
      setSubmitting(false)
    }
  }

  return (
    <div className="max-w-2xl mx-auto">
      <WizardProgress currentStep={3} />

      <div className="space-y-6">
        {/* 任务摘要 */}
        <JobSummaryCard
          searchModels={selectedModels}
          strategies={selectedStrategies}
          parseModelName={parseModelName}
          reportModelName={reportModel?.name ?? '未知模型'}
          perTaskLimit={perTaskLimit}
          reportLimit={reportLimit}
          isAuto={isAuto}
          onEditConfig={() => router.push(`/search/new/step-2?documentId=${documentId}`)}
        />

        {/* 队列状态 */}
        <QueueStatusBanner />

        {/* 提交方式 */}
        <section className="bg-white rounded-lg border border-slate-200 p-4 space-y-4">
          <h3 className="text-sm font-semibold text-slate-700">提交方式</h3>
          <ScheduleToggle scheduledAt={scheduledAt} onChange={setScheduledAt} />

          {error && <p className="text-sm text-red-500">{error}</p>}

          <Button
            className="w-full"
            onClick={handleSubmit}
            disabled={submitting || selectedModels.length === 0}
          >
            {submitting
              ? '提交中...'
              : scheduledAt
              ? '定时提交检索任务'
              : '提交检索任务'}
          </Button>
        </section>

        <div className="flex justify-start">
          <Button variant="outline" onClick={() => router.push(`/search/new/step-2?documentId=${documentId}`)}>
            ← 上一步
          </Button>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 更新侧边栏导航**

验证 `components/sidebar.tsx` 中 `/search/new` 路由已存在（已在 Plan 1 中配置）。

打开 `components/sidebar.tsx`，确认 navItems 中包含：
```ts
{ href: '/search/new', label: '新建检索', icon: Search },
```

若不存在，在 navItems 数组中将 `href: '/search/new'` 改为 `href: '/search/new/step-1'`：

```ts
// components/sidebar.tsx（仅修改 href）
const navItems = [
  { href: '/dashboard', label: '我的任务', icon: LayoutDashboard },
  { href: '/search/new/step-1', label: '新建检索', icon: Search },
  { href: '/settings/models', label: '模型库', icon: Settings },
]
```

- [ ] **Step 3: 验证完整流程**

```bash
npm run dev
```

按步骤手动测试：
1. 访问 http://localhost:3000/search/new/step-1
2. 选择解析模型 → 上传一个 PDF → 等待 Realtime 推送解析状态更新
3. 点击"下一步"进入 Step 2 → 选择检索平台与策略 → 点击"下一步"
4. 在 Step 3 确认摘要显示正确 → 点击"提交检索任务"
5. 确认页面跳转到 `/search/{jobId}/progress`（该页面为 Plan 5 实现，此时显示 404 是正常的）

- [ ] **Step 4: 运行所有测试**

```bash
npm run test:run
```

预期：所有已有测试通过（包含 middleware 测试）。

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/search/new/step-3/ components/sidebar.tsx
git commit -m "feat: add Step 3 confirm-submit wizard page and update sidebar nav"
```

- [ ] **Step 6: 最终 Commit**

```bash
git add .
git commit -m "feat: Plan 2 complete - three-step search wizard with API routes and UI components"
```

---

## 自审检查

### 1. Spec 覆盖检查

| 功能 | 对应任务 |
|------|---------|
| DB 新增 preferences + parse_config 列 | Task 1 |
| Storage bucket + RLS | Task 1 |
| 9 个 API Routes | Task 3-6 |
| WizardProgress 进度条 | Task 7 |
| ModelSelector（灰显 + tooltip） | Task 7 |
| PromptEditor（可折叠） | Task 7 |
| FileUploadZone（拖拽 + 进度） | Task 8 |
| HistoryDocPicker（历史文档复用） | Task 8 |
| ParseResultForm（6 字段编辑 + 质量预警） | Task 8 |
| StrategySheet（内置/自定义/新建） | Task 9 |
| QueueStatusBanner（30s 轮询） | Task 9 |
| JobSummaryCard | Task 9 |
| ScheduleToggle（立即/定时） | Task 9 |
| Step 1 页面（含 Realtime 订阅解析状态） | Task 10 |
| Step 2 页面（含保存偏好配置） | Task 11 |
| Step 3 页面（含 auto=1 自动挡支持） | Task 12 |
| 自动挡：跳过 Step 2 直达 Step 3 | Task 10（handleNext 逻辑） |
| Worker-ping（fire-and-forget 唤醒） | Task 3 Route + Task 12 |

### 2. 类型一致性

- `PatentDocument.parse_config` 在 Task 1 types.ts 中定义为 `ParseConfig | null`，在 Task 5 API 中读取的是 `document?.parse_config?.model_id` ✅
- `UserPreferences` 结构在 Task 1 定义，Task 4 GET/PUT 返回 `UserPreferences | null` ✅
- `boss.send()` 调用参数与 worker `boss.work()` 接收的 `job.data` 结构一致（Task 5/6 投递，Plan 3/4 消费）✅
- Next.js 16 动态路由：Task 5 GET/PATCH `/api/documents/[documentId]` 和 Task 6 PUT `/api/strategies/[strategyId]` 均使用 `{ params }: { params: Promise<{ ... }> }` 并 `await params` ✅

### 3. 占位符扫描

无 TBD / TODO / "similar to" 等占位符。所有代码步骤均包含完整实现。
