# Plan 5: 进度看板 — 设计文档

**日期：** 2026-04-16
**版本：** 1.0
**状态：** 待确认

---

## 1. 概述

实现 `/search/[jobId]/progress` 页面，使用 React Flow 展示任务节点流程图，支持 Supabase Realtime 实时更新节点状态。

---

## 2. 架构设计

### 2.1 整体布局

```
/search/[jobId]/progress
├── React Flow 画布（水平流程图）
│   ├── 文献解析节点（Source）
│   ├── M×N 子任务节点（中间层，按平台分组）
│   └── 报告生成节点（Target）
├── 侧边面板
│   ├── 任务状态摘要
│   └── 取消任务按钮
└── 底部：队列位置信息（仅排队时显示）
```

### 2.2 数据源

| 数据 | 来源表 | 用途 |
|------|--------|------|
| 任务主状态 | `search_jobs` | job status, started_at, completed_at |
| 子任务详情 | `search_tasks` | 每个节点的完成状态和结果 |
| 文档信息 | `patent_documents` | 文献解析节点标题 |

### 2.3 实时更新

通过 Supabase Realtime 订阅 `search_jobs` 和 `search_tasks` 表变更，驱动节点状态更新。

---

## 3. 节点设计

### 3.1 节点状态颜色

| 状态 | 颜色 | 样式 |
|------|------|------|
| pending | 灰色 (#94a3b8) | 静态 |
| running | 蓝色 (#3b82f6) | 脉冲动画 |
| retrying | 橙色 (#f59e0b) | 脉冲动画 |
| done | 绿色 (#22c55e) | 静态 |
| abandoned | 红色 (#ef4444) | 静态 |
| cancelled | 灰色 (#94a3b8) | 带删除线 |

### 3.2 文献解析节点

- **ID:** `parse`
- **位置:** 水平第 1 列
- **显示内容:**
  - 图标: 📄
  - 标题: "文献解析"
  - 副标题: 文档标题
  - 进度: 根据 job 关联的 document 解析状态显示

### 3.3 子任务节点

- **ID 格式:** `task-{modelId}-{strategyId}`
- **位置:** 水平第 2-3 列（按平台分组）
- **显示内容:**
  - 图标: 🔍
  - 标题: `{平台} × {策略}`
  - 副标题: 状态描述
  - 结果数: "找到 X 篇文献"（done 时）

### 3.4 报告生成节点

- **ID:** `report`
- **位置:** 水平最后一列
- **显示内容:**
  - 图标: 📊
  - 标题: "生成报告"
  - 状态: 根据 job.completed_at 判断

### 3.5 排队占位节点

当 `job.status = 'queued'` 时显示单个占位节点：

```
┌─────────────────────────────┐
│  ⏳ 等待队列中              │
│                             │
│  当前第 3 位                │
│  预计等待约 8 分钟          │
└─────────────────────────────┘
```

---

## 4. 布局算法

### 4.1 水平流程图

```
[文献解析] ──→ [子任务节点网格] ──→ [报告生成]
   (col 0)       (col 1-2)           (col 3)
```

### 4.2 子任务网格布局

- 按平台分组，每组一列
- 列内按策略排列行
- 节点间距: 水平 150px，垂直 80px

### 4.3 边（Edges）

```typescript
// 文献解析 → 每个子任务
edges = subTasks.map(task => ({
  id: `parse-to-${task.id}`,
  source: 'parse',
  target: task.id,
  animated: task.status === 'running'
}))

// 所有子任务 → 报告生成
edges = subTasks.map(task => ({
  id: `${task.id}-to-report`,
  source: task.id,
  target: 'report',
  animated: task.status === 'running'
}))
```

---

## 5. 组件结构

```
app/(app)/search/[jobId]/
└── progress/
    └── page.tsx              # 主页面（Client Component）

components/flow/
├── job-progress.tsx          # React Flow 主组件
├── nodes/
│   ├── index.ts             # 统一导出
│   ├── parse-node.tsx       # 文献解析节点
│   ├── search-task-node.tsx # 子任务节点
│   ├── report-node.tsx      # 报告节点
│   └── placeholder-node.tsx # 排队占位节点
├── job-sidebar.tsx           # 侧边栏
└── queue-banner.tsx        # 排队横幅
```

---

## 6. 取消任务

### 6.1 实现方式

直接更新数据库，无需额外 API：

```typescript
const { error } = await supabase
  .from('search_jobs')
  .update({ status: 'cancelled' })
  .eq('id', jobId)
  .eq('user_id', userId) // 权限校验
```

### 6.2 Worker 端检测

Worker 在执行过程中每 5 秒轮询一次 `job.status`，检测到 `cancelled` 后中止当前任务。

---

## 7. 排队位置计算

前端实时计算排队位置：

```sql
SELECT COUNT(*) + 1
FROM search_jobs
WHERE status = 'queued'
AND created_at < (SELECT created_at FROM search_jobs WHERE id = $jobId)
```

预计等待时间 = 排队位置 × 平均任务时长（约 5 分钟）

---

## 8. 依赖清单

```json
{
  "dependencies": {
    "@xyflow/react": "^12.0.0",
    "@xyflow/node-toolbar": "^12.0.0"
  }
}
```

---

## 9. 后续迭代

以下功能不在本 Plan 范围内：

- 报告导出（Word/Excel/Markdown）
- 管理后台
- 邮件通知
