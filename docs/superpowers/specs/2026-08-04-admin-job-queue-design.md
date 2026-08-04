# 管理后台任务队列页 — 设计文档

日期：2026-08-04
状态：已批准（用户已确认"查看+取消+重跑"方案）
分支：feat/admin-job-queue

## 背景与问题

管理员无法查看系统全部检索任务的执行状态。当任务卡住（如 worker 失联、API 挂起、数据库迁移缺失导致任务批量失败）时，管理员没有干预手段：

- 现有取消/重跑 API 均带 `user_id` 归属校验，仅本人可操作
- 管理后台仅有 用户/报告/导出 三个板块，无任务队列视图
- 管理员只能直接改数据库或等待用户自行处理

## 目标

在不新增角色、不新增表的前提下，让现有 `admin` 角色获得三项能力：

1. **查看**：全量检索任务队列（含子任务进度、所属用户、文档标题）
2. **取消**：任意用户卡住的任务（queued/running → cancelled）
3. **重跑**：任意用户失败/已完成的任务重新入队执行

## 非目标（YAGNI）

- 不新增"超级管理员"角色（现有 admin 即最高权限）
- 不改造解析任务（parse-job）队列（文档已有单独 reparse API）
- 不做自动看门狗增强（现有 worker 看门狗已覆盖 running 超阈值场景；本功能为手动干预）
- 不新增数据库表、不修改现有表结构

## 架构

```
app/(app)/admin/jobs/page.tsx        ← RSC 页面骨架 + Client 表格组件
components/admin/jobs-table.tsx      ← 客户端表格：筛选、刷新、操作按钮
app/api/admin/jobs/route.ts          ← GET 列表（联表+聚合）
app/api/admin/jobs/[jobId]/cancel/route.ts  ← POST 取消
app/api/admin/jobs/[jobId]/retry/route.ts   ← POST 重跑
supabase/migrations/20260804_admin_cancel_pgboss_job.sql  ← admin RPC（新迁移）
```

所有 API 路由入口走 `requireAdmin()`（`app/api/admin/require-admin.ts`）。

## 详细设计

### 1. GET /api/admin/jobs

查询（service-role client）：

```ts
admin.from('search_jobs').select(`
  id, status, retry_count, created_at, started_at, completed_at, scheduled_at,
  user_id,
  profiles!inner ( email ),
  patent_documents!inner ( title ),
  search_tasks ( id, status )
`)
```

- 支持 query 参数：`status`（单值筛选）、`email`（ilike 搜索）、`limit`（默认 50，上限 100）
- 排序：`created_at desc`
- 返回结构：每任务含 `task_counts: { total, done, running, pending, failed, abandoned }`、`progress_percent`、`document_title`、`user_email`
- 分页：首版仅 `limit + offset`，不做复杂游标

### 2. POST /api/admin/jobs/[jobId]/cancel

流程：
1. `requireAdmin()` 鉴权
2. 读任务当前状态（service-role，不限制 user_id）
3. 终态（completed/failed/cancelled）→ 400「任务已结束，无法取消」
4. 原子迁移：`update({ status: 'cancelled', completed_at: now }).eq('id', jobId).in('status', ['queued','running'])`
   - 未命中 → 409（状态已变化，防并发）
5. 调 `admin_cancel_pgboss_job` RPC 清理 pg-boss 队列中 created/retry 状态的残留 job
   - RPC 失败不阻塞（worker 消费到 cancelled 任务会直接跳过）
6. 返回 `{ ok: true }`

运行中任务的停止：worker 已有 5s 轮询取消机制（`search-job.ts:46-58`），置 cancelled 后在批次边界退出，无需改动。

### 3. POST /api/admin/jobs/[jobId]/retry

适用状态：
- `failed` → 全量重跑（含 0 子任务场景，handler 会自动创建）
- `completed` → 部分重试（handler 跳过 done 子任务）

流程：
1. `requireAdmin()` 鉴权
2. 读任务状态，非 failed/completed → 400
3. 乐观锁原子更新：`update({ status: 'queued', retry_count: 0, started_at: null, completed_at: null }).eq('id', jobId).eq('status', job.status)`，未命中 → 409
4. `sendBossJob('search-job', { jobId })` 入队
5. 入队失败 → 回滚原状态（M6 模式）→ 500

### 4. 新迁移：admin_cancel_pgboss_job

```sql
CREATE OR REPLACE FUNCTION public.admin_cancel_pgboss_job(p_job_name text, p_job_data jsonb)
RETURNS void AS $$
BEGIN
  -- 仅 admin 可调用（函数内校验，不依赖调用方身份）
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
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

幂等：`CREATE OR REPLACE`，可重复执行。

### 5. 页面 app/(app)/admin/jobs/

- `page.tsx`（RSC）：`requireAdmin()` 服务端校验（沿用 admin 其他页模式），渲染 `<JobsTable />`
- `components/admin/jobs-table.tsx`（Client）：
  - 状态筛选下拉：全部 / queued / running / completed / failed / cancelled
  - 邮箱搜索框
  - 表格列：任务 ID（前 8 位）、用户邮箱、文档标题、状态徽章、进度条（done/total）、创建时间、操作
  - 操作按钮：queued/running →「取消」；failed/completed →「重跑」；completed →「查看报告」链接
  - 取消/重跑均弹确认对话框（`AlertDialog`，shadcn 已有组件）
  - 30s 自动刷新 + 手动刷新按钮
- 侧边栏：`components/sidebar.tsx` 管理后台分组下新增「任务队列」→ `/admin/jobs`
- 状态徽章样式复用 `app/(app)/search/[jobId]/review/page.tsx` 的 status 映射

### 6. 错误处理

| 场景 | 行为 |
|------|------|
| 非 admin 调用 | 403（requireAdmin） |
| 取消已终态任务 | 400「任务已结束，无法取消」 |
| 并发竞争（状态已变） | 409，前端提示刷新后重试 |
| 重跑入队失败 | 回滚原状态 + 500 |
| pg-boss 清理 RPC 失败 | 忽略（worker 会跳过 cancelled 任务） |
| 列表查询 RPC 失败 | 500 + 错误信息 |

## 测试

1. **API 单测**（`__tests__/api/admin-jobs.test.ts`，mock supabase client，沿用 jobs-retry-tasks.test.ts 模式）：
   - GET：非 admin 403；正常返回聚合结构；status/email 筛选透传
   - cancel：非 admin 403；终态 400；原子迁移成功 200；乐观锁未命中 409
   - retry：非 admin 403；非 failed/completed 400；入队成功 200；入队失败回滚 500
2. **前端 smoke**：页面渲染、状态筛选、确认对话框交互（沿用现有组件测试模式）

## 部署注意

- 新迁移 `20260804_admin_cancel_pgboss_job.sql` 需应用到远程数据库（吸取 M12 教训：迁移入库前先确认已执行）
- `npm test` + `npm run build` 全量验证

## 关联文件

- 新增：见"架构"节
- 修改：`components/sidebar.tsx`（导航）、`lib/boss-client.ts`（如 sendBossJob 签名已满足则不改）
- 复用：`requireAdmin()`、`sendBossJob`、M6 回滚模式、worker 取消轮询、handler 幂等重跑逻辑
