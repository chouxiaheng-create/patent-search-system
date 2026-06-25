# 专利检索智能体系统 — 开发文档

## 一、项目概述

本项目是一个**AI驱动的专利文献检索与对比分析系统**。用户上传专利文献后，系统自动（或人工辅助）提取技术主题、发明构思等结构化信息，然后通过多种AI模型 × 多种检索策略的组合，并行检索互联网上的相关对比文献，最终生成一份包含文献列表、相关性评价、出处链接和GB/T 7714引用格式的HTML检索报告。

**核心价值**：将传统专利审查中繁琐的手工检索流程自动化，通过多模型、多策略的交叉检索提高查全率和查准率，并自动生成结构化报告。

---

## 二、系统架构

### 2.1 整体架构

```
┌─────────────────────────────┐     ┌──────────────────────────────┐
│   Next.js Frontend (root)   │     │    Worker (worker/)          │
│   Port: 3000                │     │    Port: 3001                │
│                             │     │                              │
│  ┌───────────┐ ┌──────────┐│     │  ┌────────────────────────┐  │
│  │ App Router│ │ API Routes││     │  │ pg-boss Queue Consumer │  │
│  │ (Pages)   │ │ (REST)   ││     │  │                        │  │
│  └───────────┘ └──────────┘│     │  │ parse-job handler      │  │
│  ┌───────────────────────┐  │     │  │ search-job handler     │  │
│  │ Supabase Client (SSR) │  │     │  └────────────────────────┘  │
│  └───────────────────────┘  │     │  ┌────────────────────────┐  │
│  ┌───────────────────────┐  │     │  │ AI Adapter Factory     │  │
│  │ React Flow + Realtime │  │     │  │ ├ OpenAICompatAdapter  │  │
│  └───────────────────────┘  │     │  │ ├ MetasoAdapter        │  │
└──────────┬──────────────────┘     │  │ └ MockAdapter          │  │
           │                        │  └────────────────────────┘  │
           │                        │  ┌────────────────────────┐  │
           │     ┌──────────────────┤  │ File Parsers           │  │
           └─────┤                  │  │ ├ PDF / DOCX / XLSX /  │  │
                 │   Supabase       │  │ │   TXT                 │  │
                 │   ┌──────────┐   │  └────────────────────────┘  │
                 └───┤ PostgreSQL│   └──────────────────────────────┘
                     │ + Storage│
                     │ + Realtime│
                     │ + Auth   │
                     └──────────┘
```

### 2.2 双进程架构

| 进程           | 技术                      | 端口   | 职责                        |
| ------------ | ----------------------- | ---- | ------------------------- |
| **Frontend** | Next.js 16 (App Router) | 3000 | 页面渲染、API路由、用户认证、任务提交      |
| **Worker**   | Node.js + pg-boss       | 3001 | 消费消息队列、执行 AI 调用、文件解析、报告生成 |

两者通过 Supabase (PostgreSQL) 共享数据库和 Storage，通过 pg-boss 消息队列解耦。前端提交任务后立即返回，Worker 异步处理并实时更新数据库状态，前端通过 Supabase Realtime 订阅状态变更。

---

## 三、技术栈

### 3.1 前端

| 技术              | 版本      | 用途                   |
| --------------- | ------- | -------------------- |
| Next.js         | 16.2.3  | App Router 框架        |
| React           | 19.2.4  | UI 组件                |
| TypeScript      | 5.x     | 类型安全                 |
| Tailwind CSS    | 4.x     | 原子化 CSS              |
| shadcn/ui       | 4.2.0   | UI 组件库 (Radix UI 基座) |
| @xyflow/react   | 12.10.2 | 实时流程进度可视化            |
| react-hook-form | 7.72.1  | 表单管理                 |
| zod             | 4.3.6   | 数据校验                 |
| Supabase SSR    | 0.10.2  | 认证与会话管理              |
| pg-boss         | 12.15.0 | 消息队列客户端              |
| sonner          | 2.0.7   | Toast 通知             |

### 3.2 Worker

| 技术                 | 版本      | 用途           |
| ------------------ | ------- | ------------ |
| Node.js (CommonJS) | —       | 运行时          |
| TypeScript         | 6.x     | 类型安全         |
| Express            | 5.2.1   | 健康检查 HTTP 服务 |
| pg-boss            | 12.15.0 | 消息队列消费者      |
| pdf-parse          | 2.4.5   | PDF 文本提取     |
| mammoth            | 1.12.0  | DOCX 文本提取    |
| xlsx               | 0.18.5  | XLSX 文本提取    |
| dotenv             | 17.4.2  | 环境变量加载       |

### 3.3 基础设施

| 服务       | 用途                                |
| -------- | --------------------------------- |
| Supabase | PostgreSQL 数据库 + 文件存储 + 认证 + 实时订阅 |
| pg-boss  | 基于 PostgreSQL 的作业队列               |

---

## 四、目录结构

```
├── app/                              # Next.js App Router
│   ├── globals.css                   # 全局样式 + Tailwind + shadcn 主题变量
│   ├── layout.tsx                    # 根布局 (HTML > Body)
│   ├── (app)/                        # 认证路由组 (需登录)
│   │   ├── layout.tsx                # 应用布局 (Sidebar + Header + 内容区)
│   │   ├── dashboard/page.tsx        # 仪表盘
│   │   ├── search/
│   │   │   ├── new/
│   │   │   │   ├── step-1/page.tsx   # 步骤1：上传文档 + 解析
│   │   │   │   ├── step-2/page.tsx   # 步骤2：配置检索参数
│   │   │   │   └── step-3/page.tsx   # 步骤3：确认 + 提交
│   │   │   └── [jobId]/
│   │   │       ├── progress/page.tsx # 检索进度可视化 (React Flow)
│   │   │       └── report/page.tsx   # 检索报告查看
│   │   └── settings/models/page.tsx  # 模型管理设置页
│   ├── api/                          # Next.js Route Handlers (REST API)
│   │   ├── documents/route.ts        # GET列表 / POST上传文档
│   │   ├── documents/[documentId]/route.ts  # GET文档 / PATCH更新解析数据
│   │   ├── models/route.ts           # GET模型列表 / POST新建模型
│   │   ├── models/[modelId]/route.ts # PATCH更新 / DELETE删除模型
│   │   ├── strategies/route.ts       # GET策略列表 / POST新建策略
│   │   ├── strategies/[strategyId]/route.ts  # PATCH/DELETE策略
│   │   ├── jobs/route.ts             # POST创建检索任务
│   │   ├── reports/[reportId]/route.ts       # GET报告详情
│   │   ├── reports/[reportId]/documents/[docIndex]/route.ts  # PATCH用户评分
│   │   ├── reports/[reportId]/export/route.ts  # POST导出报告
│   │   ├── preferences/route.ts      # GET/PUT用户偏好设置
│   │   ├── queue-status/route.ts     # GET队列状态
│   │   └── worker-ping/route.ts      # GET Worker健康检查代理
│   └── auth/                         # 认证页面 (login, callback 等)
│
├── components/                       # React 组件
│   ├── ui/                           # shadcn/ui 基础组件
│   │   ├── button.tsx                # 按钮
│   │   ├── card.tsx                  # 卡片
│   │   ├── input.tsx                 # 输入框
│   │   ├── textarea.tsx              # 文本域
│   │   ├── badge.tsx                 # 徽章
│   │   ├── switch.tsx                # 开关
│   │   ├── dialog.tsx                # 对话框
│   │   ├── select.tsx                # 选择器
│   │   ├── dropdown-menu.tsx         # 下拉菜单
│   │   ├── tooltip.tsx               # 工具提示
│   │   ├── sheet.tsx                 # 侧边面板
│   │   ├── separator.tsx             # 分隔线
│   │   ├── label.tsx                 # 标签
│   │   ├── form.tsx                  # 表单 (react-hook-form集成)
│   │   ├── checkbox.tsx              # 复选框
│   │   ├── avatar.tsx                # 头像
│   │   ├── table.tsx                 # 表格
│   │   └── sonner.tsx                # Toast通知
│   ├── wizard/                       # 检索向导组件
│   │   ├── wizard-progress.tsx       # 步骤进度条 (1→2→3)
│   │   ├── file-upload-zone.tsx      # 文件上传区域
│   │   ├── model-selector.tsx        # 模型选择器
│   │   ├── prompt-editor.tsx         # 提示词编辑器
│   │   ├── parse-result-form.tsx     # 解析结果编辑表单
│   │   ├── job-summary-card.tsx      # 检索任务摘要卡片
│   │   ├── queue-status-banner.tsx   # 队列状态横幅
│   │   ├── schedule-toggle.tsx       # 定时任务开关
│   │   ├── history-doc-picker.tsx    # 历史文档选择器
│   │   └── strategy-sheet.tsx        # 检索策略选择面板
│   ├── flow/                         # React Flow 进度可视化
│   │   ├── job-progress.tsx          # 主进度组件
│   │   ├── job-sidebar.tsx           # 进度侧栏
│   │   ├── queue-banner.tsx          # 队列信息横幅
│   │   └── nodes/                    # 自定义 Flow 节点
│   │       ├── parse-node.tsx        # 解析节点
│   │       ├── search-task-node.tsx  # 检索子任务节点
│   │       ├── report-node.tsx       # 报告生成节点
│   │       └── placeholder-node.tsx  # 占位节点
│   ├── report/                       # 报告展示组件
│   │   ├── report-preview.tsx        # 报告预览容器
│   │   ├── report-view.tsx           # 报告内容渲染 (iframe)
│   │   ├── document-list.tsx         # 文献列表
│   │   ├── document-card.tsx         # 单篇文献卡片
│   │   └── export-menu.tsx           # 导出菜单
│   ├── settings/                     # 设置页组件
│   │   ├── model-table.tsx           # 模型列表表格
│   │   └── model-form-dialog.tsx     # 模型编辑对话框
│   ├── sidebar.tsx                   # 侧边导航栏
│   └── header.tsx                    # 顶部导航栏
│
├── lib/                              # 共享工具库
│   ├── supabase/
│   │   ├── client.ts                 # 浏览器端 Supabase 客户端 (anon key)
│   │   ├── server.ts                 # 服务端 Supabase 客户端 (cookie auth)
│   │   ├── admin.ts                  # 服务角色客户端 (service_role key, 绕过RLS)
│   │   └── types.ts                  # 前端共享类型定义
│   ├── boss-client.ts                # pg-boss 单例客户端
│   └── utils.ts                      # 通用工具函数
│
├── worker/                           # Worker 进程
│   ├── src/
│   │   ├── index.ts                  # 入口：启动pg-boss + 注册handler + 健康检查
│   │   ├── health.ts                 # Express健康检查 (/health)
│   │   ├── handlers/
│   │   │   ├── parse-job.ts          # 解析任务处理器
│   │   │   └── search-job.ts         # 检索任务处理器
│   │   ├── adapters/
│   │   │   ├── base.ts               # AIAdapter 接口定义
│   │   │   ├── index.ts              # 适配器工厂函数
│   │   │   ├── openai-compat.ts      # OpenAI兼容适配器 (通用)
│   │   │   ├── metaso.ts             # 秘塔AI 搜索适配器
│   │   │   └── mock-adapter.ts       # Mock适配器 (开发测试用)
│   │   ├── parsers/
│   │   │   ├── index.ts              # 文件解析器入口
│   │   │   ├── pdf.ts               # PDF解析 (pdf-parse)
│   │   │   ├── docx.ts              # DOCX解析 (mammoth)
│   │   │   ├── xlsx.ts              # XLSX解析 (xlsx)
│   │   │   └── txt.ts               # TXT解析 (UTF-8/GBK auto-detect)
│   │   ├── services/
│   │   │   ├── supabase.ts           # Worker Supabase 客户端 + 数据操作
│   │   │   ├── notification.ts       # 站内通知服务
│   │   │   └── report.ts             # 报告生成 (去重 + AI筛选 + HTML渲染)
│   │   └── utils/
│   │       ├── prompt.ts             # 提示词模板填充 + 检索结果解析 + 筛选
│   │       └── retry.ts              # 限流重试 + 并发控制信号量
│   └── __tests__/                    # Worker 单元测试
│
├── supabase/migrations/              # 数据库迁移 (幂等SQL)
│   ├── 20260413000001_schema.sql     # 核心表结构 (8张表)
│   ├── 20260413000002_rls.sql        # Row Level Security 策略
│   ├── 20260413000003_seed.sql       # 内置模型 + 检索策略种子数据
│   ├── 20260415000001_add_preferences.sql  # profiles 新增 preferences 字段
│   ├── 20260415000002_add_parse_config.sql # patent_documents 新增 parse_config
│   ├── 20260415000003_storage_setup.sql    # 文件存储桶配置
│   ├── 20260416000001_add_adapter_config.sql # ai_models 新增 adapter_config
│   ├── 20260416000002_fix_seed_models.sql   # 修复内置模型配置 (Kimi/智谱/MiniMax/DeepSeek/千问)
│   ├── 20260425000001_fix_minimax_url.sql   # 修复 MiniMax API 地址
│   └── 20260425000002_unique_strategies.sql # 策略名称唯一约束
│
├── __tests__/                        # 前端 Vitest 测试
├── frontend.log                      # 前端运行日志
├── worker.log / worker/worker.log    # Worker 运行日志
├── test-*.js                         # API 手动测试脚本 (metaso, minimax, zhipu, apis, mock)
├── package.json                      # 前端项目配置
├── tsconfig.json                     # 前端 TypeScript 配置
├── next.config.ts                    # Next.js 配置
├── vitest.config.ts                  # Vitest 测试配置
├── CLAUDE.md                         # Claude Code 项目指南
└── AGENTS.md                         # Agent 行为指南
```

---

## 五、数据库设计

### 5.1 表结构概览

共 8 张核心业务表，全部启用 RLS (Row Level Security)：

| 表名                  | 用途                   | RLS 策略              |
| ------------------- | -------------------- | ------------------- |
| `profiles`          | 用户档案 (关联 auth.users) | 用户读写自己的档案           |
| `ai_models`         | AI 模型配置              | 内置模型全员可读；用户自建模型自己管理 |
| `search_strategies` | 检索策略模板               | 内置策略全员可读；用户自建策略自己管理 |
| `patent_documents`  | 专利文献                 | 用户管理自己的文档           |
| `search_jobs`       | 检索任务主表               | 用户管理自己的任务           |
| `search_tasks`      | 检索子任务明细              | 通过 job→user 间接隔离    |
| `reports`           | 检索报告                 | 用户查看自己的报告           |
| `notifications`     | 站内通知                 | 用户查看自己的通知           |

### 5.2 关键字段

**ai_models.adapter_config** (JSONB) — 适配器配置核心结构：

```json
{
  "provider": "openai_compat | metaso",
  "web_search_method": "tools_builtin | tools_web_search | extra_body | native | none",
  "web_search_tool_name": "$web_search",
  "web_search_params": { "search_mode": "online" },
  "thinking_method": "param | model_switch | extra_body | default_on | none",
  "thinking_model_id": "deepseek-reasoner",
  "web_search_disables_thinking": false,
  "thinking_default_on": true
}
```

**search_jobs.config** — 检索任务配置：

```json
{
  "model_ids": ["uuid1", "uuid2"],
  "strategy_ids": ["uuid3"],
  "per_task_limit": 10,
  "report_limit": 15,
  "report_model_id": "uuid4",
  "report_system_prompt": "...",
  "model_feature_overrides": [
    { "model_id": "uuid1", "enable_thinking": true, "enable_web_search": false }
  ]
}
```

### 5.3 状态流转

**parse_status**: `pending` → `parsing` → `done`/`needs_review`/`failed`

**job_status**: `queued` → `running` → `completed`/`failed`/`cancelled`

**task_status**: `pending` → `running` → `done`/`abandoned`（中间可通过 `retrying` 过渡）

### 5.4 迁移规范

- 所有迁移文件必须**幂等**：使用 `IF NOT EXISTS`、`DROP IF EXISTS`、`DO $$ ... EXCEPTION WHEN OTHERS THEN NULL` 块
- 文件按时间戳顺序编号，只增不改
- 不可逆的数据删除操作需用户确认 + 备份

---

## 六、API 路由

所有 API 均为 Next.js Route Handler，路径 `app/api/*/route.ts`。

### 6.1 认证模型

- 用户 API：`createClient()` (server, cookie-based auth) → 校验 `user.id`
- 管理写入：关键操作使用 `createServiceClient()` (service_role key, 绕过 RLS)
- 文件上传：`supabase.storage.from('documents').upload()` + 随后 POST `/api/documents`

### 6.2 路由清单

| 方法      | 路径                                             | 说明                     |
| ------- | ---------------------------------------------- | ---------------------- |
| GET     | `/api/models`                                  | 获取模型列表 (内置 + 自建)       |
| POST    | `/api/models`                                  | 创建自定义模型                |
| PATCH   | `/api/models/[modelId]`                        | 更新模型配置                 |
| DELETE  | `/api/models/[modelId]`                        | 删除自定义模型                |
| GET     | `/api/strategies`                              | 获取策略列表                 |
| POST    | `/api/strategies`                              | 创建自定义策略                |
| PATCH   | `/api/strategies/[strategyId]`                 | 更新策略                   |
| DELETE  | `/api/strategies/[strategyId]`                 | 删除策略                   |
| GET     | `/api/documents`                               | 获取用户文档列表               |
| POST    | `/api/documents`                               | 创建文档记录 + 入队 parse-job  |
| GET     | `/api/documents/[documentId]`                  | 获取文档详情 + 解析结果          |
| PATCH   | `/api/documents/[documentId]`                  | 更新解析数据 (人工修正)          |
| POST    | `/api/jobs`                                    | 创建检索任务 + 入队 search-job |
| GET     | `/api/reports/[reportId]`                      | 获取报告详情 (含关联文档)         |
| PATCH   | `/api/reports/[reportId]/documents/[docIndex]` | 更新文献用户评分               |
| POST    | `/api/reports/[reportId]/export`               | 导出报告 (DOCX/PDF)        |
| GET/PUT | `/api/preferences`                             | 获取/更新用户偏好设置            |
| GET     | `/api/queue-status`                            | 获取 pg-boss 队列统计        |
| GET     | `/api/worker-ping`                             | 代理 worker 健康检查         |

---

## 七、Worker 架构

### 7.1 入口 (`worker/src/index.ts`)

```typescript
async function main() {
  startHealthServer(3001)          // Express /health 端点
  const boss = new PgBoss(DATABASE_URL)
  await boss.start()
  await boss.createQueue('parse-job')
  await boss.createQueue('search-job')
  await boss.work('parse-job', { localConcurrency: 1 }, handleParseJob)
  await boss.work('search-job', { localConcurrency: 1 }, handleSearchJob)
}
```

两个队列的 `localConcurrency` 均为 1，意味着同一时间每个队列只处理一条任务，避免并发抢占数据库/API资源。

### 7.2 parse-job 处理流程

```
1. 获取文档记录 + 更新状态为 'parsing'
2. 从 Supabase Storage 下载原始文件
3. 根据 file_type 调用对应解析器 (PDF/DOCX/XLSX/TXT)
4. 构建解析提示词 (buildParsePrompt)
5. 通过 createAdapter(model) 调用 AI 模型
6. 解析 AI 返回的 JSON → parsed_data
7. 更新数据库 (parse_status, parsed_data, quality_warning)
8. 发送站内通知 (parse_done / parse_failed)
```

### 7.3 search-job 处理流程

```
1. 检查任务是否已被取消
2. 更新状态为 'running' + 记录 started_at
3. 计算子任务: model_ids × strategy_ids → search_tasks 行
4. 按模型分组执行: 模型间并行(Promise.all), 同模型内串行(间隔5s)
5. 每个子任务:
   a. 获取模型 + 策略 + 功能覆盖配置
   b. fillPromptTemplate(strategy.prompt_template, parsedData) → 检索提示词
   c. adapter.call() → AI 返回检索结果 JSON
   d. parseSearchResults() → 结构化结果
   e. 更新 task 状态 (running → retrying → done/abandoned)
6. 收集所有结果 → 按 URL 去重
7. generateReport():
   a. 构建路径摘要 (每个平台×策略的执行状态)
   b. 按 URL 去重
   c. 若结果 > report_limit，调用 report_model 进行 AI Top-N 筛选
   d. 生成 HTML 报告 + 写入 reports 表
8. 更新 job 状态为 'completed' + 发送通知
```

### 7.4 重试与容错

`worker/src/utils/retry.ts` 提供了：

- **callWithRetry()**: 自动识别限流错误 (`429`/`rate_limit`)，支持指数退避 + 抖动重试 (默认最多5次)，非限流错误直接抛出
- **Semaphore**: 简单信号量实现，用于并发控制
- **isRateLimitError() / parseRetryAfter()**: 从错误消息中提取限流等待时间

### 7.5 提示词工具 (`worker/src/utils/prompt.ts`)

- **fillPromptTemplate()**: 将 `{{tech_theme}}` 等模板变量替换为解析数据
- **parseSearchResults()**: 多级降级解析 AI 返回的检索结果 (JSON数组 → 文本解析 → URL提取)
- **buildSelectionPrompt()**: 构建 Top-N 筛选提示词 (专利信息 + 候选文献列表)
- **extractParsedData()**: 从 AI 响应中提取 JSON 数据 (支持中英文字段名)

---

## 八、AI 适配器系统

### 8.1 设计模式

采用**工厂模式** (`worker/src/adapters/index.ts`)：

```typescript
function createAdapter(model: AIModelRecord): AIAdapter {
  if (MOCK_MODE) return new MockAdapter()
  if (model.adapter_config.provider === 'metaso') return new MetasoAdapter(...)
  return new OpenAICompatAdapter(baseUrl, apiKey, adapterConfig)
}
```

所有适配器实现统一接口 (`AIAdapter`)：

```typescript
interface AIAdapter {
  name: string
  call(options: AIAdapterCallOptions): Promise<AIAdapterResult>
}
```

### 8.2 OpenAICompatAdapter — 通用适配器

用于所有 OpenAI-compatible API (Kimi, 智谱GLM, DeepSeek, Qwen, MiniMax 等)。

**请求构建 (buildRequestBody)**：

| 配置维度                  | 支持的实现方式                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **深度思考 (thinking)**   | `param` (thinking: {type}) / `model_switch` (换 model_id) / `extra_body` (enable_thinking) / `default_on` (默认开) / `none`       |
| **联网搜索 (web_search)** | `tools_builtin` ($web_search) / `tools_web_search` (web_search工具) / `extra_body` (enable_search) / `native` (搜索引擎原生) / `none` |

**多轮 Tool Calls 处理**：最多 3 轮 — 处理 Kimi 等需要先返回 tool_calls 再接收最终结果的 API。当 `finish_reason === 'tool_calls'` 时自动追加 tool 响应并继续请求。

**MiniMax 兼容**：自动过滤 `<think>...</think>` 标签获取实际内容。

### 8.3 MetasoAdapter — 秘塔搜索适配器

专用搜索引擎 API，直接 POST `/v1/search`，返回格式化的网页搜索结果摘要。

### 8.4 MockAdapter — 开发测试适配器

当 `MOCK_MODE=true` 时启用，返回模拟的检索结果，用于无 API 密钥时的前端开发。

### 8.5 内置模型配置速查

| 模型        | provider      | web_search_method | thinking_method | 特殊配置                           |
| --------- | ------------- | ----------------- | --------------- | ------------------------------ |
| 秘塔AI      | metaso        | native            | none            | 专用搜索引擎                         |
| Kimi K2.6 | openai_compat | tools_builtin     | default_on      | web_search 时禁用 thinking        |
| 智谱GLM-5.1 | openai_compat | tools_web_search  | param           | tools 带 search_mode            |
| DeepSeek  | openai_compat | none              | model_switch    | thinking 切换为 deepseek-reasoner |
| 阿里千问      | openai_compat | extra_body        | extra_body      | web_search 时禁用 thinking        |
| MiniMax   | openai_compat | tools_web_search  | extra_body      | —                              |

---

## 九、数据流全景

### 9.1 完整业务流程

```
用户上传专利文档 (step-1)
  │
  ├─→ 前端 POST /api/documents → DB: patent_documents (pending)
  │   └─→ pg-boss.send('parse-job', { documentId, parseModelId })
  │
  ├─→ Worker parse-job handler:
  │   ├─ Storage.download() → 获取文件
  │   ├─ parseFile() → 提取文本 (PDF/DOCX/XLSX/TXT)
  │   ├─ buildParsePrompt() + adapter.call() → AI 结构化提取
  │   ├─ extractParsedData() → 解析 JSON
  │   └─ DB UPDATE: parse_status='done' + parsed_data
  │
  ├─→ 前端 Supabase Realtime 订阅 → 状态更新 → UI 响应
  │
用户配置 + 提交检索 (step-2 → step-3)
  │
  ├─→ 前端 POST /api/jobs → DB: search_jobs (queued)
  │   └─→ pg-boss.send('search-job', { jobId })
  │
  ├─→ Worker search-job handler:
  │   ├─ createSearchTasks() → modelIds × strategyIds → N 个子任务
  │   ├─ 按模型分组执行:
  │   │   ├─ fillPromptTemplate() → 检索提示词
  │   │   ├─ adapter.call() → AI 检索
  │   │   ├─ parseSearchResults() → 结构化
  │   │   └─ DB UPDATE: task status + results
  │   ├─ 去重 (by URL) + AI Top-N 筛选
  │   ├─ buildHtmlReport() → HTML
  │   ├─ DB INSERT: reports
  │   └─ sendNotification() → 站内通知
  │
  └─→ 前端 Realtime + React Flow → 实时进度 → 最终报告
```

### 9.2 实时通信

- **Supabase Realtime**: 前端订阅 `patent_documents`、`search_jobs`、`search_tasks`、`notifications` 的 `UPDATE/INSERT` 事件
- **React Flow**: `components/flow/job-progress.tsx` 将子任务状态映射为可视化流程图节点

---

## 十、开发指南

### 10.1 环境准备

```bash
# 1. 克隆项目
git clone <repo-url>
cd <project-dir>

# 2. 安装前端依赖
npm install

# 3. 安装 Worker 依赖
cd worker && npm install && cd ..

# 4. 配置环境变量 (复制模板)
cp .env.local.example .env.local
# 编辑 .env.local 填入 Supabase URL、Anon Key、Service Role Key、DATABASE_URL

# 5. 启动 Supabase (本地或远程)
# 运行数据库迁移 (通过 Supabase CLI 或 Dashboard SQL Editor)
```

### 10.2 开发启动

**终端 1 — Worker:**

```bash
cd worker
npm run dev          # nodemon + ts-node, 端口 3001
```

**终端 2 — Frontend:**

```bash
npm run dev          # Next.js dev server, 端口 3000
```

**Mock 模式 (无需 API 密钥):**

```bash
set MOCK_MODE=true   # Windows PowerShell
cd worker && npm run dev
```

### 10.3 常用命令

```bash
# 前端
npm run build        # 生产构建
npm run lint         # ESLint 检查
npm test             # Vitest 测试 (watch)
npm run test:run     # Vitest 单次运行

# Worker
cd worker
npm run build        # TypeScript 编译 → dist/
npm run start        # 生产运行
```

### 10.4 新增 AI 模型

1. 确认模型的 API 兼容性 (OpenAI-compatible 或专用)
2. 在 Supabase `ai_models` 表插入新记录，配置正确的 `adapter_config`
3. 如果是新的 `provider` 类型，在 `worker/src/adapters/` 新建适配器类
4. 更新 `createAdapter()` 工厂函数
5. 创建测试脚本验证 API 连通性

### 10.5 新增检索策略

1. 在 Supabase `search_strategies` 表插入 `prompt_template`
2. 使用 `{{tech_theme}}`、`{{core_invention}}` 等模板变量引用专利解析数据
3. 也支持 `{{custom.字段名}}` 引用自定义字段

### 10.6 数据库迁移

```bash
# 文件命名: supabase/migrations/YYYYMMDDNNNNNN_description.sql
# 必须幂等: IF NOT EXISTS / DROP IF EXISTS / DO $$ blocks
# 执行: 通过 Supabase Dashboard SQL Editor 或 supabase CLI
```

### 10.7 项目编码约定

- **TypeScript 版本**: 前端 5.x, Worker 6.x, 模块系统不同 (ESM vs CommonJS), **不交叉 import**
- **类型定义**: 前端 `lib/supabase/types.ts`, Worker 各自定义接口
- **外部 API**: 修改适配器前必须查阅官方文档, 用 test-*.js 验证
- **安全性**: 只在前端使用 anon key, service_role key 仅用于服务端
- **文件操作**: 编辑前先读取, 多文件修改并行, 修改后验证构建
- **Git**: 不提交 `.env`、密钥、credentials

---

## 十一、部署

### 11.1 生产构建

```bash
# Frontend
npm run build           # → .next/
npm run start           # 或部署到 Vercel / 其他 Next.js 托管平台

# Worker
cd worker
npm run build           # → dist/
npm run start           # 或使用 PM2 / systemd 守护
```

### 11.2 所需的 Supabase 配置

- **Auth**: Email/Password 或第三方 OAuth
- **Database**: 运行所有迁移文件
- **Storage**: 创建 `documents` bucket (策略: authenticated 用户可上传自己的文件)
- **Realtime**: 开启 `search_jobs`、`search_tasks`、`notifications`、`patent_documents` 的 replication

### 11.3 环境变量清单

| 变量                              | 用途                  | 位置                    |
| ------------------------------- | ------------------- | --------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Supabase 项目 URL     | 前端 + Worker           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 匿名密钥       | 前端                    |
| `SUPABASE_SERVICE_ROLE_KEY`     | Supabase 服务角色密钥     | 前端服务端 + Worker        |
| `DATABASE_URL`                  | PostgreSQL 直连 URL   | 前端 (pg-boss) + Worker |
| `WORKER_URL`                    | Worker 健康检查地址       | 前端                    |
| `MOCK_MODE`                     | 启用 Mock 适配器         | Worker                |
| `PORT`                          | Worker 端口 (默认 3001) | Worker                |

---

## 十二、扩展点

1. **新增文件格式解析**: 在 `worker/src/parsers/` 添加新解析器, 更新 `parseFile()` switch-case
2. **新增AI平台**: 实现 `AIAdapter` 接口, 注册到 `createAdapter()` 工厂
3. **报告格式扩展**: 当前仅 HTML, 可扩展为 PDF/DOCX 导出
4. **定时任务**: pg-boss 支持 `startAfter` 参数, `POST /api/jobs` 已接收 `scheduledAt`
5. **用户偏好**: `profiles.preferences` JSONB 字段存储默认解析/检索配置
6. **质量审查**: 解析结果含 `quality_warning` 标志 → `needs_review` 状态 → 人工修正
