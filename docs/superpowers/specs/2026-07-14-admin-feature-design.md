# 管理员功能补齐 - 设计文档

**日期**：2026-07-14
**范围**：M1 + 数据查看
**方案**：A（RLS 旁路 + API 业务校验）

## 1. 目标

补齐项目中已有的"半成品"管理员权限：DB 层和侧边栏入口已就绪，但缺少：
- 用户列表页面
- 用户详情页面
- 角色切换 API
- 审计日志

## 2. 用户行为流

管理员账号登录后，左侧栏出现"管理后台"入口。点击进入 `/admin/users`：

```
[搜索框] [总数徽章]
┌─────────────────────────────────────────┐
│ 邮箱        │ 角色 │ 注册时间 │ 文件/任务/报告 │ 操作 │
├─────────────────────────────────────────┤
│ alice@..    │ 👤   │ ...      │ 12 / 5 / 3     │ ... │
│ bob@..      │ 🛡   │ ...      │ 1 / 0 / 0      │ ... │
└─────────────────────────────────────────┘
                          [< 1 2 3 >]
```

点击某行的角色徽章 → 弹出对话框 → 输入"我确认" → PATCH → 提示成功/失败。

## 3. 数据模型

### 新表 `admin_audit_log`

| 字段 | 类型 | 说明 |
|---|---|---|
| id | bigserial PK | |
| admin_id | uuid → profiles.id | 操作者；nullable on delete |
| action | text | `promote` \| `demote` \| `view_user` |
| target_user | uuid → profiles.id | 被操作/查看用户 |
| detail | jsonb | 默认 `{}` |
| created_at | timestamptz | default now() |

索引：`admin_id` / `target_user` / `created_at DESC`

RLS：
- `FOR SELECT USING (is_admin())` — 仅 admin 能看
- `FOR INSERT WITH CHECK (auth.uid() IS NOT NULL)` — 已登录用户可写（限制 admin 操作产生记录）

### 不变更的表
- `profiles` 不新增列（不引入 `disabled` / `deleted_at`）
- 现有 `role` 字段满足需求

## 4. API 契约

### `GET /api/admin/users?search=&page=&pageSize=`

请求参数：
- `search` (string, optional) — 邮箱模糊匹配
- `page` (number, default 1)
- `pageSize` (number, default 20, max 100)

响应 200：
```json
{
  "users": [
    {
      "id": "uuid",
      "email": "...",
      "role": "admin" | "user",
      "created_at": "ISO",
      "stats": {
        "documents": 12,
        "jobs": 5,
        "reports": 3
      }
    }
  ],
  "total": 42,
  "page": 1,
  "pageSize": 20
}
```

实现：
- 单条 SQL：`profiles LEFT JOIN (SELECT user_id, count(*) FROM patent_documents GROUP BY 1) ...`
- `profiles.email` 加 `pg_trgm` 索引提速搜索
- 索引：`profiles(created_at DESC)`

错误：401 未登录 / 403 非 admin

### `GET /api/admin/users/[id]`

响应 200：
```json
{
  "profile": { "id", "email", "role", "created_at" },
  "documents": [{ "id", "filename", "status", "created_at" }, ...],
  "jobs": [{ "id", "title", "status", "created_at" }, ...],
  "reports": [{ "id", "job_id", "created_at" }, ...]
}
```

**不含** `parsed_data`、`report_html`、`task_messages`。

实现：`Promise.all([profile, documents, jobs, reports])` 三栏并行。

### `PATCH /api/admin/users/[id]`

请求 body：
```json
{
  "role": "admin" | "user",
  "confirmText": "我确认"
}
```

业务规则：
1. `requireAdmin()` 通过
2. 防锁死：`SELECT count(*) FROM profiles WHERE role='admin'` —— 若 ==1 且目标用户是 admin 且新 role = 'user' → 409
3. `confirmText === "我确认"` —— 否则 400
4. UPDATE → 写 audit_log（action=`promote`/`demote`）

响应 200：`{ "user": { id, role } }`

错误：
- 400 字段缺失 / `confirmText` 不匹配
- 401 未登录 / 403 非 admin
- 404 用户不存在
- 409 防锁死触发
- 500 DB 失败

### `requireAdmin()` helper

位置：`app/api/admin/require-admin.ts`

行为：
1. 通过 `createClient()`（server）获取 session
2. 查 `profiles.role WHERE id = auth.uid()`
3. role !== 'admin' → 抛 `ApiError(403, 'Admin only')`
4. 返回 `{ userId, supabase, adminClient }`

可选优化：把 `profile.role` 加到 server session cache（避免每个请求都查）—— **此处不引入**，是单点优化，YAGNI

## 5. UI 页面

### `/admin/users`

- RSC：服务端预拉第一页（避免额外 API）
- 客户端组件接管：搜索、分页、内联角色切换
- 用 shadcn 的 `Dialog` `Input` `Table` `Badge`（项目已用）

### `/admin/users/[id]`

- RSC：服务端并行拉 profile / documents / jobs / reports
- 点击行 → 跳到现有路由（如 `/search/[jobId]/report`）
- 含"切换角色"按钮，重复用对话框组件

### 共用组件：`RoleSwitchDialog`

`components/admin/role-switch-dialog.tsx`

props：`userId`, `currentRole`, `onSuccess`
内部：Dialog + Input + Button + 调 PATCH

## 6. 错误处理矩阵

| 场景 | 表现 |
|---|---|
| 未登录访问 | 重定向 `/login` |
| 普通用户访问 `/admin/*` | 403 页 |
| 非 admin 调 API | 403 JSON |
| 试图降级唯一 admin | 409 + "系统至少需要 1 个管理员" |
| 确认文本打错 | 400 + inline 提示 |
| audit_log 写入失败 | 不影响主操作，console.error |
| 搜索无结果 | 列表空态"未找到用户" |

## 7. 测试

### Vitest（项目已有框架）

| 文件 | 覆盖 |
|---|---|
| `__tests__/api/admin-require.test.ts` | requireAdmin 三场景 |
| `__tests__/api/admin-users-list.test.ts` | 搜索 / 分页 / 含 stats |
| `__tests__/api/admin-users-detail.test.ts` | 元数据完整、不含解析原文 |
| `__tests__/api/admin-users-patch.test.ts` | 成功 / 防锁死 / 错误 confirmText / audit_log |

### 手动 smoke test

1. 普通账号登录 → 看不到侧栏"管理后台"
2. SQL 升级为 admin → 重登 → 看到入口
3. 进列表 → 搜索自己邮箱
4. 试着降级唯一 admin → 409
5. 切换 user→admin → 成功 + audit_log +1
6. 详情页三栏加载、不见原文
7. 关掉再打开，数据持久

## 8. 交付清单

| 文件 | 路径 |
|---|---|
| 迁移 | `supabase/migrations/20260714000001_admin_features.sql` |
| Helper | `app/api/admin/require-admin.ts` |
| API:列表 | `app/api/admin/users/route.ts` |
| API:详情 | `app/api/admin/users/[id]/route.ts` |
| API:详情+PATCH | `app/api/admin/users/[id]/route.ts`（同文件，导出 GET 和 PATCH —— 符合项目既有 patterns） |
| 列表页 | `app/(app)/admin/users/page.tsx` |
| 详情页 | `app/(app)/admin/users/[id]/page.tsx` |
| 对话框 | `components/admin/role-switch-dialog.tsx` |
| 测试 × 4 | `__tests__/api/admin-*.test.ts` |

共 10 个文件，零依赖增加。

## 9. YAGNI 清单（明确不做）

- ❌ 不做"最后登录时间"字段（需新表/记录，不在 M1）
- ❌ 不做"模拟登录某用户"（impersonation）
- ❌ 不做批量操作
- ❌ 不做密码重置 / 注册审批 / 用户禁用
- ❌ 不做管理员仪表盘首页
- ❌ 不做 RPC 函数（保留 SQL 直查透明性）
- ❌ 不做 E2E 测试（项目无此基础设施）
- ❌ 不引入新依赖 / 新抽象层

## 10. 性能策略

- 单条聚合 SQL 拉用户列表（避免 N+1）
- `pg_trgm` 索引加速邮箱搜索
- 详情页三栏 `Promise.all` 并行
- 前端分页（不一次拉全表）
- 角色切换对话框：表单本地 state，不重渲染整张表（更新后做精准 row update）

## 11. 风险与缓解

| 风险 | 缓解 |
|---|---|
| 防锁死逻辑被绕开 | helper `requireAdmin()` 调用 `countAdmins()` 自检；不引入 DB trigger / function（避免新概念） |
| audit_log 写入失败掩盖主操作 | try/catch 包裹，主操作先 commit |
| 现有 RLS 漏洞 | helper 先查 role（不直接依赖 RLS 单点防御） |
| 用户名敏感信息泄露 | 列表仅返回 admin 自己需要的字段；其他用户看不到 |
