# 专利新创性检索智能体 — 系统设计文档

**日期：** 2026-04-13  
**版本：** 1.1  
**状态：** 已确认，待实施

---

## 1. 项目概述

面向专利审查员的新创性检索辅助 Web 应用。用户上传待审专利文献，系统自动解析关键信息，调度多个 AI 平台并行执行多种检索策略，汇总筛选后生成结构化检索报告，支持多格式导出。

### 目标用户

- **审查员（User 角色）**：上传专利、发起检索、查阅/导出/删除自己的报告
- **管理员（Admin 角色）**：查看和管理所有用户数据，拥有系统全部操作权限

### 核心约束

- 公网 SaaS 部署（Vercel + Render + Supabase）
- 预计并发用户：10–50 人
- 并发策略：**串行队列**（同一时刻最多执行 1 个用户任务），超出自动排队，支持定时预约执行；用户可取消排队中或运行中的任务
- 单条子任务超时上限：**10 分钟**，支持 1 次重试，仍失败则放弃并记录
- 月均基础设施成本目标：**≈ $0**（Render 免费层每月 750 小时，冷启动约 30 秒；Supabase 免费层；Vercel 免费层）
  > Worker 空闲 15 分钟后 Render 会休眠，用户提交任务时前端先 ping Worker 唤醒，再入队执行

---

## 2. 技术栈

| 层级 | 技术选型 | 说明 |
|------|---------|------|
| 前端框架 | Next.js 14（App Router） | 部署至 Vercel |
| UI 组件 | Tailwind CSS + shadcn/ui | 视觉风格：清爽专业白（浅色底 + 蓝色主色） |
| 工作流可视化 | React Flow | 动态任务节点看板 |
| 实时通信 | Supabase Realtime | 订阅任务状态表驱动看板更新 |
| 数据库 | Supabase PostgreSQL | 含 RLS 行级权限 |
| 认证 | Supabase Auth | 邮箱注册/登录 |
| 文件存储 | Supabase Storage | 存储上传的专利原文件 |
| 任务队列 | pg-boss（运行于 PostgreSQL） | `maxWorkers: 1` 串行执行 |
| Worker 服务 | Node.js 独立进程 | 部署至 Render 免费层（750h/月，冷启动 ~30s） |
| AI 接入层 | 统一 AIAdapter 接口 | 封装各平台 API，支持 OpenAI 兼容格式及自定义格式 |
| 文件解析 | pdf-parse / mammoth / xlsx | PDF / Word / Excel 解析 |
| 报告导出 | docx / xlsx / 原生 Markdown | Word / Excel / MD 三格式导出 |

---

## 3. 系统架构

```
用户浏览器
    │ HTTPS
    ▼
Next.js（Vercel）
  ├── 页面渲染（App Router）
  ├── API Routes（轻量 REST 接口）
  └── Supabase JS SDK（Auth + Realtime 订阅）
    │ Supabase SDK / REST
    ▼
Supabase
  ├── Auth          — 用户注册/登录/JWT
  ├── PostgreSQL     — 业务数据（含 pg-boss 队列表）
  ├── Storage        — 专利原文件
  └── Realtime       — 任务状态变更推送
    │ pg-boss 监听
    ▼
Node.js Worker 服务（Render）
  ├── 从 pg-boss 队列取任务（支持两种任务类型）
  ├── [parse-job] 调用解析模型 API → 提取专利字段 → 写入 patent_documents.parsed_data
  ├── [search-job] 读取 parsed_data → Promise.all() 并发执行 M×N 条 AI 检索请求
  ├── 超时/重试/放弃逻辑
  ├── 调用汇总模型生成报告
  └── 写结果回 Supabase，触发 Realtime 通知
    │ HTTP / SSE
    ▼
外部 AI API（秘塔AI / Kimi K2.5 / 智谱GLM-5.1 / 自定义模型）
```

---

## 4. 数据库设计

### 4.1 表结构

#### `profiles`（用户档案）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | FK → auth.users，主键 |
| role | enum('admin','user') | 默认 'user' |
| display_name | text | 显示名称 |
| created_at | timestamptz | 创建时间 |

> Supabase Auth 触发器在用户注册时自动创建对应 profiles 记录。

---

#### `ai_models`（AI 模型库）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| owner_id | uuid nullable | FK → auth.users；null 表示系统内置 |
| name | text | 模型显示名（如"Kimi K2.5"） |
| api_base_url | text | API 端点 |
| api_key_encrypted | text | 加密存储的 API Key |
| model_id | text | 模型标识符 |
| is_builtin | boolean | 是否为系统内置模型 |
| usage_types | text[] | 用途分类（可多选）：'parse' / 'search' / 'report' |
| capabilities | jsonb | `{ "deep_reasoning": bool, "web_search": bool }` |
| created_at | timestamptz | — |

**能力要求规则：**
- `parse`（解析用）：`deep_reasoning: true`（联网不作要求）
- `search`（检索用）：`deep_reasoning: true` **且** `web_search: true`
- `report`（汇总用）：`deep_reasoning: true`（联网不作要求）

> 同一模型可标记多种用途（如 `["parse","report"]`），无需重复添加。

**内置默认模型：**
- 检索平台：秘塔AI、Kimi K2.5、智谱GLM-5.1
- 用户可自定义接入其他模型，UI 提供能力勾选框引导配置；不符合要求的选项在下拉列表中灰显并提示原因

---

#### `search_strategies`（检索策略）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| owner_id | uuid nullable | null 为系统内置 |
| name | text | 策略名称 |
| prompt_template | text | 提示词模板，使用 `{{占位符}}` 语法 |
| is_builtin | boolean | — |
| created_at | timestamptz | — |

**内置策略（提示词模板均支持用户修改）：**

1. **追踪检索**  
   `提供由"{{inventor}}"发表的涉及"{{tech_theme}}"的相关文献或网页，注明出处链接和公开时间。`

2. **发明构思检索**  
   `提供与"{{core_invention}}"技术构思最接近的文献或网页，若存在，按照相关程度从高到低排序，注明出处链接和公开时间，若不存在，则输出无符合要求的相关文献。`

3. **主要技术方案步骤检索**  
   `提供与"{{main_tech_steps}}"技术构思最接近的文献或网页，若存在，按照相关程度从高到低排序，注明出处链接和公开时间，若不存在，则输出无符合要求的相关文献。`

**提示词变量规范（`{{变量名}}` 语法）：**

| 变量名 | 对应字段 | 说明 |
|--------|---------|------|
| `{{tech_theme}}` | `parsed_data.tech_theme` | 技术主题 |
| `{{applicant}}` | `parsed_data.applicant` | 申请人 |
| `{{inventor}}` | `parsed_data.inventor` | 发明人 |
| `{{filing_date}}` | `parsed_data.filing_date` | 申请日 |
| `{{main_tech_steps}}` | `parsed_data.main_tech_steps` | 主要技术方案步骤 |
| `{{core_invention}}` | `parsed_data.core_invention` | 核心发明构思 |
| `{{custom.字段名}}` | `parsed_data.custom_fields.*` | 用户自定义字段 |

> UI 在提示词编辑器中提供变量列表提示（点击插入），防止手写错误。

---

#### `patent_documents`（专利文献）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| user_id | uuid | FK → auth.users |
| title | text | 文件名/专利标题 |
| file_url | text | Supabase Storage 路径 |
| file_type | enum('pdf','docx','xlsx','txt') | 文件类型 |
| parse_status | enum('pending','parsing','done','needs_review','failed') | 解析状态 |
| parsed_data | jsonb | 解析结果（见下方结构） |
| quality_warning | boolean | 是否触发复杂排版预警 |
| user_notes | text nullable | 用户手动补充/澄清内容 |
| created_at | timestamptz | — |

**`parsed_data` 结构：**
```json
{
  "tech_theme": "图像去噪处理",
  "applicant": "某某公司",
  "inventor": "张三、李四",
  "filing_date": "2024-01-15",
  "main_tech_steps": "...",
  "core_invention": "...",
  "custom_fields": {
    "用户自定义字段名": "字段值"
  }
}
```

> 当 `quality_warning: true` 时，前端显示橙色预警横幅，提示用户审查解析结果并在 `user_notes` 中补充澄清，解析结果支持手动编辑。

---

#### `search_jobs`（检索任务主表）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| user_id | uuid | FK → auth.users |
| document_id | uuid | FK → patent_documents |
| status | enum('queued','running','completed','failed','cancelled') | 任务状态 |
| scheduled_at | timestamptz nullable | 定时预约时间；null 表示立即执行 |
| config | jsonb | `{ model_ids[], strategy_ids[], per_task_limit: 5, report_limit: 10, report_model_id }` |
| started_at | timestamptz nullable | — |
| completed_at | timestamptz nullable | — |
| created_at | timestamptz | — |

> **排队位置不作为字段存储**，由前端实时查询计算：  
> `SELECT COUNT(*) FROM search_jobs WHERE status='queued' AND created_at < [当前任务.created_at]`  
> 避免每次出队时批量更新位置字段带来的竞态问题。

> **任务取消**：用户可对 `status='queued'` 或 `status='running'` 的任务发起取消请求。排队中的任务直接置为 `cancelled`；运行中的任务向 Worker 发送取消信号（通过 Supabase DB flag），Worker 检测到后终止当前执行并清理子任务。

> Supabase Realtime 订阅此表，驱动进度看板实时更新。

---

#### `search_tasks`（子任务明细）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| job_id | uuid | FK → search_jobs |
| model_id | uuid | FK → ai_models（检索平台） |
| strategy_id | uuid | FK → search_strategies |
| status | enum('pending','running','retrying','done','abandoned') | 子任务状态 |
| retry_count | integer | 当前重试次数（上限 1） |
| results | jsonb nullable | Top-N 文献列表（详见 6.2 节） |
| error_msg | text nullable | 失败/放弃原因 |
| started_at | timestamptz nullable | — |
| completed_at | timestamptz nullable | — |

> 每条记录对应动态看板中一个节点（平台×策略）；状态字段映射节点颜色。

---

#### `reports`（检索报告）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| job_id | uuid | FK → search_jobs |
| user_id | uuid | FK → auth.users |
| html_content | text | 完整 HTML 报告内容 |
| selected_docs | jsonb | Top-N 对比文献列表（详见 6.2 节） |
| doc_count | integer | 实际输出文献数量 |
| path_summary | jsonb | 各路径执行情况摘要 |
| created_at | timestamptz | — |

---

#### `notifications`（站内通知）
| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid | 主键 |
| user_id | uuid | FK → auth.users |
| job_id | uuid nullable | FK → search_jobs（关联任务） |
| type | enum('job_completed','job_failed','job_cancelled','parse_done','parse_failed') | 通知类型 |
| message | text | 通知正文（如"CN202410001234.7 检索完成，共找到 8 篇对比文献"） |
| read_at | timestamptz nullable | 已读时间；null 表示未读 |
| created_at | timestamptz | — |

> Supabase Realtime 订阅此表，Header 导航栏实时显示未读通知数（红点角标）。  
> Worker 在任务完成/失败/取消时写入对应通知记录，用户无需停留在看板页面等待。

---

### 4.2 RLS 行级安全策略

```sql
-- User 角色：仅操作自己的数据
CREATE POLICY user_isolation ON patent_documents
  USING (user_id = auth.uid());

-- Admin 角色：可查看所有数据（通过 profiles.role 判断）
CREATE POLICY admin_full_access ON patent_documents
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
```

> 同样的策略模式应用于 `search_jobs`、`search_tasks`、`reports` 等所有业务表。

---

## 5. 前端页面结构

```
/（重定向至 /login）
├── (auth)
│   ├── /login           — 登录页
│   └── /register        — 注册页
└── (app)（需登录，左侧边栏布局）
    ├── /dashboard        — 任务历史总览
    ├── /search/new       — 新建检索（3 步向导）
    │   ├── step-1        — 上传文件 + 选择解析模型 + 审查解析结果
    │   ├── step-2        — 配置检索平台/策略/数量参数
    │   └── step-3        — 确认提交 / 定时预约
    ├── /search/[jobId]/progress  — 实时进度看板（React Flow）
    ├── /search/[jobId]/report    — 检索报告查看 + 导出
    ├── /settings/models          — AI 模型库管理
    ├── /settings/strategies      — 检索策略管理
    └── /admin（仅 Admin）
        ├── /admin/users          — 用户管理
        └── /admin/jobs           — 所有任务总览
```

### 关键页面交互说明

**Step 1 — 上传 & 解析**
- **两种进入方式：**
  - 上传新文件：拖拽上传，接受 PDF / Word (.docx) / Excel (.xlsx) / TXT，单文件限制 ≤ 20MB；超过 50 页的 PDF 显示提示"文件较大，解析可能需要较长时间"
  - 复用历史文档：从下拉列表选择本人 `parse_status='done'` 的历史文献，直接跳至 Step 2
- 上传后触发 `parse-job` 入队（Worker 异步处理），前端通过 Supabase Realtime 订阅 `patent_documents.parse_status` 轮询进度，避免 Vercel Serverless 10 秒超时
- 用户选择解析用模型（需 `deep_reasoning: true`，不符合的灰显）
- 解析完成后展示 6 项字段 + 自定义扩展字段，均支持手动编辑
- 若 `quality_warning: true`，显示橙色横幅："文件排版复杂，解析结果可能不准确，建议逐项核对并在备注栏补充澄清"

**Step 2 — 配置检索**
- 检索平台：多选（仅显示 `usage_types` 包含 `'search'` 且满足能力要求的模型）
- 检索策略：多选，含 3 种内置策略（可点击查看/编辑提示词）+ 用户自定义策略
- 每路径备选文献数：默认 5，用户可调整
- 报告输出文献数：默认 10，用户可调整
- 汇总模型：选择用于报告生成的模型（需 `deep_reasoning: true`）

**Step 3 — 确认提交**
- 展示任务摘要：平台数 × 策略数 = 子任务总数，预计完成时间
- 显示当前队列状态（如"队列中有 1 个任务，预计约 8 分钟后开始"）
- 两个操作：立即提交（进入队列）/ 定时执行（时间选择器）

**进度看板（React Flow）**
- 节点布局：文献解析节点 → M×N 个子任务节点 → 报告生成节点
- 节点颜色编码：
  - 灰色：等待中
  - 蓝色（脉冲动画）：运行中
  - 橙色：重试中
  - 绿色：完成
  - 红色：放弃
- 若 `status='queued'`，看板显示排队位置（实时查询计算，非存储字段）和预计等待时间，而非任务节点；页面提供"取消任务"按钮
- 若 `status='running'`，看板显示任务节点流程图；页面同样提供"取消任务"按钮，点击后向 Worker 发送取消信号
- Supabase Realtime 订阅 `search_tasks` 和 `search_jobs` 表变更，自动更新节点状态

---

## 6. 检索编排与 Worker 逻辑

### 6.1 串行队列配置

```js
// pg-boss 配置（两种任务类型共用同一个串行 Worker）
const boss = new PgBoss(connectionString);

// 文献解析任务（异步，避免 Vercel 10s 超时）
await boss.work('parse-job', { teamSize: 1, teamConcurrency: 1 }, parseDocument);

// 检索任务（串行执行）
await boss.work('search-job', { teamSize: 1, teamConcurrency: 1 }, processSearchJob);

// Worker 启动时 ping Render 自身保活（防止 15 分钟冷休眠影响正在运行的任务）
```

### 6.2 Worker 执行流程

**parse-job 流程：**
```
1. 从 pg-boss 取出一个 parse-job
2. 更新 patent_documents.parse_status = 'parsing'
3. 从 Supabase Storage 下载原文件
4. 使用 pdf-parse / mammoth / xlsx 提取文本内容
5. 若提取内容异常（字符数过少、乱码比例高）→ quality_warning = true
6. 调用解析模型 API，提取 6 项标准字段 + 用户自定义字段
7. 写入 patent_documents.parsed_data，更新 parse_status = 'done'（或 'needs_review'/'failed'）
8. 写入 notifications 记录，Realtime 推送前端
```

**search-job 流程：**
```
1. 从 pg-boss 取出一个 search_job
2. 检查 job.status 是否为 'cancelled'，若是则跳过直接结束
3. 更新 job.status = 'running'
4. 从 patent_documents.parsed_data 读取解析结果
5. 展开 M 个平台 × N 个策略 = M×N 条 search_task 记录（status = 'pending'）
6. 填充每条任务的提示词占位符（按变量规范替换）
7. Promise.all() 并发发出所有 M×N 个 AI API 请求
   每条子任务：
   ├── 每隔 5s 检查 job.status，若已变为 'cancelled' → 中止并清理
   ├── AbortController 设置 10 分钟超时
   ├── 成功 → results 写入 search_tasks，status = 'done'
   ├── 超时/失败（retry_count = 0）
   │   → 等待 30s → 重试，status = 'retrying'，retry_count = 1
   └── 重试仍失败 → status = 'abandoned'，记录 error_msg
8. 全部子任务完成（含 abandoned/cancelled）后触发报告生成
9. 汇总各 search_task.results → 去重（按 URL/标题去重）
10. 调用汇总模型（deep_reasoning）对比专利文献，筛选 Top-N
11. 生成 HTML 报告，写入 reports 表
12. 更新 job.status = 'completed'
13. 写入 notifications 记录，Realtime 推送前端
```

### 6.3 子任务结果结构（`search_tasks.results`）

```json
[
  {
    "title": "文献标题",
    "authors": "作者列表",
    "url": "出处链接",
    "pub_date": "公开时间",
    "relevance_desc": "相关特征描述（由 AI 生成）",
    "citation_gb": "中国国标引文格式"
  }
]
```

### 6.4 报告对比文献结构（`reports.selected_docs`）

```json
[
  {
    "rank": 1,
    "title": "文献标题",
    "authors": "作者列表",
    "url": "出处链接",
    "pub_date": "公开时间",
    "relevance_desc": "相关特征描述",
    "citation_gb": "中国国标引文格式",
    "source_platform": "秘塔AI",
    "source_strategy": "发明构思检索",
    "source_task_id": "uuid",
    "user_rating": null
  }
]
```

> `user_rating` 初始为 `null`，用户可在报告页面对每篇文献标记"有用 👍"或"无关 👎"（枚举：`useful` / `irrelevant`）。评分写回 `reports.selected_docs` 对应元素，长期积累可用于优化提示词模板。

### 6.5 Worker 崩溃恢复

pg-boss 的 `expireInSeconds` 配置确保：若 Worker 进程崩溃，超过时限仍处于 `running` 状态的 job 自动重新入队，避免任务丢失。

---

## 7. 检索报告格式

### 7.1 报告章节结构

1. **封面信息**：申请号、生成时间、检索平台列表、检索策略列表
2. **一、待审专利基本信息**：技术主题、申请人、发明人、申请日、核心发明构思、主要技术方案步骤
3. **二、最相关对比文献（Top-N）**：每篇含排名、标题、来源标签（平台·策略）、作者、出处链接、公开时间、相关特征描述、国标引文格式
4. **三、检索路径执行情况**：各路径 ✅正常完成（含获取文献数）/ ❌放弃（含原因），最终备注基于几条有效路径生成

### 7.2 导出格式

| 格式 | 库 | 内容 |
|------|----|------|
| Word (.docx) | `docx` | 完整报告结构，保留样式，可存档提交 |
| Markdown (.md) | 原生字符串 | 适合粘贴至 Notion/飞书等协作工具 |
| Excel (.xlsx) | `xlsx` | 每篇文献一行，含所有字段，便于批量管理 |
| HTML（在线） | — | 浏览器直接打印，无需额外导出 |

---

## 8. AI 模型接入模块设计

### 8.1 统一 AIAdapter 接口

```ts
interface AIAdapter {
  name: string;
  call(prompt: string, systemPrompt?: string): Promise<string>;
}

// OpenAI 兼容实现（覆盖 Kimi、DeepSeek、智谱等）
class OpenAICompatAdapter implements AIAdapter { ... }

// 自定义实现（用户提供请求/响应映射）
class CustomAdapter implements AIAdapter { ... }
```

### 8.2 自定义模型接入 UI

用户在 `/settings/models` 填写：
1. 模型名称（自定义显示名）
2. API Endpoint URL
3. API Key
4. Model ID
5. 能力勾选：☑ 深度推理 ☑ 联网搜索
6. 请求格式：OpenAI 兼容 / 自定义

系统在接入时做基础连通性测试（发送测试请求），失败时显示具体错误信息。API Key 使用 Supabase 加密存储，不在前端明文展示。

---

## 9. 权限控制总结

| 操作 | User | Admin |
|------|------|-------|
| 查看自己的数据 | ✅ | ✅ |
| 导出/删除自己的数据 | ✅ | ✅ |
| 查看其他用户数据 | ❌ | ✅ |
| 删除其他用户数据 | ❌ | ❌（仅查看，不可代删） |
| 管理系统内置模型 | ❌ | ✅ |
| 查看所有任务队列 | ❌ | ✅ |
| 用户角色管理 | ❌ | ✅ |

数据隔离通过 Supabase RLS（行级安全策略）在数据库层强制执行，不依赖前端逻辑。

---

## 10. 未来扩展方向

以下功能不纳入 v1.0 实施范围，作为后续迭代参考。

### 10.1 基于报告发起再次检索（#9）

报告页面提供"基于此次结果再次检索"入口：复用当前已解析的专利文档，进入 Step 2 重新配置检索平台/策略组合，发起新的检索任务。适合审查员对初次检索结果不满意时快速迭代，无需重新上传和解析文献。

### 10.2 检索结果质量反馈与提示词优化（#8 扩展）

在 `user_rating` 数据积累到一定量后，可通过分析"有用"与"无关"文献的特征差异，辅助优化各检索策略的提示词模板，形成闭环改进机制。

### 10.3 多语言支持

当前提示词模板和报告均为中文。未来可支持英文专利检索场景，提示词模板按语言版本分组管理。

### 10.4 团队/组织账户

当前为个人账户模型（User/Admin 两级）。未来可引入"审查组"概念，同组成员共享检索历史和报告，便于专利审查工作协同。

---

## 11. 待补充内容

- [ ] 各检索平台（秘塔AI、Kimi K2.5、智谱GLM-5.1）的具体 API 规范（用户后续提供官方文档）
- [ ] 邮件通知服务选型（Resend / Supabase SMTP）——站内通知已设计，邮件为可选补充
- [ ] 自定义模型请求/响应格式映射的具体设计
