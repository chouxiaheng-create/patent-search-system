# Oracle 第二模型交叉验证材料包

> 用途：将本文件内容复制到支持文件附件的 LLM（如 ChatGPT / GPT-5 Pro）中，对主审查结论做独立复核。
> 生成日期：2026-08-03 | 项目：专利检索系统（Next.js + Supabase + pg-boss Worker）

---

## 使用方式（二选一）

1. **完整复核**：将本文件拖入 ChatGPT，附言"请按第七节 Prompt 审查以下代码清单中的文件，输出问题清单并与我的发现对比"。
2. **代码核对**：将第七节 Prompt + 文件清单原样粘贴，再从本仓库对应路径提取代码附上。

---

## 需要复核的关键文件

```
lib/api/handler.ts              lib/api/cache.ts               lib/boss-client.ts
lib/supabase/admin.ts           middleware.ts                  app/api/admin/require-admin.ts
app/api/jobs/route.ts           app/api/jobs/retry/route.ts    app/api/jobs/[jobId]/retry-tasks/route.ts
app/api/documents/route.ts      app/api/documents/[documentId]/route.ts
app/api/documents/[documentId]/reparse/route.ts
app/api/models/route.ts         app/api/models/[modelId]/route.ts
app/api/preferences/route.ts    app/api/queue-status/route.ts
app/api/reports/[reportId]/documents/[docIndex]/route.ts
worker/src/handlers/search-job.ts   worker/src/handlers/parse-job.ts
worker/src/services/job-retry.ts    worker/src/services/report.ts
worker/src/services/supabase.ts     worker/src/services/enrichment.ts
worker/src/utils/retry.ts           worker/src/parsers/xlsx.ts
components/report/report-preview.tsx
supabase/migrations/20260626_stuck_job_recovery.sql
```

---

## 交叉验证 Prompt（英文，供直接粘贴）

```
You are reviewing a Next.js patent search system (Next.js App Router + Supabase + pg-boss worker).
Perform an INDEPENDENT code review of the attached source files. Do NOT trust the issue list below — verify each and add anything missed.

Focus areas:
1. Concurrency races: job retry (handleJobFailure requeue vs markJobFailed), hard-timeout Promise.race leaving execution running, watchdog (30min) vs handler, cache stampede in withCache, createSearchTasks idempotency race.
2. Unhandled exceptions / null derefs / unsafe non-null assertions.
3. Resource leaks: unbounded in-memory Map cache, no file size limits (upload + downloadFile + xlsx.read zip bomb), missing hard timeout in parse-job.
4. Authorization: service_role client usage in non-admin API routes (IDOR risk), builtin model API key update by ANY logged-in user (models/[modelId] PUT), middleware session cache keyed by slice(-40) of cookie.
5. Input validation: fileUrl/fileName/fileType/config/scheduledAt/user_rating unvalidated; request.json() without try-catch.
6. XSS: buildHtmlReport inserts pathSummary.errorMsg / platform / strategy unescaped; rendered via iframe srcDoc with sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox".
7. SSRF: enrichment fetchPageMeta with redirect:'follow' + isPrivateUrl hostname-string bypass (integer/hex IP), user-supplied model api_base_url fetched by worker.
8. State inconsistency: job left 'queued' without queue entry after re-enqueue RPC failure; document stuck 'pending' after reparse enqueue failure; reports delete-then-insert non-transactional; deduplicateResults double-counting same result under urlKey+titleKey.
9. SQL/DB: send_pgboss_job SECURITY DEFINER without REVOKE PUBLIC EXECUTE.

Output: a prioritized table of confirmed issues — ID, severity (Critical/High/Medium/Low), file:line, risk type, one-line fix. Mark any of my suspected issues you think are FALSE POSITIVES with justification. Then list any NEW issues I missed.
```

---

## 主审查已发现的疑似问题（供对比，勿直接采信）

| # | 疑似问题 | 级别 |
|---|---------|------|
| 1 | models/[modelId] PUT：内置模型(owner_id=null) 任何登录用户可覆盖 API Key | Critical |
| 2 | api_key_encrypted 字段明文存 Key | Critical |
| 3 | service_role client 在 12+ 个非 admin 路由使用，隔离依赖手写 user_id 条件 | Critical |
| 4 | report.ts buildHtmlReport：errorMsg/platform/strategy 未转义 → 存储型 XSS | Critical |
| 5 | job-retry.ts：重排 RPC 失败后 markJobFailed(.eq status='running') 不命中 → queued 僵尸任务 | High |
| 6 | search-job.ts：硬超时后 execution 继续执行，与 handleJobFailure 双写竞争 | High |
| 7 | 看门狗 30min 阈值 vs handler 25min 硬超时 → 状态竞争 | High |
| 8 | enrichment fetchPageMeta：redirect follow + IP 表示法绕过 → SSRF | High |
| 9 | models POST：api_base_url 未校验协议/主机 → SSRF | High |
| 10 | reparse：先置 pending 再入队无回滚 → 永久 pending | High |
| 11 | 上传/下载/解析无大小限制 → DoS | High |
| 12 | parse-job 无硬超时 | High |
| 13 | withCache 无 in-flight 去重（缓存击穿）+ 无界 Map | Medium |
| 14 | withTimeout 超时后原 Promise 仍执行 → 双重写 | Medium |
| 15 | middleware 缓存键 slice(-40) 非哈希 + 登出 60s 内放行 | Medium |
| 16 | retry-tasks：入队失败无回滚 + 无并发防重复入队 | Medium |
| 17 | deduplicateResults 同一结果占 urlKey+titleKey → 重复输出 | Medium |
| 18 | reports delete+insert 非事务 | Medium |
| 19 | handler.ts 500 响应泄露 detail/path | Medium |
| 20 | send_pgboss_job SECURITY DEFINER 未 REVOKE PUBLIC | Medium |
| 21 | createSearchTasks 先查后插无唯一约束 | Medium |
| 22 | config 无 schema 校验（负数 limit） | Medium |
