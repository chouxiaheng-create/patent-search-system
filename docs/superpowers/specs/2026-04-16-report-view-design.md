# Plan 6: 报告查看页面 — 设计文档

**日期：** 2026-04-16
**版本：** 1.0
**状态：** 待确认

---

## 1. 概述

实现 `/search/[jobId]/report` 页面，展示 Worker 生成的专利检索报告 HTML，支持文献评分、文献备注、排序筛选、Markdown/Word 导出。

---

## 2. 页面布局

```
┌─────────────────────────────────────────────────────────┐
│  [← 返回] 报告标题                        [导出 Markdown▾] │
├──────────────────────┬──────────────────────────────────┤
│                      │                                  │
│  检索摘要信息         │                                  │
│  ─────────────       │     HTML 报告预览区               │
│                      │     (iframe 渲染)                 │
│  文献列表             │                                  │
│  ┌──────────────┐   │                                  │
│  │ 文献卡片1     │   │                                  │
│  │ [👍] [👎] [📝] │   │                                  │
│  └──────────────┘   │                                  │
│  ┌──────────────┐   │                                  │
│  │ 文献卡片2     │   │                                  │
│  └──────────────┘   │                                  │
│                      │                                  │
│  [筛选: 全部▾]       │                                  │
│  [排序: 排名▾]       │                                  │
└──────────────────────┴──────────────────────────────────┘
```

- 左侧面板宽度：360px（可调整）
- 右侧预览区：flex-1，iframe 自适应高度
- 移动端：左侧面板占满，右侧隐藏，可切换

---

## 3. 数据结构

### 3.1 数据库变更

在 `reports` 表的 `selected_docs` 中新增 `user_note` 字段：

```sql
ALTER TABLE reports
ALTER COLUMN selected_docs TYPE jsonb;
```

`selected_docs` 结构：

```typescript
interface ReportDocument {
  rank: number
  title: string
  authors: string
  url: string
  pub_date: string
  relevance_desc: string
  citation_gb: string
  source_platform: string
  source_strategy: string
  source_task_id: string
  user_rating: 'useful' | 'irrelevant' | null
  user_note: string  // 新增
}
```

### 3.2 API 端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reports/[reportId]` | 获取报告详情 |
| PATCH | `/api/reports/[reportId]/documents/[docIndex]` | 更新文献评分/备注 |
| GET | `/api/reports/[reportId]/export?format=markdown` | 导出 Markdown |
| GET | `/api/reports/[reportId]/export?format=docx` | 导出 Word |

---

## 4. 组件设计

### 4.1 ReportPage (`page.tsx`)

- Server Component（或带 auth check 的 Client Component）
- 从 URL 获取 `jobId`
- 调用 Supabase 获取报告数据
- 传递给 `ReportView` 组件

### 4.2 ReportView (`report-view.tsx`)

主容器组件，管理状态：
- `selectedDocIndex`: 当前选中的文献
- `filter`: 筛选条件（'all' | 'useful' | 'irrelevant'）
- `sortBy`: 排序方式（'rank' | 'platform' | 'rating'）

### 4.3 DocumentList (`document-list.tsx`)

文献列表组件：
- Props: `documents`, `selectedIndex`, `onSelect`, `filter`, `sortBy`, `onFilterChange`, `onSortChange`
- 接收处理后的文档列表
- 渲染 `DocumentCard` 列表

### 4.4 DocumentCard (`document-card.tsx`)

单篇文献卡片：
- Props: `doc`, `index`, `onRate`, `onNoteSave`
- 显示：排名、标题、来源标签、作者、日期
- 操作：👍/👎 评分按钮、备注展开/收起
- 评分点击后立即调用 API 保存
- 备注失焦或按 Enter 保存

状态样式：
- 有用（useful）：绿色左边框
- 不相关（irrelevant）：红色左边框
- 默认：无边框

### 4.5 ReportPreview (`report-preview.tsx`)

HTML 报告预览：
- Props: `htmlContent`, `title`
- 使用 `iframe` 或 `dangerouslySetInnerHTML` 渲染
- 加载完成后自适应高度

### 4.6 ExportMenu (`export-menu.tsx`)

导出下拉菜单：
- Props: `reportId`, `onExport`
- 按钮组：Markdown / Word
- 点击后调用对应 API 端点，下载文件

---

## 5. API 设计

### 5.1 获取报告

```
GET /api/reports/[reportId]
```

Response:
```json
{
  "id": "uuid",
  "job_id": "uuid",
  "html_content": "<html>...",
  "selected_docs": [...],
  "doc_count": 10,
  "created_at": "2026-04-16T00:00:00Z",
  "document": {
    "id": "uuid",
    "title": "专利文档标题"
  }
}
```

### 5.2 更新文献评分/备注

```
PATCH /api/reports/[reportId]/documents/[docIndex]
```

Request:
```json
{
  "user_rating": "useful",
  "user_note": "这篇文献相关性很高"
}
```

Response: 更新后的 `selected_docs` 数组

### 5.3 导出

```
GET /api/reports/[reportId]/export?format=markdown
GET /api/reports/[reportId]/export?format=docx
```

返回文件下载（Content-Disposition: attachment）

---

## 6. 导出格式

### 6.1 Markdown 格式

```markdown
# 专利检索报告

生成时间：2026-04-16
对比文献：10 篇

---

## 待审专利基本信息
（从 HTML 中提取或从 patent_documents 获取）

## 最相关对比文献

### 1. 文献标题
- **来源**: 平台 × 策略
- **作者**: XXX
- **链接**: [点击查看](url)
- **相关描述**: ...

### 2. 文献标题
...
```

### 6.2 Word 格式

使用 `docx` 库生成，包含：
- 标题样式（报告标题）
- 正文样式（各章节）
- 表格样式（文献列表）
- 链接保留

---

## 7. 依赖清单

```json
{
  "dependencies": {
    "docx": "^8.5.0"
  }
}
```

---

## 8. 后续迭代

以下功能不在本 Plan 范围内：

- PDF 导出
- 报告打印优化
- 多语言支持
- 报告分享功能
