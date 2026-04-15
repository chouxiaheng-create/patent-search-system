# Plan 2: 三步检索向导 — 设计文档

**日期：** 2026-04-15
**版本：** 1.0
**状态：** 已确认，待实施
**前置依赖：** Plan 1（Foundation）已完成

---

## 1. 目标

实现 `/search/new` 三步向导，让用户能够：
1. 上传专利文献并等待 AI 解析
2. 配置检索平台、策略和参数
3. 确认并提交检索任务（支持立即执行或定时预约）

同时支持**自动挡模式**：用户保存偏好配置后，下次上传文件可一键跳过 Step 2，直达确认页提交。

---

## 2. 路由结构与文件组织

### 2.1 页面路由

```
app/(app)/search/
├── new/
│   ├── step-1/page.tsx     # 上传文件 & 解析
│   ├── step-2/page.tsx     # 配置检索
│   └── step-3/page.tsx     # 确认提交
└── [jobId]/
    ├── progress/page.tsx   # 进度看板（Plan 5）
    └── report/page.tsx     # 报告页（Plan 5）
```

### 2.2 API Routes

```
app/api/
├── documents/route.ts               # POST：创建记录 + 入队 parse-job
├── documents/[documentId]/route.ts  # GET：查询文档状态与解析结果
├── jobs/route.ts                    # POST：创建 search_job + 入队 search-job
├── models/route.ts                  # GET：列出可用 AI 模型
├── strategies/route.ts              # GET：列出可用检索策略
├── strategies/[strategyId]/route.ts # PUT：更新自定义策略；POST：另存为新策略
├── queue-status/route.ts            # GET：查询前方队列数
├── preferences/route.ts             # GET/PUT：用户偏好配置
└── worker-ping/route.ts             # GET：唤醒 Render Worker（fire-and-forget）
```

### 2.3 URL 流转

```
手动挡：
  /search/new/step-1
    ↓ 上传完成，获得 documentId
  /search/new/step-2?documentId={uuid}
    ↓ 配置完成
  /search/new/step-3?documentId={uuid}&modelIds={a,b}&strategyIds={c,d}
                    &perTaskLimit=5&reportLimit=10&reportModelId={uuid}
    ↓ 提交成功，获得 jobId
  /search/{jobId}/progress

自动挡（已保存偏好配置）：
  /search/new/step-1（模式切换为"偏好配置"）
    ↓ 上传完成，从 preferences 读取全量 config
  /search/new/step-3?documentId={uuid}&modelIds={...}&...&auto=1
    ↓ 提交成功
  /search/{jobId}/progress
```

---

## 3. 数据库变更

### 3.1 新增迁移文件

`supabase/migrations/20260415000001_add_preferences.sql`

```sql
-- 在 profiles 表新增 preferences 列
ALTER TABLE profiles
  ADD COLUMN preferences JSONB DEFAULT NULL;
```

`supabase/migrations/20260415000002_add_parse_config.sql`

```sql
-- 在 patent_documents 表新增 parse_config 列
-- 用于保存解析阶段所用的模型和提示词，供 Step 2 保存偏好配置时读取
ALTER TABLE patent_documents
  ADD COLUMN parse_config JSONB DEFAULT NULL;
```

**`parse_config` 数据结构：**

```typescript
interface ParseConfig {
  model_id: string          // 解析模型 ID
  system_prompt: string     // 解析环节系统提示词
}
```

### 3.2 preferences 数据结构

```typescript
interface UserPreferences {
  parse_model_id: string               // 解析模型 ID
  parse_system_prompt: string          // 解析环节系统提示词
  search_model_ids: string[]           // 检索平台模型 ID 列表
  strategy_ids: string[]               // 检索策略 ID 列表
  per_task_limit: number               // 每路径备选文献数（默认 5）
  report_limit: number                 // 报告输出文献数（默认 10）
  report_model_id: string              // 汇总模型 ID
  report_system_prompt: string         // 报告生成环节系统提示词
}
```

`profiles.preferences = null` 表示用户尚未保存配置，强制走手动流程。

### 3.3 内置默认提示词

**解析提示词（parse_system_prompt 首次使用默认值）：**
```
你是专利文献解析专家。请从以下专利文献中提取结构化信息，输出 JSON 格式，包含字段：
tech_theme（技术主题）、applicant（申请人）、inventor（发明人）、
filing_date（申请日，格式 YYYY-MM-DD）、main_tech_steps（主要技术方案步骤）、
core_invention（核心发明构思）。若字段无法确定则输出空字符串。
```

**报告生成提示词（report_system_prompt 首次使用默认值）：**
```
你是专业专利检索分析师。以下是针对一件专利申请的多路检索结果，请综合评估，
去除重复条目，按相关程度从高到低筛选最相关的文献，输出 JSON 数组，
每项包含：rank、title、authors、url、pub_date、relevance_desc、citation_gb。
```

---

## 4. 环境变量

```bash
# .env.local 新增
WORKER_URL=https://your-worker.onrender.com   # 用于 worker-ping
```

---

## 5. Step 1 — 上传文件 & 解析

### 5.1 页面布局（单栏纵向流）

```
[进度条：① 上传文件 → ② 配置检索 → ③ 确认提交]

[模式切换 Toggle：手动配置 | 使用偏好配置]   ← 仅 preferences != null 时显示

┌─────────────────────────────────────────┐
│ ① 选择解析模型                           │
│   [Kimi K2.5 ✓] [智谱GLM-5.1]  [⚙ 编辑提示词 ▾] │
│   （展开后显示 Textarea，可编辑 parse_system_prompt） │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ ② 上传文件                              │
│   拖拽区域（PDF/Word/Excel/TXT，≤20MB）  │
│   — 或从历史文献复用 —                   │
│   [下拉列表：本人 parse_status='done' 的文档] │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ ③ 解析结果（上传后展开）                  │
│   [解析中... 动画] / [解析完成 ✓]        │
│   ⚠ 质量预警横幅（quality_warning=true 时显示） │
│   技术主题 [可编辑] │ 申请人 [可编辑]     │
│   发明人   [可编辑] │ 申请日 [可编辑]     │
│   核心发明构思 [Textarea，可编辑]         │
│   主要技术方案步骤 [Textarea，可编辑]     │
│   备注 [Textarea，user_notes]            │
└─────────────────────────────────────────┘

[下一步 →]  ← parse_status='done' 后才激活
```

### 5.2 模式切换行为

| 模式 | 行为 |
|------|------|
| 手动配置 | 进入 Step 2 |
| 偏好配置 | 跳过 Step 2，直接进入 Step 3（URL 带 `auto=1` 及全量偏好参数） |

### 5.3 文件上传流程

```
1. 用户拖拽 / 选择文件
2. 前端调用 supabase.storage.from('documents').upload(path, file)
   直传 Supabase Storage（绕过 Vercel，避免 4.5MB 限制和 10s 超时）
3. POST /api/documents { fileUrl, fileName, fileType, parseModelId, parseSystemPrompt }
   服务端：INSERT patent_documents → 返回 { documentId }
           boss.send('parse-job', { documentId, parseModelId, parseSystemPrompt })
4. 前端跳转 /search/new/step-2?documentId={uuid}（手动挡）
         或 /search/new/step-3?documentId={uuid}&auto=1&...（自动挡）
5. 目标页面订阅 Supabase Realtime：
   patent_documents WHERE id = documentId
   监听 parse_status 变化 → 驱动解析结果区域状态更新
```

### 5.4 历史文档复用

- 展示条件：本人 `parse_status = 'done'` 的文档列表
- 选中后：跳转 `/search/new/step-2?documentId={uuid}`（手动挡）
         或跳转 `/search/new/step-3?documentId={uuid}&auto=1&...`（自动挡）
- 跳过解析等待，直接进入配置/确认步骤

### 5.5 解析结果编辑

- 6 个标准字段均为可编辑 Input / Textarea
- 修改后显示"保存修改"按钮，点击 PATCH `/api/documents/[documentId]`
  更新 `parsed_data` 和 `user_notes`
- 质量预警横幅（橙色）：`quality_warning=true` 时显示
  "文件排版复杂，解析结果可能不准确，建议逐项核对并在备注栏补充说明"

---

## 6. Step 2 — 配置检索

### 6.1 页面布局（平铺卡片）

```
[进度条：✓ 上传文件 → ② 配置检索 → ③ 确认提交]

┌─────────────────────────────────────────┐
│ 检索平台（多选）                          │
│ 仅显示 usage_types 含 'search'            │
│ 且 web_search=true 的模型                 │
│ [秘塔AI ✓] [Kimi K2.5 ✓] [智谱GLM-5.1 ○] │
│ 不满足条件的模型灰显，hover 显示 tooltip  │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 检索策略（多选）                          │
│ [追踪检索 ✓ · 内置 · 查看/编辑提示词]     │
│ [发明构思检索 ✓ · 内置 · 查看/编辑提示词] │
│ [主要技术方案步骤检索 ○ · 内置 · 查看提示词] │
│ [+ 新建自定义策略]                       │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 参数                                    │
│ 每路径备选文献数 [5]                      │
│ 报告输出文献数   [10]                     │
│ 汇总模型 [Kimi K2.5 ▾] [⚙ 编辑提示词 ▾] │
│ （展开后显示 Textarea，可编辑 report_system_prompt） │
└─────────────────────────────────────────┘

☑ 保存当前配置为我的偏好配置

[← 上一步]  [下一步 →]
```

### 6.2 检索策略提示词交互

| 策略类型 | "查看/编辑提示词" 行为 |
|----------|----------------------|
| 内置策略 | 展开 Sheet（侧抽屉），显示 prompt_template，提供"另存为我的策略"按钮，不可直接修改内置 |
| 自定义策略 | 展开 Sheet，可直接编辑 prompt_template，保存调用 PUT `/api/strategies/[id]` |
| 新建策略 | 展开 Sheet，空白编辑器，保存调用 POST `/api/strategies` |

### 6.3 数据加载

页面进入时并行请求：
```typescript
const [doc, models, strategies] = await Promise.all([
  fetch(`/api/documents/${documentId}`),  // 验证文档已解析
  fetch('/api/models'),
  fetch('/api/strategies'),
])
```

若 `doc.parse_status !== 'done'`，重定向回 Step 1 等待解析完成。

### 6.4 保存偏好配置

勾选"保存当前配置为我的偏好配置"后，进入 Step 3 时额外调用：
```
// 解析配置从 document.parse_config 读取（已在 POST /api/documents 时存入）
// 检索/报告配置来自当前 Step 2 表单
PUT /api/preferences {
  parse_model_id:      document.parse_config.model_id,
  parse_system_prompt: document.parse_config.system_prompt,
  search_model_ids,
  strategy_ids,
  per_task_limit,
  report_limit,
  report_model_id,
  report_system_prompt
}
```

---

## 7. Step 3 — 确认提交

### 7.1 页面布局

```
[进度条：✓ 上传文件 → ✓ 配置检索 → ③ 确认提交]
                                    [自动挡]  ← auto=1 时显示蓝色角标

┌─────────────────────────────────────────┐
│ 任务摘要                                │
│   检索平台  2    检索策略  2    子任务  4  │
│   解析模型：Kimi K2.5                   │
│   汇总模型：Kimi K2.5                   │
│                        [修改配置 → Step 2] │  ← 自动挡时显示
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 队列状态（30 秒轮询）                     │
│  🟢 队列空闲，提交后立即开始              │
│  🟡 队列中有 N 个任务，预计约 X 分钟后开始 │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│ 提交方式                                │
│   [立即提交 | 定时执行] Toggle           │
│                                         │
│   立即提交：[提交检索任务] 按钮           │
│   定时执行：[日期时间选择器]              │
│             [定时提交检索任务] 按钮        │
└─────────────────────────────────────────┘
```

### 7.2 提交流程

```
1. 用户点击提交按钮
2. fire-and-forget：GET /api/worker-ping（唤醒 Render，不阻塞）
3. POST /api/jobs {
     documentId,
     config: { model_ids, strategy_ids, per_task_limit,
               report_limit, report_model_id,
               parse_system_prompt, report_system_prompt },
     scheduledAt: Date | null
   }
   → INSERT search_jobs
   → boss.send('search-job', { jobId }, { startAfter: scheduledAt })
   → 返回 { jobId }
4. 若提交前勾选了"保存偏好"（来自 Step 2），同时 PUT /api/preferences
5. router.push(`/search/${jobId}/progress`)
```

---

## 8. API Routes 详细设计

### 8.1 `POST /api/documents`

```typescript
// Body
{ fileUrl: string; fileName: string; fileType: FileType;
  parseModelId: string; parseSystemPrompt: string }

// 服务端操作（使用 service_role_key）
// 1. 验证用户已登录
// 2. INSERT patent_documents { user_id, title: fileName, file_url: fileUrl,
//                              file_type: fileType, parse_status: 'pending',
//                              parse_config: { model_id: parseModelId,
//                                              system_prompt: parseSystemPrompt } }
// 3. boss.send('parse-job', { documentId, parseModelId, parseSystemPrompt })
// Response: { documentId: string }
```

### 8.2 `GET /api/documents/[documentId]`

```typescript
// 验证 user_id = auth.uid()（防越权）
// Response: PatentDocument（含 parse_status, parsed_data, quality_warning）
```

### 8.3 `PATCH /api/documents/[documentId]`

```typescript
// Body: { parsed_data?: ParsedData; user_notes?: string }
// 用于用户手动编辑解析结果字段
// 验证 user_id = auth.uid()
```

### 8.4 `GET /api/models`

```typescript
// 返回 owner_id IS NULL OR owner_id = auth.uid() 的模型
// Response: AIModel[]
```

### 8.5 `GET /api/strategies`

```typescript
// 返回 owner_id IS NULL OR owner_id = auth.uid() 的策略
// Response: SearchStrategy[]
```

### 8.6 `POST /api/strategies`

```typescript
// Body: { name: string; prompt_template: string }
// INSERT search_strategies { owner_id: auth.uid(), name, prompt_template, is_builtin: false }
// Response: SearchStrategy
```

### 8.7 `PUT /api/strategies/[strategyId]`

```typescript
// Body: { name?: string; prompt_template?: string }
// 仅允许修改 owner_id = auth.uid() 的策略（不可修改内置策略）
// Response: SearchStrategy
```

### 8.8 `POST /api/jobs`

```typescript
// Body
{
  documentId: string
  config: {
    model_ids: string[]
    strategy_ids: string[]
    per_task_limit: number
    report_limit: number
    report_model_id: string
    report_system_prompt: string   // 报告生成提示词（parse_system_prompt 不在此，解析已完成）
  }
  scheduledAt?: string   // ISO 8601，null = 立即执行
}

// 服务端操作
// 1. 验证文档属于当前用户且 parse_status = 'done'
// 2. INSERT search_jobs { user_id, document_id: documentId,
//                         status: 'queued', config, scheduled_at: scheduledAt }
// 3. boss.send('search-job', { jobId }, { startAfter: scheduledAt ?? undefined })
// Response: { jobId: string }
```

### 8.9 `GET /api/queue-status`

```typescript
// SELECT COUNT(*) FROM search_jobs WHERE status = 'queued'
// Response: { queuedCount: number }
// 前端按 queuedCount × 8 分钟估算等待时间
```

### 8.10 `GET /api/preferences`

```typescript
// SELECT preferences FROM profiles WHERE id = auth.uid()
// Response: UserPreferences | null
```

### 8.11 `PUT /api/preferences`

```typescript
// Body: UserPreferences
// UPDATE profiles SET preferences = $body WHERE id = auth.uid()
// Response: UserPreferences
```

### 8.12 `GET /api/worker-ping`

```typescript
// fire-and-forget，不等待结果
// 若 WORKER_URL 未配置（本地开发），直接返回 200，不报错
// if (!process.env.WORKER_URL) return Response.json({ ok: true })
// fetch(process.env.WORKER_URL + '/health',
//       { signal: AbortSignal.timeout(3000) }).catch(() => {})
// 始终返回 200 { ok: true }，不阻塞用户提交
```

---

## 9. 安全边界

| 操作 | 验证方式 |
|------|---------|
| 上传文件 | Supabase Storage RLS（已配置） |
| 创建文档记录 | API Route 验证 session；service_role_key 写入 |
| 读取文档 | 验证 `user_id = auth.uid()` |
| 编辑解析结果 | 验证 `user_id = auth.uid()` |
| 创建任务 | 验证文档属于当前用户；service_role_key 写入 |
| 修改策略 | 验证 `owner_id = auth.uid()`（内置策略不可修改） |
| 偏好配置读写 | 通过 `profiles.id = auth.uid()` 隔离 |

---

## 10. 组件清单

| 组件 | 路径 | 说明 |
|------|------|------|
| `WizardProgress` | `components/wizard/wizard-progress.tsx` | 顶部三步进度条 |
| `ModelSelector` | `components/wizard/model-selector.tsx` | 模型多选/单选，支持灰显和 tooltip |
| `PromptEditor` | `components/wizard/prompt-editor.tsx` | 可折叠的提示词 Textarea |
| `FileUploadZone` | `components/wizard/file-upload-zone.tsx` | 拖拽上传区，含进度条 |
| `HistoryDocPicker` | `components/wizard/history-doc-picker.tsx` | 历史文档下拉复用 |
| `ParseResultForm` | `components/wizard/parse-result-form.tsx` | 解析结果展示与编辑 |
| `StrategySheet` | `components/wizard/strategy-sheet.tsx` | 提示词查看/编辑侧抽屉 |
| `QueueStatusBanner` | `components/wizard/queue-status-banner.tsx` | 队列状态横幅，30s 轮询 |
| `JobSummaryCard` | `components/wizard/job-summary-card.tsx` | Step 3 任务摘要卡片 |
| `ScheduleToggle` | `components/wizard/schedule-toggle.tsx` | 立即/定时切换 + 日期选择器 |

---

## 11. 不在 Plan 2 范围内

- Worker 的 parse-job 实现（Plan 3）
- Worker 的 search-job 实现（Plan 4）
- 进度看板页面 `/search/[jobId]/progress`（Plan 5）
- 报告页面 `/search/[jobId]/report`（Plan 5）
- 完整的模型库管理页面 `/settings/models`（Plan 6）
- 完整的策略管理页面 `/settings/strategies`（Plan 6）
- Admin 后台（Plan 7）
