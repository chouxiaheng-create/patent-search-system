# 卡住任务自动恢复 + 失败任务重试 设计文档

> 日期：2026-06-26　　状态：已确认，实施中

## 1. 背景与根因

检索任务（search-job）提交后，偶发单条任务"卡住"，导致后续任务在 pg-boss 队列中排队而无法自动执行。

根因（结合代码）：

- 入队参数：`send_pgboss_job`（`supabase/migrations/20260531000001_send_pgboss_job_function.sql`）设 `expirein='15 minutes'`、`retrylimit=2`、`retrydelay=0`。
- 消费：`boss.work('search-job', { localConcurrency: 1 })`（`worker/src/index.ts:74`）——**并发=1，一条卡住堵死整条 search 队列**。
- handler 有 20min 全局超时（`worker/src/handlers/search-job.ts:29,83-85`），但两处漏洞：
  1. `expirein=15min < 全局超时 20min`：pg-boss 在 15min 判 expired 并重排，原 handler 仍在跑 → 重复执行 + 槽位被占到 20min。
  2. catch 块 `updateJob`/`sendNotification`（`search-job.ts:154-159`）无超时；DB 不可达时这些 await 永不返回 → handler 永不 settle → **pg-boss 无法强杀在跑的 JS Promise，槽位被永久占用**，只能重启 worker。
- 子任务层已有 `callWithRetry(maxRetries=3)`，但仅对限流(429)重试，非限流错误直接抛。

本质：**单并发 + 没有有界释放保证 + expirein 失配**。

> 关键约束：pg-boss 无法强杀在跑的 JS Promise。所以"卡住必能自动结束"的真正保证是 **handler 里每个外部 await 都有超时**，使 handler 一定能在有界时间内 settle；25min 硬超时兜底强制 throw；看门狗只负责 worker 整体失联后的 DB 状态清理。

## 2. Part 1：卡住任务自动结束（JOB 级重排 2 次 + 25min 硬超时）

### 2.1 参数

| 项 | 值 | 说明 |
|---|---|---|
| `MAX_JOB_RETRIES` | 2 | JOB 级应用层重排上限 |
| `RETRY_BACKOFF_MS` | 30000 | 重排 `startAfter = now+30s` |
| `HARD_TIMEOUT_MS` | 25 min | 单次尝试硬超时（原 20min） |
| `SEARCH_TASK_TIMEOUT_MS` | 10 min | 单次 AI 调用超时（不变） |
| `DB_CALL_TIMEOUT_MS` | 30 s | 收尾路径 DB/RPC await 超时 |
| 看门狗扫描间隔 | 60 s | `setInterval` |
| 看门狗阈值 | 30 min | `running 且 started_at < now-30min`（> 硬超时，专抓 worker 失联） |
| pg-boss `expirein` | 30 min | 抬高，消除过早 expire/重复执行 |
| pg-boss `retrylimit` | 0 | 关闭 pg-boss 自带重排，改由应用层重排，语义可控 |

### 2.2 handler 统一"跳过 done、只重跑非 done"

`createSearchTasks` 本身幂等（`worker/src/services/supabase.ts:106-135`：已有子任务则直接返回）。据此把 `handleSearchJob` 改为始终按子任务状态分流，**无需 flag**：

1. `getJob`→若 cancelled 返回；`updateJob status='running', started_at=now`
2. `getDocument`+parsedData
3. `createSearchTasks(...)`（幂等：首次创建 pending；重跑返回已有）
4. 分流：`doneTasks = status==='done'`；`toRun = status!=='done'`（pending/running/retrying/abandoned）→ 重置 `toRun` 为 `pending`（清 `error_msg`/`results`/`started_at`/`completed_at`）
5. 种子 `allResults`：从 `doneTasks.results` 展平，用 `getPlatformNames`/`getStrategyNames` 批量取名后打 `source_task_id`/`source_platform`/`source_strategy` 标签
6. 按模型分组 + `executeSingleTask` 跑 `toRun`，结果并入 `allResults`
7. 未取消 → `generateReport(jobId, …, allResults, config)` → `status='completed'` + 通知

同一套逻辑服务三种场景：首次运行（全跑）、自动重排（跳过已成功项）、手动部分重试（同 job 入队即重跑非 done）。

### 2.3 超时与有界释放

- 整个 execution 套 `Promise.race([execution, hardTimeout(25min)])`；`execution` 附加 `.catch(()=>{})` 吞掉被弃用后的迟到 rejection，避免 unhandledRejection 崩溃 worker。
- catch 路径调 `handleJobFailure(jobId, reason)`，其内部所有 DB/RPC await 套 `withTimeout(…, 30s)`，保证收尾不会自己挂住。

### 2.4 失败处理（两条独立路径）

- `handleJobFailure(jobId, reason)`（handler catch 调用，带重排）：
  - 读 job 的 `retry_count/status/user_id`；
  - 若 `retry_count < MAX_JOB_RETRIES` 且 `status ∈ {running, failed}`：原子更新 `retry_count+1, status='queued', started_at=null, completed_at=null`（带 `eq('retry_count', 旧值)` 乐观锁）→ 通过 `send_pgboss_job` RPC 重排（`startAfter=now+30s`）→ 通知"将重试"。
  - 否则调 `markJobFailed`。
- `markJobFailed(jobId, reason, userId)`（handler 与看门狗共用，不重排）：`update status='failed', completed_at=now`（条件 `eq('status','running')`，不覆盖已终态）+ 通知。

> handler 同一 job 单并发，`handleJobFailure` 不会被并发调用；看门狗只调 `markJobFailed`，不做重排（用户要求）。

### 2.5 看门狗

`worker/src/index.ts` 起 `setInterval(60s)`：扫 `search_jobs` 中 `status='running' AND started_at < now-30min`，逐个调 `markJobFailed(jobId, 'worker 失联')`。pg-boss 侧 active 过期由其自身 `expirein=30min, retrylimit=0` 处理为终态。

> 看门狗在 worker 进程内运行；若 worker 整体死亡，需依赖进程管理器重启（本设计范围外）。withTimeout 保证活 worker 不会因 DB 挂起而卡死。

## 3. Part 2：失败任务重试按钮（独立按钮，多选择）

### 3.1 按钮矩阵

| 按钮 | 显示条件 | 动作 |
|---|---|---|
| 取消任务（已有） | `queued`/`running` | 置 `cancelled`，handler 取消检查停下 |
| 重试（全部，新 job） | `failed`/`cancelled` | 新建 job 复制 `document_id`+`config`，`retried_from_job_id` 关联，入队 |
| 重试失败子任务（部分） | `completed`/`failed` 且存在 `abandoned` 子任务 | 同 job：置 `queued`、`retry_count=0`、清 `started_at`/`completed_at`，入队（handler 自动只重跑非 done） |

`failed` 且有 abandoned 子任务时，"重试(全部)"与"重试失败子任务"同时出现，给用户多一个选择。`cancelled` 不给部分重试（用户已主动停，要跑用"重试全部"开新 job）。

### 3.2 报告重生成

`generateReport` 插入前 `delete from reports where job_id=?`（清旧报告，避免孤儿行；首次运行删 0 行无副作用）。报告页早已兼容"同 job 多 report、取最新"（`app/(app)/search/[jobId]/report/page.tsx:46-53`）。

### 3.3 端点

- `POST /api/jobs/retry`（全量）：鉴权 → 校验归属 + `status ∈ {failed, cancelled}` + 文档 `parse_status='done'` → 复制 `document_id`+`config` 插入新行（`status='queued'`, `retried_from_job_id`）→ `sendBossJob('search-job', {jobId:新id})`。
- `POST /api/jobs/[jobId]/retry-tasks`（部分）：鉴权 → 校验归属 + `status ∈ {completed, failed}` + 存在 `abandoned` 子任务 → `update status='queued', retry_count=0, started_at=null, completed_at=null` → `sendBossJob('search-job', {jobId})`。

## 4. 数据模型变更（`supabase/migrations/20260626_stuck_job_recovery.sql`）

- `ALTER TABLE search_jobs ADD COLUMN retry_count int NOT NULL DEFAULT 0;`
- `ALTER TABLE search_jobs ADD COLUMN retried_from_job_id uuid REFERENCES search_jobs(id) ON DELETE SET NULL;`
- `CREATE OR REPLACE FUNCTION send_pgboss_job(...)`：`expirein→'30 minutes'`, `retrylimit→0`（其余不变）。

## 5. 落点清单

- `supabase/migrations/20260626_stuck_job_recovery.sql`：见 §4
- `worker/src/utils/retry.ts`：加 `withTimeout`
- `worker/src/services/job-retry.ts`（新）：`handleJobFailure` + `markJobFailed`
- `worker/src/handlers/search-job.ts`：§2.2 重构 + 25min 硬超时 + catch→`handleJobFailure`
- `worker/src/services/report.ts`：`generateReport` 加 delete-old
- `worker/src/services/supabase.ts`：加 `getStuckRunningJobs`、`resetNonDoneTasks`、`seedResultsFromDoneTasks` 等辅助（或内联）
- `worker/src/index.ts`：看门狗 `setInterval`
- `app/api/jobs/retry/route.ts`（新）、`app/api/jobs/[jobId]/retry-tasks/route.ts`（新）
- `components/retry-job-button.tsx`、`components/retry-failed-tasks-button.tsx`（新）；`components/dashboard-job-card.tsx` 按矩阵挂载
- `lib/supabase/types.ts`：`SearchJob` 加 `retry_count`、`retried_from_job_id`

## 6. 测试

- worker `tsc` 编译通过；Next `lint`/`build` 通过。
- 现有 vitest 测试通过。
- 手工推演：硬超时触发→重排 2 次→failed；部分重试只跑非 done；全量重试新 job；看门狗 30min 清理。
