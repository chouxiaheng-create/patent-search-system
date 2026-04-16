# Plan 4: Worker 任务执行逻辑 — 设计文档

**日期：** 2026-04-16
**版本：** 1.0
**状态：** 待确认

---

## 1. 概述

本文档定义 Worker 服务中 `parse-job`（文献解析）和 `search-job`（检索任务）的完整实现逻辑，包括：

- AI 适配器架构（统一 OpenAI 兼容 + 秘塔AI）
- 文件解析器（PDF/Word/Excel/TXT）
- 任务处理器（解析、检索、报告生成）
- 取消机制
- 错误处理与重试

---

## 2. 架构设计

### 2.1 模块分层

```
worker/src/
├── index.ts                    # 入口，pg-boss 初始化
├── health.ts                   # 健康检查 HTTP 服务
├── handlers/                   # 任务处理器层
│   ├── parse-job.ts            # 文献解析任务
│   └── search-job.ts           # 检索任务
├── adapters/                   # AI 适配器层
│   ├── index.ts                # 工厂函数
│   ├── base.ts                 # 接口定义
│   ├── openai-compat.ts        # OpenAI 兼容（智谱/Kimi/DeepSeek/千问/MiniMax）
│   └── metaso.ts               # 秘塔AI 搜索引擎
├── parsers/                    # 文件解析层
│   ├── index.ts                # 入口 + 质量检测
│   ├── pdf.ts                  # PDF 解析
│   ├── docx.ts                 # Word 解析
│   ├── xlsx.ts                 # Excel 解析
│   └── txt.ts                  # TXT 解析
├── services/                   # 服务层
│   ├── supabase.ts             # 数据库客户端
│   ├── report.ts               # 报告生成
│   └── notification.ts         # 通知推送
└── utils/                      # 工具层
    └── prompt.ts               # 提示词构建与变量替换
```

### 2.2 数据流

```
parse-job:
  pg-boss → 下载文件 → 解析文本 → AI提取字段 → 写入DB → 通知

search-job:
  pg-boss → 创建子任务 → 并发AI检索 → 去重筛选 → 生成报告 → 写入DB → 通知
```

---

## 3. AI 适配器设计

### 3.1 接口定义

```typescript
// worker/src/adapters/base.ts
export interface AIAdapterCallOptions {
  modelId: string
  prompt: string
  systemPrompt?: string
  enableThinking?: boolean
  enableWebSearch?: boolean
  timeout?: number  // 默认 600000ms (10分钟)
}

export interface AIAdapterResult {
  success: boolean
  content?: string
  error?: string
}

export interface AIAdapter {
  name: string
  call(options: AIAdapterCallOptions): Promise<AIAdapterResult>
}
```

### 3.2 OpenAI 兼容适配器

适用于：智谱GLM、Kimi、DeepSeek、千问、MiniMax

核心逻辑：
1. 构建 OpenAI 格式请求体
2. 根据 `AdapterConfig` 处理 thinking/web_search 参数
3. 处理互斥规则（如 Kimi 联网时必须关闭 thinking）
4. AbortController 实现 10 分钟超时
5. 解析响应返回 content 或 error

### 3.3 秘塔AI 适配器

- 本身为搜索引擎，web_search 是固有功能
- 根据 API 文档实现调用方式

### 3.4 适配器工厂

```typescript
// worker/src/adapters/index.ts
export function createAdapter(model: AIModel): AIAdapter {
  if (model.adapter_config.provider === 'metaso') {
    return new MetasoAdapter(model)
  }
  return new OpenAICompatAdapter(model)
}
```

---

## 4. 文件解析器设计

### 4.1 解析结果结构

```typescript
export interface ParseResult {
  text: string
  qualityWarning: boolean  // 内容异常时为 true
  error?: string
}
```

### 4.2 质量检测规则

- 字符数 < 100 → 质量警告
- 非中文/英文/数字/标点字符 > 30% → 质量警告

### 4.3 支持格式

| 格式 | 库 | 说明 |
|------|-----|------|
| PDF | pdf-parse | 提取文本内容 |
| Word (.docx) | mammoth | 提取原始文本 |
| Excel (.xlsx) | xlsx | 逐 Sheet 转 CSV 后合并 |
| TXT | 原生 | Buffer.toString('utf-8') |

---

## 5. parse-job 处理器

### 5.1 任务数据结构

```typescript
interface ParseJobData {
  documentId: string
  userId: string
  parseConfig: {
    modelId: string
    systemPrompt?: string
  }
}
```

### 5.2 处理流程

1. 更新 `parse_status = 'parsing'`
2. 从 Supabase Storage 下载文件
3. 调用文件解析器提取文本
4. 调用 AI 模型提取结构化字段（6项标准字段 + 自定义字段）
5. 更新文档记录：`parse_status`、`parsed_data`、`quality_warning`
6. 发送通知

### 5.3 解析提示词

默认提取以下字段：
- `tech_theme`: 技术主题
- `applicant`: 申请人
- `inventor`: 发明人
- `filing_date`: 申请日
- `main_tech_steps`: 主要技术方案步骤
- `core_invention`: 核心发明构思
- `custom_fields`: 自定义字段

---

## 6. search-job 处理器

### 6.1 任务数据结构

```typescript
interface SearchJobData {
  jobId: string
  userId: string
  documentId: string
  config: {
    modelIds: string[]
    strategyIds: string[]
    perTaskLimit: number
    reportLimit: number
    reportModelId: string
    reportSystemPrompt?: string
    modelFeatureOverrides?: ModelFeatureOverride[]
  }
}
```

### 6.2 处理流程

1. 检查 `job.status`，若为 `cancelled` 则跳过
2. 更新 `status = 'running'`
3. 创建 M×N 条 `search_tasks` 记录
4. 并发执行所有子任务（每 5 秒检查取消状态）
5. 检查是否在执行中被取消
6. 汇总结果、去重、调用汇总模型筛选 Top-N
7. 生成 HTML 报告
8. 更新 `status = 'completed'`
9. 发送通知

### 6.3 子任务执行

- 单个子任务超时：10 分钟
- 失败重试：最多 1 次，等待 30 秒
- 重试仍失败：标记 `abandoned`，记录 `error_msg`
- 执行中检测取消：每 5 秒查询 `job.status`

### 6.4 取消机制

- 排队中：API 直接更新 `status = 'cancelled'`
- 运行中：Worker 定期检查 `job.status`，检测到取消后中止子任务并清理

---

## 7. 报告生成设计

### 7.1 报告结构

1. **封面信息**：生成时间、检索平台、检索策略
2. **待审专利基本信息**：技术主题、申请人、发明人、申请日、核心发明构思、主要技术方案
3. **最相关对比文献（Top-N）**：排名、标题、来源标签、作者、链接、公开时间、相关描述
4. **检索路径执行情况**：各路径完成/放弃状态

### 7.2 筛选逻辑

1. 按 URL/标题去重
2. 若结果数 > limit，调用汇总模型进行相关性排序筛选
3. 筛选失败时返回前 N 个

### 7.3 HTML 样式

- 简洁专业白（浅色底 + 蓝色主色）
- 与现有 UI 风格一致
- 支持浏览器打印

---

## 8. 通知服务

### 8.1 通知类型

| 类型 | 触发场景 |
|------|---------|
| `parse_done` | 文献解析完成 |
| `parse_failed` | 文献解析失败 |
| `job_completed` | 检索任务完成 |
| `job_failed` | 检索任务失败 |

### 8.2 写入逻辑

任务完成/失败后写入 `notifications` 表，Supabase Realtime 推送至前端。

---

## 9. Worker 入口配置

```typescript
const boss = new PgBoss({
  connectionString: DATABASE_URL,
  expireInSeconds: 900  // 崩溃恢复：15分钟后自动重新入队
})

await boss.work('parse-job', { teamSize: 1, teamConcurrency: 1 }, handleParseJob)
await boss.work('search-job', { teamSize: 1, teamConcurrency: 1 }, handleSearchJob)
```

---

## 10. 依赖清单

```json
{
  "dependencies": {
    "@supabase/supabase-js": "^2.103.0",
    "express": "^5.2.1",
    "pg-boss": "^12.15.0",
    "pdf-parse": "^1.1.1",
    "mammoth": "^1.8.0",
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "@types/express": "^5.0.6",
    "@types/node": "^25.6.0",
    "@types/pdf-parse": "^1.1.4",
    "nodemon": "^3.1.14",
    "ts-node": "^10.9.2",
    "typescript": "^6.0.2"
  }
}
```

---

## 11. 环境变量

```bash
# worker/.env
DATABASE_URL=postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres
SUPABASE_URL=https://[ref].supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PORT=3001
```

---

## 12. 实施计划概要

| Task | 内容 |
|------|------|
| Task 1 | 安装依赖（pdf-parse, mammoth, xlsx） |
| Task 2 | 实现 AI 适配器（base, openai-compat, metaso, index） |
| Task 3 | 实现文件解析器（pdf, docx, xlsx, txt, index） |
| Task 4 | 实现服务层（supabase, notification） |
| Task 5 | 实现工具层（prompt.ts） |
| Task 6 | 实现 parse-job 处理器 |
| Task 7 | 实现 search-job 处理器（含取消机制） |
| Task 8 | 实现报告生成服务 |
| Task 9 | 更新 Worker 入口 |
| Task 10 | 端到端测试 |

---

## 13. 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| AI API 调用超时 | AbortController + 10 分钟超时 |
| Worker 崩溃 | pg-boss expireInSeconds 自动恢复 |
| 文件解析失败 | 捕获异常，标记 status='failed' |
| 报告筛选失败 | 降级返回前 N 个结果 |

---

## 14. 后续迭代

以下功能不在本 Plan 范围内：

- 报告导出（Word/Excel/Markdown）
- 进度看板（React Flow 可视化）
- 管理后台
- 邮件通知
