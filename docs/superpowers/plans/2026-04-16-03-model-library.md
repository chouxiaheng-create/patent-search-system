# Plan 3: 模型库管理 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将六个主流 AI 大模型（智谱GLM、Kimi、DeepSeek、千问、MiniMax、秘塔AI）内置到系统模型库，支持用户绑定自己的 API Key，并在检索向导 Step 2 中为每次调用自定义开启/关闭深度思考和联网搜索功能。

**Architecture:** 在 `ai_models` 表新增 `adapter_config` JSONB 列，记录每个提供商的 API 调用差异（参数名、互斥规则等）；新增 `POST/PUT/DELETE /api/models/[modelId]` CRUD 端点；新建 `/settings/models` 页面供用户管理个人 API Key 和模型配置；Step 2 向导中的 `ModelSelector` 扩展为展示深度思考/联网搜索勾选框，每次检索任务的实际开关写入 `search_jobs.config`。

**Tech Stack:** Next.js 16 App Router (TypeScript), Supabase JS SDK v2, shadcn/ui (Switch, Badge, Dialog, Table), Tailwind CSS, Vitest

---

## 背景与 API 接入摘要

### 各提供商 API 差异对照表

| 提供商 | base_url | 模型 ID | 联网搜索 | 深度思考 | 互斥？ |
|--------|----------|---------|---------|---------|--------|
| 智谱GLM | `https://open.bigmodel.cn/api/paas/v4` | `glm-5.1` | `tools: [{type:"web_search"}]` | `thinking:{type:"enabled"}` | 否 |
| Kimi | `https://api.moonshot.cn/v1` | `kimi-k2.5` | `tools:[{type:"builtin_function",function:{name:"$web_search"}}]` | `thinking:{type:"disabled"}`（默认开启） | **是**（search 时必须关 thinking） |
| DeepSeek | `https://api.deepseek.com/v1` | `deepseek-chat` / `deepseek-reasoner` | 不支持 | 切换 model_id 为 `deepseek-reasoner` | N/A |
| 千问(Qwen) | `https://dashscope.aliyuncs.com/compatible-mode/v1` | `qwen3-max` | `extra_body:{enable_search:true}` | `extra_body:{enable_thinking:true}` | **是**（部分模型） |
| MiniMax | `https://api.minimax.io/v1` | `MiniMax-M2` | `tools:[{type:"web_search"}]` | `extra_body:{reasoning_split:true}` | 否 |
| 秘塔AI | `https://metaso.cn/api` | `metaso-search` | 固有（本身即搜索引擎） | 不支持 | N/A |

### `adapter_config` JSONB 结构

```typescript
interface AdapterConfig {
  provider: 'openai_compat' | 'metaso'
  // 联网搜索的开启方式
  web_search_method: 'tools_builtin' | 'tools_web_search' | 'extra_body' | 'native' | 'none'
  web_search_tool_name?: string        // 当 method=tools_builtin 时的 function.name，如 "$web_search"
  // 深度思考的开启方式
  thinking_method: 'param' | 'model_switch' | 'extra_body' | 'default_on' | 'none'
  thinking_model_id?: string           // 当 method=model_switch 时，deepseek-reasoner
  // 互斥规则
  web_search_disables_thinking: boolean  // Kimi、Qwen 部分模型
  // Kimi 特殊：thinking 默认开启，关闭才开 search
  thinking_default_on: boolean
}
```

---

## 文件结构

```
supabase/migrations/
  20260416000001_add_adapter_config.sql   # ALTER TABLE ai_models ADD COLUMN adapter_config
  20260416000002_fix_seed_models.sql      # 修正旧模型 + 新增3个提供商的种子数据

lib/supabase/types.ts                     # MODIFY: 新增 AdapterConfig, ModelFeatureOverride

app/api/models/
  route.ts                                # MODIFY: 新增 POST（创建用户自有模型）
  [modelId]/route.ts                      # CREATE: PUT（更新）、DELETE（删除）

app/(app)/settings/models/
  page.tsx                                # CREATE: 模型库管理页（列表 + 新增 + 编辑 + 删除）

components/settings/
  model-table.tsx                         # CREATE: 模型列表表格组件
  model-form-dialog.tsx                   # CREATE: 新建/编辑模型的对话框

components/wizard/
  model-selector.tsx                      # MODIFY: 增加 per-call 功能勾选（深度思考 / 联网搜索）

__tests__/api/
  models.test.ts                          # CREATE: POST / PUT / DELETE 端点测试
```

---

## Task 1: DB Migration — 新增 adapter_config + 修正种子数据

**Files:**
- Create: `supabase/migrations/20260416000001_add_adapter_config.sql`
- Create: `supabase/migrations/20260416000002_fix_seed_models.sql`

- [ ] **Step 1: 创建 adapter_config 迁移文件**

```sql
-- supabase/migrations/20260416000001_add_adapter_config.sql
ALTER TABLE ai_models
  ADD COLUMN IF NOT EXISTS adapter_config JSONB NOT NULL DEFAULT '{}';
```

- [ ] **Step 2: 创建种子修正迁移文件**

```sql
-- supabase/migrations/20260416000002_fix_seed_models.sql

-- 修正 Kimi K2.5（旧 model_id = moonshot-v1-32k）
UPDATE ai_models SET
  model_id = 'kimi-k2.5',
  adapter_config = '{
    "provider": "openai_compat",
    "web_search_method": "tools_builtin",
    "web_search_tool_name": "$web_search",
    "thinking_method": "default_on",
    "web_search_disables_thinking": true,
    "thinking_default_on": true
  }'::jsonb
WHERE name = 'Kimi K2.5' AND is_builtin = true;

-- 修正 智谱GLM-5.1（旧 model_id = glm-4）
UPDATE ai_models SET
  model_id = 'glm-5.1',
  adapter_config = '{
    "provider": "openai_compat",
    "web_search_method": "tools_web_search",
    "thinking_method": "param",
    "web_search_disables_thinking": false,
    "thinking_default_on": false
  }'::jsonb
WHERE name = '智谱GLM-5.1' AND is_builtin = true;

-- 修正 秘塔AI
UPDATE ai_models SET
  api_base_url = 'https://metaso.cn/api',
  adapter_config = '{
    "provider": "metaso",
    "web_search_method": "native",
    "thinking_method": "none",
    "web_search_disables_thinking": false,
    "thinking_default_on": false
  }'::jsonb
WHERE name = '秘塔AI' AND is_builtin = true;

-- 新增 DeepSeek
INSERT INTO ai_models (name, api_base_url, model_id, is_builtin, usage_types, capabilities, api_key_encrypted, adapter_config)
VALUES (
  'DeepSeek',
  'https://api.deepseek.com/v1',
  'deepseek-chat',
  true,
  ARRAY['search', 'parse', 'report'],
  '{"deep_reasoning": true, "web_search": false}',
  '',
  '{
    "provider": "openai_compat",
    "web_search_method": "none",
    "thinking_method": "model_switch",
    "thinking_model_id": "deepseek-reasoner",
    "web_search_disables_thinking": false,
    "thinking_default_on": false
  }'::jsonb
);

-- 新增 千问(Qwen)
INSERT INTO ai_models (name, api_base_url, model_id, is_builtin, usage_types, capabilities, api_key_encrypted, adapter_config)
VALUES (
  '阿里千问',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'qwen3-max',
  true,
  ARRAY['search', 'parse', 'report'],
  '{"deep_reasoning": true, "web_search": true}',
  '',
  '{
    "provider": "openai_compat",
    "web_search_method": "extra_body",
    "thinking_method": "extra_body",
    "web_search_disables_thinking": true,
    "thinking_default_on": false
  }'::jsonb
);

-- 新增 MiniMax
INSERT INTO ai_models (name, api_base_url, model_id, is_builtin, usage_types, capabilities, api_key_encrypted, adapter_config)
VALUES (
  'MiniMax',
  'https://api.minimax.io/v1',
  'MiniMax-M2',
  true,
  ARRAY['search', 'parse', 'report'],
  '{"deep_reasoning": true, "web_search": true}',
  '',
  '{
    "provider": "openai_compat",
    "web_search_method": "tools_web_search",
    "thinking_method": "extra_body",
    "web_search_disables_thinking": false,
    "thinking_default_on": false
  }'::jsonb
);
```

- [ ] **Step 3: 推送 migrations**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
supabase db push
```

预期：两个新 migration 执行成功，无报错。若提示未 link，执行 `supabase link` 后重试，或直接在 Supabase Studio SQL 编辑器中手动执行。

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260416000001_add_adapter_config.sql \
        supabase/migrations/20260416000002_fix_seed_models.sql
git commit -m "feat: add adapter_config column and fix/extend model seed data"
```

---

## Task 2: 类型扩展

**Files:**
- Modify: `lib/supabase/types.ts`

- [ ] **Step 1: 更新 AIModel 接口并新增相关类型**

将 `lib/supabase/types.ts` 中的 `AIModel` 接口替换为：

```typescript
export interface AdapterConfig {
  provider: 'openai_compat' | 'metaso'
  web_search_method: 'tools_builtin' | 'tools_web_search' | 'extra_body' | 'native' | 'none'
  web_search_tool_name?: string
  thinking_method: 'param' | 'model_switch' | 'extra_body' | 'default_on' | 'none'
  thinking_model_id?: string
  web_search_disables_thinking: boolean
  thinking_default_on: boolean
}

export interface AIModel {
  id: string
  owner_id: string | null
  name: string
  api_base_url: string
  api_key_encrypted: string
  model_id: string
  is_builtin: boolean
  usage_types: string[]
  capabilities: { deep_reasoning: boolean; web_search: boolean }
  adapter_config: AdapterConfig
  created_at: string
}

/** 用于 search_jobs.config 中记录本次检索的功能开关 */
export interface ModelFeatureOverride {
  model_id: string          // ai_models.id (UUID)
  enable_thinking: boolean
  enable_web_search: boolean
}
```

同时，将 `SearchJob` 中的 `config` 类型扩展：

```typescript
export interface SearchJob {
  id: string
  user_id: string
  document_id: string
  status: JobStatus
  scheduled_at: string | null
  config: {
    model_ids: string[]
    strategy_ids: string[]
    per_task_limit: number
    report_limit: number
    report_model_id: string
    report_system_prompt?: string
    model_feature_overrides?: ModelFeatureOverride[]  // 新增
  }
  started_at: string | null
  completed_at: string | null
  created_at: string
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/supabase/types.ts
git commit -m "feat: extend AIModel with AdapterConfig and add ModelFeatureOverride type"
```

---

## Task 3: 模型 CRUD API（含测试）

**Files:**
- Modify: `app/api/models/route.ts`
- Create: `app/api/models/[modelId]/route.ts`
- Create: `__tests__/api/models.test.ts`

- [ ] **Step 1: 写失败测试**

```typescript
// __tests__/api/models.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockGetUser = vi.fn()

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
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
npm run test:run -- __tests__/api/models.test.ts
```

预期：FAIL（模块不存在）

- [ ] **Step 3: 扩展 POST /api/models**

将 `app/api/models/route.ts` 中的 GET handler 保留，追加 POST：

```typescript
// app/api/models/route.ts
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'

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

export async function POST(request: NextRequest) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await request.json()
  const { name, api_base_url, model_id, api_key, usage_types, capabilities, adapter_config } = body as {
    name: string
    api_base_url: string
    model_id: string
    api_key: string
    usage_types: string[]
    capabilities: { deep_reasoning: boolean; web_search: boolean }
    adapter_config?: Record<string, unknown>
  }

  if (!name?.trim() || !api_base_url?.trim() || !model_id?.trim()) {
    return Response.json({ error: '名称、API地址和模型ID不能为空' }, { status: 400 })
  }

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('ai_models')
    .insert({
      owner_id: user.id,
      name: name.trim(),
      api_base_url: api_base_url.trim(),
      model_id: model_id.trim(),
      api_key_encrypted: api_key ?? '',
      usage_types: usage_types ?? [],
      capabilities: capabilities ?? { deep_reasoning: false, web_search: false },
      adapter_config: adapter_config ?? { provider: 'openai_compat', web_search_method: 'none', thinking_method: 'none', web_search_disables_thinking: false, thinking_default_on: false },
      is_builtin: false,
    })
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data, { status: 201 })
}
```

- [ ] **Step 4: 创建 PUT/DELETE /api/models/[modelId]**

```typescript
// app/api/models/[modelId]/route.ts
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('ai_models')
    .select('id, owner_id, is_builtin')
    .eq('id', modelId)
    .single()

  if (!existing) return Response.json({ error: '模型不存在' }, { status: 404 })
  if (existing.is_builtin || existing.owner_id !== user.id) {
    return Response.json({ error: '无权修改此模型' }, { status: 403 })
  }

  const body = await request.json()
  const { name, api_base_url, model_id, api_key, usage_types, capabilities, adapter_config } = body as {
    name?: string; api_base_url?: string; model_id?: string; api_key?: string
    usage_types?: string[]; capabilities?: { deep_reasoning: boolean; web_search: boolean }
    adapter_config?: Record<string, unknown>
  }

  const updates: Record<string, unknown> = {}
  if (name?.trim()) updates.name = name.trim()
  if (api_base_url?.trim()) updates.api_base_url = api_base_url.trim()
  if (model_id?.trim()) updates.model_id = model_id.trim()
  if (api_key !== undefined) updates.api_key_encrypted = api_key
  if (usage_types) updates.usage_types = usage_types
  if (capabilities) updates.capabilities = capabilities
  if (adapter_config) updates.adapter_config = adapter_config

  const admin = createServiceClient()
  const { data, error } = await admin
    .from('ai_models')
    .update(updates)
    .eq('id', modelId)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('ai_models')
    .select('id, owner_id, is_builtin')
    .eq('id', modelId)
    .single()

  if (!existing) return Response.json({ error: '模型不存在' }, { status: 404 })
  if (existing.is_builtin || existing.owner_id !== user.id) {
    return Response.json({ error: '无权删除此模型' }, { status: 403 })
  }

  const admin = createServiceClient()
  const { error } = await admin.from('ai_models').delete().eq('id', modelId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
```

- [ ] **Step 5: 运行测试，确认通过**

```bash
npm run test:run -- __tests__/api/models.test.ts
```

预期：所有测试通过。

- [ ] **Step 6: Commit**

```bash
git add app/api/models/ __tests__/api/models.test.ts
git commit -m "feat: add model CRUD API (POST/PUT/DELETE) with tests"
```

---

## Task 4: 安装 shadcn Switch 组件

**Files:**
- Installs: `components/ui/switch.tsx`, `components/ui/table.tsx`, `components/ui/badge.tsx`

- [ ] **Step 1: 安装缺失的 shadcn/ui 组件**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
npx shadcn@latest add switch table badge --yes
```

预期：`components/ui/switch.tsx`、`components/ui/table.tsx`、`components/ui/badge.tsx` 创建成功。

- [ ] **Step 2: Commit**

```bash
git add components/ui/switch.tsx components/ui/table.tsx components/ui/badge.tsx
git commit -m "feat: add Switch, Table, Badge shadcn components"
```

---

## Task 5: 模型列表组件 ModelTable

**Files:**
- Create: `components/settings/model-table.tsx`

- [ ] **Step 1: 创建 ModelTable 组件**

```tsx
// components/settings/model-table.tsx
'use client'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table'
import { Pencil, Trash2, Lock } from 'lucide-react'
import type { AIModel } from '@/lib/supabase/types'

const USAGE_LABEL: Record<string, string> = {
  search: '检索', parse: '解析', report: '报告',
}

interface ModelTableProps {
  models: AIModel[]
  onEdit: (model: AIModel) => void
  onDelete: (model: AIModel) => void
}

export function ModelTable({ models, onEdit, onDelete }: ModelTableProps) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>模型名称</TableHead>
          <TableHead>模型 ID</TableHead>
          <TableHead>用途</TableHead>
          <TableHead>能力</TableHead>
          <TableHead>API Key</TableHead>
          <TableHead className="w-24">操作</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {models.map((model) => (
          <TableRow key={model.id}>
            <TableCell className="font-medium">
              <div className="flex items-center gap-2">
                {model.name}
                {model.is_builtin && (
                  <Badge variant="secondary" className="text-xs">内置</Badge>
                )}
              </div>
            </TableCell>
            <TableCell className="font-mono text-sm text-slate-500">{model.model_id}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                {model.usage_types.map((t) => (
                  <Badge key={t} variant="outline" className="text-xs">{USAGE_LABEL[t] ?? t}</Badge>
                ))}
              </div>
            </TableCell>
            <TableCell>
              <div className="flex gap-1">
                {model.capabilities.deep_reasoning && (
                  <Badge className="text-xs bg-purple-50 text-purple-700 border-purple-200">深度思考</Badge>
                )}
                {model.capabilities.web_search && (
                  <Badge className="text-xs bg-blue-50 text-blue-700 border-blue-200">联网搜索</Badge>
                )}
              </div>
            </TableCell>
            <TableCell>
              {model.api_key_encrypted ? (
                <span className="text-xs text-green-600 font-medium">已配置 ✓</span>
              ) : (
                <span className="text-xs text-slate-400">未配置</span>
              )}
            </TableCell>
            <TableCell>
              {model.is_builtin ? (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => onEdit(model)} title="查看/配置 API Key">
                    <Lock size={14} />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-1">
                  <Button size="icon" variant="ghost" onClick={() => onEdit(model)}>
                    <Pencil size={14} />
                  </Button>
                  <Button size="icon" variant="ghost" className="text-red-500 hover:text-red-700" onClick={() => onDelete(model)}>
                    <Trash2 size={14} />
                  </Button>
                </div>
              )}
            </TableCell>
          </TableRow>
        ))}
        {models.length === 0 && (
          <TableRow>
            <TableCell colSpan={6} className="text-center text-slate-400 py-8">暂无模型，点击右上角添加</TableCell>
          </TableRow>
        )}
      </TableBody>
    </Table>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/model-table.tsx
git commit -m "feat: add ModelTable component for settings page"
```

---

## Task 6: 模型表单对话框 ModelFormDialog

**Files:**
- Create: `components/settings/model-form-dialog.tsx`

- [ ] **Step 1: 创建 ModelFormDialog 组件**

```tsx
// components/settings/model-form-dialog.tsx
'use client'

import { useState, useEffect } from 'react'
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import type { AIModel } from '@/lib/supabase/types'

interface ModelFormDialogProps {
  /** null = 新建，非null = 编辑/配置 API Key */
  model: AIModel | null
  open: boolean
  onOpenChange: (v: boolean) => void
  onSave: (data: ModelFormData) => Promise<void>
}

export interface ModelFormData {
  name: string
  api_base_url: string
  model_id: string
  api_key: string
  usage_types: string[]
  capabilities: { deep_reasoning: boolean; web_search: boolean }
}

const USAGE_OPTIONS = [
  { value: 'search', label: '检索平台' },
  { value: 'parse', label: '文献解析' },
  { value: 'report', label: '报告汇总' },
]

export function ModelFormDialog({ model, open, onOpenChange, onSave }: ModelFormDialogProps) {
  const isNew = model === null
  const isBuiltin = model?.is_builtin ?? false

  const [name, setName] = useState('')
  const [apiBaseUrl, setApiBaseUrl] = useState('')
  const [modelId, setModelId] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [usageTypes, setUsageTypes] = useState<string[]>([])
  const [deepReasoning, setDeepReasoning] = useState(false)
  const [webSearch, setWebSearch] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (model) {
      setName(model.name)
      setApiBaseUrl(model.api_base_url)
      setModelId(model.model_id)
      setApiKey('')  // 不回显 API Key（安全原则）
      setUsageTypes(model.usage_types)
      setDeepReasoning(model.capabilities.deep_reasoning)
      setWebSearch(model.capabilities.web_search)
    } else {
      setName(''); setApiBaseUrl(''); setModelId(''); setApiKey('')
      setUsageTypes([]); setDeepReasoning(false); setWebSearch(false)
    }
  }, [model, open])

  function toggleUsageType(value: string) {
    setUsageTypes(prev =>
      prev.includes(value) ? prev.filter(t => t !== value) : [...prev, value]
    )
  }

  async function handleSave() {
    setSaving(true)
    try {
      await onSave({ name, api_base_url: apiBaseUrl, model_id: modelId, api_key: apiKey, usage_types: usageTypes, capabilities: { deep_reasoning: deepReasoning, web_search: webSearch } })
      onOpenChange(false)
    } finally {
      setSaving(false)
    }
  }

  const canSave = isBuiltin
    ? apiKey.trim().length > 0  // 内置模型只需填入 API Key
    : name.trim() && apiBaseUrl.trim() && modelId.trim() && apiKey.trim()

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            {isNew ? '添加自定义模型' : isBuiltin ? `配置 API Key — ${model.name}` : `编辑模型 — ${model.name}`}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* 非内置模型才显示完整表单 */}
          {!isBuiltin && (
            <>
              <div className="space-y-1">
                <Label htmlFor="m-name">模型名称</Label>
                <Input id="m-name" value={name} onChange={e => setName(e.target.value)} placeholder="如：我的GPT-4o" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="m-base-url">API Base URL</Label>
                <Input id="m-base-url" value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="m-model-id">模型 ID</Label>
                <Input id="m-model-id" value={modelId} onChange={e => setModelId(e.target.value)} placeholder="gpt-4o" />
              </div>
            </>
          )}

          {/* API Key（所有模型都要填） */}
          <div className="space-y-1">
            <Label htmlFor="m-api-key">
              API Key {model?.api_key_encrypted ? <span className="text-xs text-green-600 ml-1">（已有配置，留空则保持不变）</span> : <span className="text-xs text-red-500 ml-1">（必填）</span>}
            </Label>
            <Input id="m-api-key" type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder="sk-..." autoComplete="off" />
          </div>

          {/* 非内置模型才显示用途和能力配置 */}
          {!isBuiltin && (
            <>
              <div className="space-y-2">
                <Label>用途（可多选）</Label>
                <div className="flex gap-4">
                  {USAGE_OPTIONS.map(opt => (
                    <div key={opt.value} className="flex items-center gap-2">
                      <Checkbox id={`usage-${opt.value}`} checked={usageTypes.includes(opt.value)} onCheckedChange={() => toggleUsageType(opt.value)} />
                      <Label htmlFor={`usage-${opt.value}`} className="text-sm cursor-pointer">{opt.label}</Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label>支持的能力</Label>
                <div className="flex gap-6">
                  <div className="flex items-center gap-2">
                    <Switch id="cap-thinking" checked={deepReasoning} onCheckedChange={setDeepReasoning} />
                    <Label htmlFor="cap-thinking" className="text-sm cursor-pointer">深度思考</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="cap-search" checked={webSearch} onCheckedChange={setWebSearch} />
                    <Label htmlFor="cap-search" className="text-sm cursor-pointer">联网搜索</Label>
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button onClick={handleSave} disabled={saving || !canSave}>
            {saving ? '保存中...' : '保存'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add components/settings/model-form-dialog.tsx
git commit -m "feat: add ModelFormDialog component for model API key and settings"
```

---

## Task 7: 模型库管理页面 /settings/models

**Files:**
- Create: `app/(app)/settings/models/page.tsx`

- [ ] **Step 1: 创建设置页面**

```tsx
// app/(app)/settings/models/page.tsx
'use client'

import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { ModelTable } from '@/components/settings/model-table'
import { ModelFormDialog, type ModelFormData } from '@/components/settings/model-form-dialog'
import { toast } from 'sonner'
import type { AIModel } from '@/lib/supabase/types'

export default function ModelsSettingsPage() {
  const [models, setModels] = useState<AIModel[]>([])
  const [loading, setLoading] = useState(true)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingModel, setEditingModel] = useState<AIModel | null>(null)

  async function loadModels() {
    const res = await fetch('/api/models')
    if (res.ok) setModels(await res.json())
    setLoading(false)
  }

  useEffect(() => { loadModels() }, [])

  function handleAdd() {
    setEditingModel(null)
    setDialogOpen(true)
  }

  function handleEdit(model: AIModel) {
    setEditingModel(model)
    setDialogOpen(true)
  }

  async function handleDelete(model: AIModel) {
    if (!confirm(`确认删除模型「${model.name}」？此操作不可撤销。`)) return
    const res = await fetch(`/api/models/${model.id}`, { method: 'DELETE' })
    if (res.ok) {
      toast.success('模型已删除')
      setModels(prev => prev.filter(m => m.id !== model.id))
    } else {
      const data = await res.json()
      toast.error(data.error ?? '删除失败')
    }
  }

  async function handleSave(data: ModelFormData) {
    if (editingModel) {
      // 更新：内置模型只更新 api_key_encrypted，自有模型全量更新
      const body: Record<string, unknown> = {}
      if (data.api_key) body.api_key = data.api_key
      if (!editingModel.is_builtin) {
        body.name = data.name
        body.api_base_url = data.api_base_url
        body.model_id = data.model_id
        body.usage_types = data.usage_types
        body.capabilities = data.capabilities
      }
      const res = await fetch(`/api/models/${editingModel.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (res.ok) {
        toast.success('模型已更新')
        await loadModels()
      } else {
        const err = await res.json()
        toast.error(err.error ?? '更新失败')
        throw new Error(err.error)
      }
    } else {
      // 新建
      const res = await fetch('/api/models', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (res.ok) {
        toast.success('模型已添加')
        await loadModels()
      } else {
        const err = await res.json()
        toast.error(err.error ?? '添加失败')
        throw new Error(err.error)
      }
    }
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-800">模型库</h1>
          <p className="text-sm text-slate-500 mt-1">管理 AI 模型及 API Key。内置模型由系统提供，点击锁图标配置你的 API Key。</p>
        </div>
        <Button onClick={handleAdd} className="flex items-center gap-2">
          <Plus size={16} />添加自定义模型
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-16 text-slate-400">加载中...</div>
      ) : (
        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
          <ModelTable models={models} onEdit={handleEdit} onDelete={handleDelete} />
        </div>
      )}

      <ModelFormDialog
        model={editingModel}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSave={handleSave}
      />
    </div>
  )
}
```

- [ ] **Step 2: 更新侧边栏导航**

打开 `components/sidebar.tsx`，找到：
```ts
{ href: '/settings/models', label: '模型库', icon: Settings },
```
确认已存在（Plan 1 时已添加）。若不存在，在 navItems 数组末尾追加：
```ts
{ href: '/settings/models', label: '模型库', icon: Settings },
```

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/settings/models/page.tsx" components/sidebar.tsx
git commit -m "feat: add /settings/models page for model library management"
```

---

## Task 8: Step 2 向导 ModelSelector 扩展——逐个模型的功能开关

**Files:**
- Modify: `components/wizard/model-selector.tsx`
- Modify: `app/(app)/search/new/step-2/page.tsx`

**背景：** 目前 Step 2 选择检索模型后，不能设置"本次检索是否开启深度思考/联网搜索"。需要在选中模型后显示两个开关，并将选择结果写入 `ModelFeatureOverride[]` 传入 Step 3 / `POST /api/jobs`。

- [ ] **Step 1: 重写 ModelSelector 组件**

```tsx
// components/wizard/model-selector.tsx
import { cn } from '@/lib/utils'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { Switch } from '@/components/ui/switch'
import { Label } from '@/components/ui/label'
import type { AIModel, ModelFeatureOverride } from '@/lib/supabase/types'

function isSearchCapable(m: AIModel) { return m.capabilities.deep_reasoning && m.capabilities.web_search }
function isReasoningCapable(m: AIModel) { return m.capabilities.deep_reasoning }

function disabledReason(m: AIModel, mode: 'search' | 'parse' | 'report'): string | null {
  if (mode === 'search') {
    if (!m.capabilities.deep_reasoning) return '需要深度推理能力'
    if (!m.capabilities.web_search) return '需要联网搜索能力'
  } else {
    if (!m.capabilities.deep_reasoning) return '需要深度推理能力'
  }
  return null
}

interface ModelSelectorProps {
  models: AIModel[]
  mode: 'search' | 'parse' | 'report'
  multiSelect?: boolean
  selectedIds: string[]
  onChange: (ids: string[]) => void
  /** 仅 search 模式使用：每个选中模型的功能开关 */
  featureOverrides?: ModelFeatureOverride[]
  onFeatureOverridesChange?: (overrides: ModelFeatureOverride[]) => void
}

export function ModelSelector({
  models, mode, multiSelect = false, selectedIds, onChange,
  featureOverrides = [], onFeatureOverridesChange,
}: ModelSelectorProps) {
  function toggle(id: string, disabled: boolean) {
    if (disabled) return
    const newIds = multiSelect
      ? selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id]
      : [id]
    onChange(newIds)

    // 新选中的模型加入 featureOverrides（默认值）
    if (multiSelect && !selectedIds.includes(id) && onFeatureOverridesChange) {
      const model = models.find(m => m.id === id)
      if (model) {
        const defaultThinking = model.adapter_config?.thinking_default_on ?? false
        const defaultSearch = model.capabilities.web_search
        const override: ModelFeatureOverride = {
          model_id: id,
          enable_thinking: defaultThinking,
          enable_web_search: defaultSearch,
        }
        onFeatureOverridesChange([...featureOverrides, override])
      }
    }
    // 取消选中时移除 override
    if (multiSelect && selectedIds.includes(id) && onFeatureOverridesChange) {
      onFeatureOverridesChange(featureOverrides.filter(o => o.model_id !== id))
    }
  }

  function updateOverride(modelId: string, field: 'enable_thinking' | 'enable_web_search', value: boolean) {
    if (!onFeatureOverridesChange) return
    const model = models.find(m => m.id === modelId)
    if (!model) return

    let thinking = featureOverrides.find(o => o.model_id === modelId)?.enable_thinking ?? false
    let search = featureOverrides.find(o => o.model_id === modelId)?.enable_web_search ?? false

    if (field === 'enable_thinking') thinking = value
    if (field === 'enable_web_search') search = value

    // 互斥规则：web_search_disables_thinking
    if (model.adapter_config?.web_search_disables_thinking) {
      if (field === 'enable_web_search' && value) thinking = false
      if (field === 'enable_thinking' && value) search = false
    }

    onFeatureOverridesChange(
      featureOverrides.map(o => o.model_id === modelId ? { ...o, enable_thinking: thinking, enable_web_search: search } : o)
    )
  }

  return (
    <TooltipProvider>
      <div className="space-y-3">
        {/* 模型芯片选择 */}
        <div className="flex flex-wrap gap-2">
          {models.map((m) => {
            const capable = mode === 'search' ? isSearchCapable(m) : isReasoningCapable(m)
            const reason = disabledReason(m, mode)
            const selected = selectedIds.includes(m.id)
            const chip = (
              <button key={m.id} type="button" disabled={!capable} onClick={() => toggle(m.id, !capable)}
                className={cn('px-3 py-1.5 rounded-full text-sm font-medium border transition-colors',
                  selected && capable ? 'bg-blue-600 border-blue-600 text-white'
                  : capable ? 'bg-white border-slate-300 text-slate-700 hover:border-blue-400'
                  : 'bg-slate-50 border-slate-200 text-slate-400 cursor-not-allowed'
                )}>
                {m.name}
              </button>
            )
            if (!capable && reason) return (
              <Tooltip key={m.id}>
                <TooltipTrigger asChild>{chip}</TooltipTrigger>
                <TooltipContent><p>{reason}</p></TooltipContent>
              </Tooltip>
            )
            return chip
          })}
        </div>

        {/* 已选模型的功能开关（仅 search 模式 + multiSelect） */}
        {mode === 'search' && multiSelect && selectedIds.length > 0 && (
          <div className="space-y-2 pl-1">
            {selectedIds.map(id => {
              const model = models.find(m => m.id === id)
              if (!model) return null
              const override = featureOverrides.find(o => o.model_id === id)
              const canThink = model.capabilities.deep_reasoning && model.adapter_config?.thinking_method !== 'none'
              const canSearch = model.capabilities.web_search && model.adapter_config?.web_search_method !== 'none'
              const mutuallyExclusive = model.adapter_config?.web_search_disables_thinking ?? false

              return (
                <div key={id} className="flex items-center gap-6 py-1.5 px-3 bg-blue-50 rounded-md text-sm">
                  <span className="font-medium text-blue-800 w-28 shrink-0">{model.name}</span>
                  {canThink && (
                    <div className="flex items-center gap-1.5">
                      <Switch
                        id={`think-${id}`}
                        checked={override?.enable_thinking ?? (model.adapter_config?.thinking_default_on ?? false)}
                        onCheckedChange={v => updateOverride(id, 'enable_thinking', v)}
                      />
                      <Label htmlFor={`think-${id}`} className="text-xs text-slate-600 cursor-pointer">深度思考</Label>
                    </div>
                  )}
                  {canSearch && (
                    <div className="flex items-center gap-1.5">
                      <Switch
                        id={`search-${id}`}
                        checked={override?.enable_web_search ?? true}
                        onCheckedChange={v => updateOverride(id, 'enable_web_search', v)}
                      />
                      <Label htmlFor={`search-${id}`} className="text-xs text-slate-600 cursor-pointer">联网搜索</Label>
                    </div>
                  )}
                  {mutuallyExclusive && override?.enable_thinking && override?.enable_web_search && (
                    <span className="text-xs text-amber-600">注意：该模型不支持同时开启两项</span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </TooltipProvider>
  )
}
```

- [ ] **Step 2: 更新 Step 2 页面，收集并传递 featureOverrides**

将 `app/(app)/search/new/step-2/page.tsx` 中与 ModelSelector 相关的部分更新为：

在 `Step2Page` 函数顶部，在现有 state 声明后新增：
```tsx
const [featureOverrides, setFeatureOverrides] = useState<ModelFeatureOverride[]>([])
```

在导入语句顶部追加：
```tsx
import type { ModelFeatureOverride } from '@/lib/supabase/types'
```

将检索平台的 `<ModelSelector>` 替换为：
```tsx
<ModelSelector
  models={searchModels}
  mode="search"
  multiSelect
  selectedIds={selectedSearchModelIds}
  onChange={setSelectedSearchModelIds}
  featureOverrides={featureOverrides}
  onFeatureOverridesChange={setFeatureOverrides}
/>
```

在 `handleNext` 函数中，将 `params` 构建改为：
```tsx
const p = new URLSearchParams({
  documentId,
  modelIds: selectedSearchModelIds.join(','),
  strategyIds: selectedStrategyIds.join(','),
  perTaskLimit: String(perTaskLimit),
  reportLimit: String(reportLimit),
  reportModelId: selectedReportModelIds[0] ?? '',
  reportSystemPrompt: reportPrompt,
  featureOverrides: JSON.stringify(featureOverrides),  // 新增
})
router.push(`/search/new/step-3?${p}`)
```

- [ ] **Step 3: 更新 Step 3 页面，读取并传递 featureOverrides 到 POST /api/jobs**

在 `app/(app)/search/new/step-3/page.tsx` 中：

在参数解析段追加：
```tsx
const featureOverridesParam = searchParams.get('featureOverrides') ?? '[]'
let featureOverrides: ModelFeatureOverride[] = []
try { featureOverrides = JSON.parse(featureOverridesParam) } catch { featureOverrides = [] }
```

在导入语句追加：
```tsx
import type { ModelFeatureOverride } from '@/lib/supabase/types'
```

在 `handleSubmit` 的 fetch body 中追加 `model_feature_overrides`：
```tsx
body: JSON.stringify({
  documentId,
  config: {
    model_ids: modelIds,
    strategy_ids: strategyIds,
    per_task_limit: perTaskLimit,
    report_limit: reportLimit,
    report_model_id: reportModelId,
    report_system_prompt: reportSystemPrompt,
    model_feature_overrides: featureOverrides,   // 新增
  },
  scheduledAt,
}),
```

- [ ] **Step 4: Commit**

```bash
git add components/wizard/model-selector.tsx \
        "app/(app)/search/new/step-2/page.tsx" \
        "app/(app)/search/new/step-3/page.tsx"
git commit -m "feat: add per-call deep thinking / web search toggles in Step 2 ModelSelector"
```

---

## Task 9: 内置模型 API Key 更新支持（PUT 允许内置模型更新 api_key_encrypted）

**背景分析：** Task 3 的 PUT handler 当前对内置模型返回 403。但内置模型需要用户填入自己的 API Key（其他字段不允许改）。需要给 PUT 添加一条专门路径：若模型是 `is_builtin = true`，只允许更新 `api_key_encrypted`。

**Files:**
- Modify: `app/api/models/[modelId]/route.ts`

- [ ] **Step 1: 修改 PUT handler，允许内置模型更新 api_key_encrypted**

将 `app/api/models/[modelId]/route.ts` 中的 PUT handler 修改为：

```typescript
// app/api/models/[modelId]/route.ts
import { NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/admin'

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('ai_models')
    .select('id, owner_id, is_builtin')
    .eq('id', modelId)
    .single()

  if (!existing) return Response.json({ error: '模型不存在' }, { status: 404 })

  const body = await request.json()

  const admin = createServiceClient()

  if (existing.is_builtin) {
    // 内置模型：任何已登录用户都可以更新自己的 api_key_encrypted
    // 但其他字段（name、model_id 等）不允许修改
    if (!body.api_key) {
      return Response.json({ error: '内置模型只支持更新 API Key' }, { status: 400 })
    }
    const { data, error } = await admin
      .from('ai_models')
      .update({ api_key_encrypted: body.api_key })
      .eq('id', modelId)
      .select()
      .single()
    if (error) return Response.json({ error: error.message }, { status: 500 })
    return Response.json(data)
  }

  // 自有模型：只允许本人修改
  if (existing.owner_id !== user.id) {
    return Response.json({ error: '无权修改此模型' }, { status: 403 })
  }

  const { name, api_base_url, model_id, api_key, usage_types, capabilities, adapter_config } = body as {
    name?: string; api_base_url?: string; model_id?: string; api_key?: string
    usage_types?: string[]; capabilities?: { deep_reasoning: boolean; web_search: boolean }
    adapter_config?: Record<string, unknown>
  }

  const updates: Record<string, unknown> = {}
  if (name?.trim()) updates.name = name.trim()
  if (api_base_url?.trim()) updates.api_base_url = api_base_url.trim()
  if (model_id?.trim()) updates.model_id = model_id.trim()
  if (api_key !== undefined) updates.api_key_encrypted = api_key
  if (usage_types) updates.usage_types = usage_types
  if (capabilities) updates.capabilities = capabilities
  if (adapter_config) updates.adapter_config = adapter_config

  const { data, error } = await admin
    .from('ai_models')
    .update(updates)
    .eq('id', modelId)
    .select()
    .single()

  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json(data)
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ modelId: string }> }
) {
  const { modelId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: existing } = await supabase
    .from('ai_models')
    .select('id, owner_id, is_builtin')
    .eq('id', modelId)
    .single()

  if (!existing) return Response.json({ error: '模型不存在' }, { status: 404 })
  if (existing.is_builtin || existing.owner_id !== user.id) {
    return Response.json({ error: '无权删除此模型' }, { status: 403 })
  }

  const admin = createServiceClient()
  const { error } = await admin.from('ai_models').delete().eq('id', modelId)
  if (error) return Response.json({ error: error.message }, { status: 500 })
  return Response.json({ ok: true })
}
```

- [ ] **Step 2: 更新测试——PUT 内置模型应返回 200（仅更新 api_key）**

在 `__tests__/api/models.test.ts` 中的 `describe('PUT /api/models/[modelId]')` 块内追加：

```typescript
  it('更新内置模型的 API Key 返回 200', async () => {
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
    const { createServiceClient } = await import('@/lib/supabase/admin')
    ;(createServiceClient as ReturnType<typeof vi.fn>).mockReturnValue({
      from: vi.fn().mockReturnValue({
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            select: vi.fn().mockReturnValue({
              single: vi.fn().mockResolvedValue({ data: { id: 'abc', api_key_encrypted: 'sk-xxx' }, error: null }),
            }),
          }),
        }),
      }),
    })
    const { PUT } = await import('@/app/api/models/[modelId]/route')
    const res = await PUT(
      new Request('http://localhost/api/models/abc', { method: 'PUT', body: JSON.stringify({ api_key: 'sk-xxx' }) }) as any,
      { params: Promise.resolve({ modelId: 'abc' }) }
    )
    expect(res.status).toBe(200)
  })
```

- [ ] **Step 3: 运行所有测试**

```bash
npm run test:run
```

预期：所有测试通过（包含旧的 preferences、documents、jobs 测试）。

- [ ] **Step 4: Commit**

```bash
git add app/api/models/[modelId]/route.ts __tests__/api/models.test.ts
git commit -m "feat: allow builtin models to have their API key updated by any user"
```

---

## Task 10: 端到端验证

**Files:** 无新文件

- [ ] **Step 1: 启动开发服务器**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
npm run dev
```

- [ ] **Step 2: 验证模型库页面**

访问 http://localhost:3000/settings/models，验证：
1. 表格显示 6 个内置模型（秘塔AI、Kimi K2.5、智谱GLM-5.1、DeepSeek、阿里千问、MiniMax）
2. 点击任一内置模型的锁图标 → 弹出对话框只显示 API Key 输入框
3. 输入一个假 Key（如 `sk-test-123`）→ 点击保存 → 表格中该模型显示"已配置 ✓"
4. 点击"添加自定义模型" → 弹出完整表单 → 填写并保存 → 新模型出现在表格末尾
5. 点击自定义模型的编辑按钮 → 修改名称 → 保存成功
6. 点击自定义模型的删除按钮 → 确认删除 → 行从表格消失

- [ ] **Step 3: 验证 Step 2 功能开关**

访问 http://localhost:3000/search/new/step-1，完成文件上传流程到 Step 2，验证：
1. 选中多个检索平台（如 Kimi + DeepSeek）→ 下方出现功能开关区域
2. 对 Kimi 同时开启"深度思考"和"联网搜索" → 应显示互斥警告
3. 对 DeepSeek 开启"深度思考" → "联网搜索"开关不显示（DeepSeek 不支持）
4. 点击"下一步" → Step 3 摘要卡片正确显示所选配置

- [ ] **Step 4: 运行全套测试**

```bash
npm run test:run
```

预期：所有 tests 通过。

- [ ] **Step 5: 最终 Commit**

```bash
git add .
git commit -m "feat: Plan 3 complete - model library management with API keys and per-call feature toggles"
```

---

## 自审检查

### 1. Spec 覆盖

| 需求 | 对应任务 |
|------|---------|
| 6 个主流模型内置到模型库 | Task 1 seed migration |
| 每个模型支持 API Key 绑定 | Task 6 ModelFormDialog + Task 9 PUT 内置模型 |
| 深度思考功能可勾选 | Task 8 ModelSelector 扩展 + featureOverrides |
| 联网搜索功能可勾选 | Task 8 ModelSelector 扩展 + featureOverrides |
| 互斥规则（Kimi/Qwen search+thinking 互斥） | Task 8 updateOverride 逻辑 |
| 模型库管理页面 /settings/models | Task 7 |
| 新增自定义模型 | Task 3 POST + Task 7 |
| 编辑/删除自定义模型 | Task 3 PUT/DELETE + Task 7 |
| adapter_config 记录提供商差异 | Task 1 migration + Task 2 types |

### 2. 占位符扫描

无 TBD/TODO。所有代码均为完整实现。

### 3. 类型一致性

- `ModelFeatureOverride.model_id` 是 `ai_models.id`（UUID），不是 `model_id`（字符串如 `kimi-k2.5`）—— Task 8 和 Task 2 定义一致 ✅
- `SearchJob.config.model_feature_overrides?: ModelFeatureOverride[]` 在 Task 2 中声明，在 Task 8 Step 3 中使用 ✅
- `AdapterConfig` 在 Task 2 中声明，在 Task 1 migration 中的 JSONB 结构完全一致 ✅
- `ModelTable` 的 `onEdit`/`onDelete` prop 类型与 Task 7 的 `handleEdit`/`handleDelete` 函数签名一致 ✅
