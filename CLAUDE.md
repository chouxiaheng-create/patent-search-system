# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Commands

### Frontend (Next.js — runs from project root)

```bash
npm run dev          # Start Next.js dev server (localhost:3000)
npm run build        # Production build to .next/
npm run start        # Start production server
npm run lint         # ESLint 9 flat config check (core-web-vitals + typescript)
npm test             # Start Vitest in watch mode
npm run test:run     # Vitest single run
npx vitest run -t "test name"  # Run a single test
```

### Worker (standalone process — run from `worker/`)

```bash
cd worker
npm run dev          # nodemon + ts-node (watch mode, port 3001)
npm run build        # tsc → dist/
npm run start        # node dist/index.js
```

### Running both for development

In separate terminals:

1. `cd worker && npm run dev` (background job processor + health endpoint)
2. `npm run dev` (frontend)

### Mock mode

```
MOCK_MODE=true    # Worker uses MockAdapter — no real API calls
```

## Architecture

### Dual-process system

- **Next.js frontend** (root): App Router, Supabase auth, job submission, progress/report views
- **Worker** (`worker/`): Standalone Node.js process using pg-boss to poll `parse-job` and `search-job` queues. Adapts to multiple AI APIs via factory pattern

### Data flow

```
User uploads patent document (step-1)
  → API creates patent_documents row + enqueues parse-job
  → Worker parses file (PDF/DOCX/XLSX/TXT), calls AI model, updates parsed_data
User configures search (step-2): selects models × strategies, limits, report model
  → API creates search_jobs row + enqueues search-job
  → Worker creates search_tasks (Cartesian product model_id × strategy_id)
  → Worker iterates tasks calling AI, collects results, deduplicates by URL
  → Worker generates HTML report via AI (top-N selection + path summaries)
  → User sees real-time progress (React Flow / Supabase Realtime) then report (step-3)
```

### Key directories

| Directory              | Purpose                                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------------------ |
| `app/`                 | Next.js App Router — pages, API routes, layouts                                                  |
| `components/`          | React components by domain: `ui/` (shadcn), `wizard/`, `flow/`, `report/`, `settings/`           |
| `lib/`                 | Shared utilities: Supabase clients (`client.ts`, `server.ts`, `admin.ts`), pg-boss client, types |
| `worker/src/`          | Worker entry, handlers, adapters, parsers, services                                              |
| `supabase/migrations/` | SQL migrations (idempotent, sequentially numbered)                                               |
| `__tests__/`           | Vitest frontend tests; `worker/__tests__/` for worker                                            |

### Supabase client variants

1. **Browser** (`lib/supabase/client.ts`) — anon key, for client components
2. **Server** (`lib/supabase/server.ts`) — cookie-based auth, for RSC and Route Handlers
3. **Service** (`lib/supabase/admin.ts`) — service role key, bypasses RLS, for privileged server ops

### AI adapter factory (`worker/src/adapters/index.ts`)

`createAdapter(model)` returns the correct adapter based on `model.adapter_config.provider`:

- `metaso` → `MetasoAdapter` (specialized search API, POST to `/v1/search`)
- Default → `OpenAICompatAdapter` (generic OpenAI-compatible, POST to `/chat/completions`)
- All overridden by `MockAdapter` when `MOCK_MODE=true`

### Database

- **8 tables**: profiles, ai_models, search_strategies, patent_documents, search_jobs, search_tasks, reports, notifications
- **RLS enabled** on all tables; built-in models/strategies readable by all, user-owned data scoped by user_id
- **Migrations** in `supabase/migrations/` — must be idempotent (`IF NOT EXISTS`, `DROP IF EXISTS`, DO blocks)

### Types

- Frontend shared types: `lib/supabase/types.ts`
- Worker duplicates needed types independently (worker is CommonJS, frontend is ESM, no cross-import)

## Environment

- **OS**: Windows 11. Shell commands must work in PowerShell/CMD, not WSL/Unix only
- **Package manager**: npm (not pnpm or yarn)
- **Env vars** (copy `.env.local.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL`, `WORKER_URL`
- **Node**: check `package.json` engines; TypeScript 5+ in frontend, TypeScript 6 in worker

## Conventions

### External API integration

- Before modifying any AI model adapter (Kimi, GLM, MiniMax, Qwen, Metaso, etc.), consult official docs or ask user for API reference
- Never guess base URLs, auth headers, or request body formats — 2026 APIs may differ from training data
- Validate changes with the `test-*.js` scripts or actual HTTP requests, not just code review

### Database migrations

- All SQL must be idempotent: use `IF NOT EXISTS`, `DROP IF EXISTS`, DO blocks
- pg/pg-boss connections must configure `poolSize` and release on exit
- No irreversible data deletion in migrations without explicit user request + backup

### Build verification

- After source changes, run the full build and check actual `dist/` or `.next/` output
- On Windows, build tools may inject watermarks/CDN scripts/absolute paths — investigate anything not in source
- Preview with local server (`npx serve` or `npm start`), never `file://` protocol

### Error resilience

- External API call failures: retry max 2 times, then report + propose alternatives (Mock mode, smaller batch, skip model)
- Chinese character ByteString errors → switch to ASCII-safe communication, check encoding and account status
- Research solutions independently; escalate to user only when a decision is needed

### File operations

- Read before write; parallel edits for multi-file changes; verify with build
- Never commit `.env`, keys, or credentials

## Batch & Parallel Processing Rules

### 批量规模控制

- **>10 条数据**：分批执行，每批 5–10 条；批次间写入中间结果文件（`output_batch_N.json/xlsx`）
- **>100 条数据**：维护 `progress.json` 记录已完成 ID，脚本启动时自动跳过已处理项，支持中断续跑
- **>1000 条数据**：先跑 20 条验证全流程，确认无误后再启动全量；全量跑之前向用户确认

### 进度追踪

- 每批完成后打印：`已完成: 30/2177 (1.4%)`
- 每 30s 至少输出一次进度（防止看起来像卡死）
- 任务结束后汇总：成功数 / 失败数 / 失败原因分类

### API 调用容错

- 网络/限流错误：指数退避重试，max 3 次（1s → 2s → 4s）
- 记录失败项到 `failed.json`，含输入、错误信息、时间戳，供后续单独重试
- 单批超时 >5 分钟无输出 → 终止该批，记录原因，继续下一批

### 并行子任务

- 禁止空轮询等待；使用定时进度输出而非沉默等待
- 并行任务数不超过 6 个；超过则排队串行化
- 并行任务全部无结果返回时 → 立即终止，诊断根因，不要重试同样的逻辑

## Script Validation Rules

### 脚本编写

- 任何脚本写完后，先用 **1–3 条样本数据** 跑通验证，再全量执行
- pandas 操作前 `assert` 列名和索引存在；禁止用魔术数字索引访问 tuple
- docx/xlsx/PDF 解析：先在 1 个文件上 dry-run，确认提取文本非空、结构正确
- 输出文件后立即验证：文件存在、行数匹配、关键列非空

### API 调用

- 调用前确认三个参数与官方文档一致：
  1. **模型名**（一字不差，含后缀如 `[1m]`）
  2. **response_type**（`text` vs `thinking`，搞错会导致空返回）
  3. **max_tokens**（估算输出长度 × 2，不够会被截断）
- 遇到 ByteString/编码错误 → 切换到 ASCII-safe 模式，检查账号状态

### 错误处理

- 脚本报错后，**先诊断根因再修复**，不要直接重试同样的代码
- 同一错误出现 3 次 → 换一种完全不同的方案，不要死磕
- 批量任务中单个失败不应阻塞整体；记录并跳过，最后统一处理

## External Service Checklist

在依赖任何第三方服务之前，逐项确认：

1. **账号状态**：未被封禁/欠费/配额耗尽（登录后台确认，不要猜）
2. **模型可用**：发一条最小请求（如 "hello, reply 'ok'"）验证模型在线
3. **协议匹配**：OpenAI-compatible vs Anthropic-messages vs 自定义 POST——查文档，不假设
4. **注册/认证**：如需注册外部账号（如 EPO、AI 平台），先确认注册流程通畅再纳入计划
5. **阻塞时**：遇到注册审核/账号封禁等不可控阻塞，立即报告用户，不要反复尝试

## Model Selection Strategy

### 模型选择优先级

| 场景 | 推荐模型 | 原因 |
|------|---------|------|
| 批量分类（>100 条） | 便宜模型（Haiku / Qwen / GLM） | 降低成本，速度快 |
| 关键分析/报告生成 | 强模型（Opus / Fable / Kimi） | 准确性优先 |
| 长文本分析（>8K tokens） | 大 context 模型（Kimi / MiniMax-M3[1M]） | 避免截断 |
| 联网搜索 | Metaso / Kimi（常开联网） | Agentic search |

### Fallback 链

主模型不可用时，按以下顺序降级：

1. 同级别替代模型
2. 更便宜的模型 + 更详细的 prompt
3. Mock 模式（`MOCK_MODE=true`）验证流程逻辑

### 模型名验证

- 模型名必须与 provider 官方文档一字不差
- 不确定时先查文档或问用户，不要猜
- 遇到 404/模型不可用 → 立即切换 fallback，不要反复重试同一个不可用模型

## Chinese Character Encoding Rules（中文编码规范）

### 根源问题

Windows 中文版系统默认编码为 **GBK/GB2312（CodePage 936）**，中文 .txt 文件默认保存为 GBK。项目当前多处代码假设所有输入为 UTF-8，这是中文乱码的根源。

### 文件解析

- **.txt 文件**：**禁止** 直接 `buffer.toString('utf-8')`。必须先 `jschardet.detect()` 检测编码，高置信度非 UTF-8 结果用检测到的编码解码；否则 UTF-8 → GBK/GB2312/GB18030 逐级回退
- **.docx**：OpenXML 内部为 UTF-8，mammoth 解析安全
- **.xlsx**：内部 UTF-8，`sheet_to_csv` 无编码控制，验证输出中文
- **.pdf**：pdf-parse 对中文 PDF 的 CMap 映射可能失败，解析后验证中文字符占比 >70%

### API 通信

- 所有 `fetch` 调用 Header 必须写 `Content-Type: application/json; charset=utf-8`
- 错误响应 `response.text()` 可能返回 GBK 编码的网关错误页，读不到内容时尝试 GBK 解码

### 环境配置

- PowerShell Profile 已设置 `$OutputEncoding = UTF-8`（`Microsoft.PowerShell_profile.ps1`）
- Worker 启动脚本已加 `chcp 65001`（`worker/package.json → dev:utf8 / start:utf8`）
- Worker 入口 `index.ts` 已加强制 UTF-8 控制台代码页
- Node.js 内部 V8 使用 UTF-16，无额外配置需求

### 常见乱码模式

| 症状 | 根因 | 检查 |
|------|------|------|
| 中文变成 `????` | PowerShell OutputEncoding = ASCII | Profile 是否已加载 |
| 中文变成 `锟斤拷` | UTF-8 字节被当作 GBK 解码 | 检查解码路径 |
| 中文变成 `æ±‰å­—` | GBK 字节被当作 UTF-8 解码 | txt.ts 编码检测是否生效 |
| 替换字符 `�` 大量出现 | 编码不匹配且无 fallback | 检查 txt.ts 的 replaceCount 逻辑 |
