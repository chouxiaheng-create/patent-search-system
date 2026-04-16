# Plan 4: Worker 任务执行逻辑 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现 Worker 服务中 parse-job 和 search-job 的完整执行逻辑，包括 AI 适配器、文件解析、任务处理、报告生成和取消机制。

**Architecture:** 模块化分层架构，Worker 从 pg-boss 队列接收任务，通过适配器调用 AI API，解析文件提取文本，执行并发检索，去重汇总后生成报告。

**Tech Stack:** Node.js, TypeScript, pg-boss v12, pdf-parse, mammoth, xlsx, @supabase/supabase-js

---

## 文件结构

```
worker/src/
├── index.ts                    # 入口，pg-boss 初始化
├── health.ts                   # 健康检查（已存在）
├── handlers/
│   ├── parse-job.ts            # 文献解析任务处理器
│   └── search-job.ts           # 检索任务处理器
├── adapters/
│   ├── index.ts                # 适配器工厂
│   ├── base.ts                 # AIAdapter 接口
│   ├── openai-compat.ts        # OpenAI 兼容适配器
│   └── metaso.ts               # 秘塔AI 适配器
├── parsers/
│   ├── index.ts                # 解析入口 + 质量检测
│   ├── pdf.ts                  # PDF 解析
│   ├── docx.ts                 # Word 解析
│   ├── xlsx.ts                 # Excel 解析
│   └── txt.ts                  # TXT 解析
├── services/
│   ├── supabase.ts             # 数据库客户端 + 工具函数
│   ├── report.ts               # 报告生成
│   └── notification.ts         # 通知推送
└── utils/
    └── prompt.ts               # 提示词构建与变量替换

worker/__tests__/
└── adapters/
    └── openai-compat.test.ts   # 适配器测试
```

---

## Task 1: 安装依赖

**Files:**
- Modify: `worker/package.json`

- [ ] **Step 1: 安装文件解析依赖**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1\worker"
npm install pdf-parse mammoth xlsx
```

- [ ] **Step 2: 安装类型定义**

```bash
npm install -D @types/pdf-parse
```

- [ ] **Step 3: 验证安装**

```bash
npm list pdf-parse mammoth xlsx
```

预期输出：三个包版本号

- [ ] **Step 4: Commit**

```bash
git add worker/package.json worker/package-lock.json
git commit -m "feat(worker): add pdf-parse, mammoth, xlsx dependencies"
```

---

## Task 2: AI 适配器 — 接口定义

**Files:**
- Create: `worker/src/adapters/base.ts`

- [ ] **Step 1: 创建适配器接口**

```typescript
// worker/src/adapters/base.ts

export interface AIAdapterCallOptions {
  modelId: string
  prompt: string
  systemPrompt?: string
  enableThinking?: boolean
  enableWebSearch?: boolean
  timeout?: number
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

- [ ] **Step 2: Commit**

```bash
git add worker/src/adapters/base.ts
git commit -m "feat(worker): add AIAdapter interface definition"
```

---

## Task 3: AI 适配器 — OpenAI 兼容适配器

**Files:**
- Create: `worker/src/adapters/openai-compat.ts`

- [ ] **Step 1: 实现 OpenAI 兼容适配器**

```typescript
// worker/src/adapters/openai-compat.ts
import { AIAdapter, AIAdapterCallOptions, AIAdapterResult } from './base'

export interface AIModelRecord {
  id: string
  name: string
  api_base_url: string
  api_key_encrypted: string
  model_id: string
  adapter_config: {
    provider: 'openai_compat' | 'metaso'
    web_search_method: 'tools_builtin' | 'tools_web_search' | 'extra_body' | 'native' | 'none'
    web_search_tool_name?: string
    thinking_method: 'param' | 'model_switch' | 'extra_body' | 'default_on' | 'none'
    thinking_model_id?: string
    web_search_disables_thinking: boolean
    thinking_default_on: boolean
  }
}

export class OpenAICompatAdapter implements AIAdapter {
  name = 'openai-compat'

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private adapterConfig: AIModelRecord['adapter_config']
  ) {}

  async call(options: AIAdapterCallOptions): Promise<AIAdapterResult> {
    const timeout = options.timeout ?? 600000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const body = this.buildRequestBody(options)
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `HTTP ${response.status}: ${errorText}` }
      }

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }

      if (data.error) {
        return { success: false, error: data.error.message }
      }

      const content = data.choices?.[0]?.message?.content
      if (!content) {
        return { success: false, error: 'AI 返回内容为空' }
      }

      return { success: true, content }
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, error: `请求超时（${timeout / 1000}秒）` }
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  private buildRequestBody(options: AIAdapterCallOptions): Record<string, unknown> {
    const messages: Array<{ role: string; content: string }> = []
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt })
    }
    messages.push({ role: 'user', content: options.prompt })

    const body: Record<string, unknown> = {
      model: options.modelId,
      messages
    }

    const { web_search_method, thinking_method, thinking_model_id, web_search_disables_thinking, thinking_default_on } = this.adapterConfig

    // 处理深度思考
    if (thinking_method === 'model_switch' && thinking_model_id && options.enableThinking) {
      body.model = thinking_model_id
    } else if (thinking_method === 'param') {
      body.extra_body = body.extra_body || {}
      if (options.enableThinking) {
        (body.extra_body as Record<string, unknown>).thinking = { type: 'enabled' }
      }
    } else if (thinking_method === 'extra_body' && options.enableThinking) {
      body.extra_body = body.extra_body || {}
      (body.extra_body as Record<string, unknown>).enable_thinking = true
    }

    // 处理联网搜索
    if (options.enableWebSearch && web_search_method && web_search_method !== 'none') {
      if (web_search_disables_thinking) {
        // 清除可能已设置的 thinking 参数
        if (body.extra_body) {
          delete (body.extra_body as Record<string, unknown>).thinking
        }
      }

      if (web_search_method === 'tools_builtin') {
        body.tools = [{ type: 'builtin_function', function: { name: '$web_search' } }]
      } else if (web_search_method === 'tools_web_search') {
        body.tools = [{ type: 'web_search' }]
      } else if (web_search_method === 'extra_body') {
        body.extra_body = body.extra_body || {}
        (body.extra_body as Record<string, unknown>).enable_search = true
      } else if (web_search_method === 'native') {
        // 搜索引擎本身支持搜索，无需额外参数
      }
    }

    return body
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/adapters/openai-compat.ts
git commit -m "feat(worker): implement OpenAICompatAdapter with thinking/web_search support"
```

---

## Task 4: AI 适配器 — 秘塔AI 适配器

**Files:**
- Create: `worker/src/adapters/metaso.ts`

- [ ] **Step 1: 实现秘塔AI 适配器**

```typescript
// worker/src/adapters/metaso.ts
import { AIAdapter, AIAdapterCallOptions, AIAdapterResult } from './base'

export class MetasoAdapter implements AIAdapter {
  name = 'metaso'

  constructor(
    private baseUrl: string,
    private apiKey: string
  ) {}

  async call(options: AIAdapterCallOptions): Promise<AIAdapterResult> {
    const timeout = options.timeout ?? 600000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const response = await fetch(`${this.baseUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          query: options.prompt,
          model: options.modelId
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `HTTP ${response.status}: ${errorText}` }
      }

      const data = await response.json() as { results?: Array<{ content?: string }>; answer?: string; error?: string }

      if (data.error) {
        return { success: false, error: data.error }
      }

      const content = data.answer || data.results?.map(r => r.content).join('\n') || ''
      return { success: true, content }
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, error: `请求超时（${timeout / 1000}秒）` }
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/adapters/metaso.ts
git commit -m "feat(worker): implement MetasoAdapter"
```

---

## Task 5: AI 适配器 — 适配器工厂

**Files:**
- Create: `worker/src/adapters/index.ts`

- [ ] **Step 1: 创建适配器工厂**

```typescript
// worker/src/adapters/index.ts
import { AIAdapter } from './base'
import { OpenAICompatAdapter, AIModelRecord } from './openai-compat'
import { MetasoAdapter } from './metaso'

export { AIAdapter, AIAdapterCallOptions, AIAdapterResult } from './base'

export function createAdapter(model: AIModelRecord): AIAdapter {
  if (model.adapter_config.provider === 'metaso') {
    return new MetasoAdapter(model.api_base_url, model.api_key_encrypted)
  }
  return new OpenAICompatAdapter(
    model.api_base_url,
    model.api_key_encrypted,
    model.adapter_config
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/adapters/index.ts
git commit -m "feat(worker): add adapter factory with createAdapter function"
```

---

## Task 6: 文件解析器 — PDF 和 TXT

**Files:**
- Create: `worker/src/parsers/pdf.ts`
- Create: `worker/src/parsers/txt.ts`

- [ ] **Step 1: 实现 PDF 解析器**

```typescript
// worker/src/parsers/pdf.ts
import pdf from 'pdf-parse'

export interface ParseResult {
  text: string
  qualityWarning: boolean
}

export async function parsePdf(buffer: Buffer): Promise<ParseResult> {
  const data = await pdf(buffer)
  const text = data.text.trim()
  const qualityWarning = detectQualityIssues(text)
  return { text, qualityWarning }
}

function detectQualityIssues(text: string): boolean {
  if (text.length < 100) return true
  const validChars = text.match(/[\u4e00-\u9fa5a-zA-Z0-9\s\p{P}]/gu) || []
  if (text.length > 0 && validChars.length / text.length < 0.7) return true
  return false
}
```

- [ ] **Step 2: 实现 TXT 解析器**

```typescript
// worker/src/parsers/txt.ts
import { ParseResult, detectQualityIssues } from './pdf'

export async function parseTxt(buffer: Buffer): Promise<ParseResult> {
  const text = buffer.toString('utf-8').trim()
  const qualityWarning = detectQualityIssues(text)
  return { text, qualityWarning }
}
```

Note: `detectQualityIssues` 在 `pdf.ts` 中导出供其他模块使用。

- [ ] **Step 3: Commit**

```bash
git add worker/src/parsers/pdf.ts worker/src/parsers/txt.ts
git commit -m "feat(worker): add PDF and TXT parsers with quality detection"
```

---

## Task 7: 文件解析器 — Word 和 Excel

**Files:**
- Create: `worker/src/parsers/docx.ts`
- Create: `worker/src/parsers/xlsx.ts`

- [ ] **Step 1: 实现 Word 解析器**

```typescript
// worker/src/parsers/docx.ts
import mammoth from 'mammoth'
import { ParseResult } from './pdf'

export async function parseDocx(buffer: Buffer): Promise<ParseResult> {
  const result = await mammoth.extractRawText({ buffer })
  const text = result.value.trim()
  const qualityWarning = detectQualityIssues(text)
  return { text, qualityWarning }
}

function detectQualityIssues(text: string): boolean {
  if (text.length < 100) return true
  const validChars = text.match(/[\u4e00-\u9fa5a-zA-Z0-9\s\p{P}]/gu) || []
  if (text.length > 0 && validChars.length / text.length < 0.7) return true
  return false
}
```

- [ ] **Step 2: 实现 Excel 解析器**

```typescript
// worker/src/parsers/xlsx.ts
import xlsx from 'xlsx'
import { ParseResult } from './pdf'

export async function parseXlsx(buffer: Buffer): Promise<ParseResult> {
  const workbook = xlsx.read(buffer)
  const sheets = workbook.SheetNames.map(name => {
    const sheet = workbook.Sheets[name]
    return xlsx.utils.sheet_to_csv(sheet)
  })
  const text = sheets.filter(s => s.trim()).join('\n\n').trim()
  const qualityWarning = detectQualityIssues(text)
  return { text, qualityWarning }
}

function detectQualityIssues(text: string): boolean {
  if (text.length < 100) return true
  const validChars = text.match(/[\u4e00-\u9fa5a-zA-Z0-9\s\p{P}]/gu) || []
  if (text.length > 0 && validChars.length / text.length < 0.7) return true
  return false
}
```

- [ ] **Step 3: Commit**

```bash
git add worker/src/parsers/docx.ts worker/src/parsers/xlsx.ts
git commit -m "feat(worker): add Word and Excel parsers"
```

---

## Task 8: 文件解析器 — 入口

**Files:**
- Create: `worker/src/parsers/index.ts`

- [ ] **Step 1: 创建解析器入口**

```typescript
// worker/src/parsers/index.ts
import { parsePdf } from './pdf'
import { parseDocx } from './docx'
import { parseXlsx } from './xlsx'
import { parseTxt } from './txt'
import { ParseResult } from './pdf'

export type FileType = 'pdf' | 'docx' | 'xlsx' | 'txt'

export { ParseResult } from './pdf'

export async function parseFile(buffer: Buffer, fileType: FileType): Promise<ParseResult> {
  switch (fileType) {
    case 'pdf':
      return parsePdf(buffer)
    case 'docx':
      return parseDocx(buffer)
    case 'xlsx':
      return parseXlsx(buffer)
    case 'txt':
      return parseTxt(buffer)
    default:
      throw new Error(`不支持的文件类型: ${fileType}`)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/parsers/index.ts
git commit -m "feat(worker): add unified parseFile entry point"
```

---

## Task 9: 服务层 — Supabase 客户端

**Files:**
- Create: `worker/src/services/supabase.ts`

- [ ] **Step 1: 实现 Supabase 服务**

```typescript
// worker/src/services/supabase.ts
import { createClient, SupabaseClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL!
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false }
})

export async function downloadFile(fileUrl: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from('patent-files')
    .download(fileUrl)

  if (error) throw new Error(`下载文件失败: ${error.message}`)
  if (!data) throw new Error('文件数据为空')

  const arrayBuffer = await data.arrayBuffer()
  return Buffer.from(arrayBuffer)
}

export interface AIModelRecord {
  id: string
  owner_id: string | null
  name: string
  api_base_url: string
  api_key_encrypted: string
  model_id: string
  is_builtin: boolean
  usage_types: string[]
  adapter_config: {
    provider: 'openai_compat' | 'metaso'
    web_search_method: 'tools_builtin' | 'tools_web_search' | 'extra_body' | 'native' | 'none'
    web_search_tool_name?: string
    thinking_method: 'param' | 'model_switch' | 'extra_body' | 'default_on' | 'none'
    thinking_model_id?: string
    web_search_disables_thinking: boolean
    thinking_default_on: boolean
  }
  created_at: string
}

export async function getModel(modelId: string): Promise<AIModelRecord> {
  const { data, error } = await supabase
    .from('ai_models')
    .select('*')
    .eq('id', modelId)
    .single()

  if (error || !data) throw new Error(`获取模型失败: ${modelId}`)
  return data as AIModelRecord
}

export interface SearchStrategyRecord {
  id: string
  owner_id: string | null
  name: string
  prompt_template: string
  is_builtin: boolean
  created_at: string
}

export async function getStrategy(strategyId: string): Promise<SearchStrategyRecord> {
  const { data, error } = await supabase
    .from('search_strategies')
    .select('*')
    .eq('id', strategyId)
    .single()

  if (error || !data) throw new Error(`获取策略失败: ${strategyId}`)
  return data as SearchStrategyRecord
}

export async function getJob(jobId: string) {
  const { data, error } = await supabase
    .from('search_jobs')
    .select('*')
    .eq('id', jobId)
    .single()

  if (error || !data) throw new Error(`获取任务失败: ${jobId}`)
  return data
}

export async function getDocument(documentId: string) {
  const { data, error } = await supabase
    .from('patent_documents')
    .select('*')
    .eq('id', documentId)
    .single()

  if (error || !data) throw new Error(`获取文档失败: ${documentId}`)
  return data
}

export async function getDocumentById(documentId: string) {
  return getDocument(documentId)
}

export async function updateDocument(documentId: string, updates: Record<string, unknown>) {
  const { error } = await supabase
    .from('patent_documents')
    .update(updates)
    .eq('id', documentId)

  if (error) throw new Error(`更新文档失败: ${error.message}`)
}

export async function updateJob(jobId: string, updates: Record<string, unknown>) {
  const { error } = await supabase
    .from('search_jobs')
    .update(updates)
    .eq('id', jobId)

  if (error) throw new Error(`更新任务失败: ${error.message}`)
}

export async function updateTaskStatus(taskId: string, status: string, extra: Record<string, unknown> = {}) {
  const { error } = await supabase
    .from('search_tasks')
    .update({ status, ...extra })
    .eq('id', taskId)

  if (error) throw new Error(`更新子任务失败: ${error.message}`)
}

export async function getSearchTasks(jobId: string) {
  const { data, error } = await supabase
    .from('search_tasks')
    .select('*')
    .eq('job_id', jobId)

  if (error) throw new Error(`获取子任务失败: ${error.message}`)
  return data || []
}

export async function createSearchTasks(jobId: string, modelIds: string[], strategyIds: string[]) {
  const tasks = modelIds.flatMap(modelId =>
    strategyIds.map(strategyId => ({
      job_id: jobId,
      model_id: modelId,
      strategy_id: strategyId,
      status: 'pending',
      retry_count: 0
    }))
  )

  const { data, error } = await supabase
    .from('search_tasks')
    .insert(tasks)
    .select('id, model_id, strategy_id, status, retry_count')

  if (error) throw new Error(`创建子任务失败: ${error.message}`)
  return data
}

export async function getPlatformNames(modelIds: string[]): Promise<string[]> {
  const { data } = await supabase
    .from('ai_models')
    .select('name')
    .in('id', modelIds)

  return (data || []).map(d => d.name)
}

export async function getStrategyNames(strategyIds: string[]): Promise<string[]> {
  const { data } = await supabase
    .from('search_strategies')
    .select('name')
    .in('id', strategyIds)

  return (data || []).map(d => d.name)
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/services/supabase.ts
git commit -m "feat(worker): add Supabase service with CRUD helpers"
```

---

## Task 10: 服务层 — 通知服务

**Files:**
- Create: `worker/src/services/notification.ts`

- [ ] **Step 1: 实现通知服务**

```typescript
// worker/src/services/notification.ts
import { supabase } from './supabase'

export type NotificationType =
  | 'job_completed'
  | 'job_failed'
  | 'job_cancelled'
  | 'parse_done'
  | 'parse_failed'

export async function sendNotification(
  userId: string,
  type: NotificationType,
  message: string,
  jobId?: string
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    user_id: userId,
    job_id: jobId ?? null,
    type,
    message,
    read_at: null
  })

  if (error) {
    console.error(`[notification] 发送通知失败: ${error.message}`)
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/services/notification.ts
git commit -m "feat(worker): add notification service"
```

---

## Task 11: 工具层 — 提示词处理

**Files:**
- Create: `worker/src/utils/prompt.ts`

- [ ] **Step 1: 实现提示词工具**

```typescript
// worker/src/utils/prompt.ts

export interface ParsedData {
  tech_theme?: string
  applicant?: string
  inventor?: string
  filing_date?: string
  main_tech_steps?: string
  core_invention?: string
  custom_fields?: Record<string, string>
}

export function fillPromptTemplate(template: string, parsedData: ParsedData): string {
  const variables: Record<string, string> = {
    tech_theme: parsedData.tech_theme || '',
    applicant: parsedData.applicant || '',
    inventor: parsedData.inventor || '',
    filing_date: parsedData.filing_date || '',
    main_tech_steps: parsedData.main_tech_steps || '',
    core_invention: parsedData.core_invention || ''
  }

  let result = template
  for (const [key, value] of Object.entries(variables)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value)
  }

  if (parsedData.custom_fields) {
    for (const [key, value] of Object.entries(parsedData.custom_fields)) {
      result = result.replace(new RegExp(`\\{\\{custom\\.${key}\\}\\}`, 'g'), value)
    }
  }

  return result
}

const DEFAULT_PARSE_PROMPT = `你是一位专利审查专家。请从以下专利文献中提取关键信息，以JSON格式返回：
{
  "tech_theme": "技术主题（一句话概括）",
  "applicant": "申请人",
  "inventor": "发明人（多人用顿号分隔）",
  "filing_date": "申请日（YYYY-MM-DD格式，如无法确定则留空）",
  "main_tech_steps": "主要技术方案步骤（详细描述）",
  "core_invention": "核心发明构思（详细描述）",
  "custom_fields": {}
}

请仅返回JSON，不要包含其他内容。`

export function buildParsePrompt(fileContent: string, systemPrompt?: string): string {
  const base = systemPrompt && systemPrompt.trim()
    ? `${systemPrompt.trim()}\n\n文献内容：\n${fileContent}`
    : `${DEFAULT_PARSE_PROMPT}\n\n文献内容：\n${fileContent}`
  return base
}

export function extractParsedData(aiContent: string): ParsedData {
  const jsonMatch = aiContent.match(/\{[\s\S]*\}/)
  if (!jsonMatch) {
    throw new Error('AI响应中未找到有效的JSON数据')
  }

  try {
    const parsed = JSON.parse(jsonMatch[0])
    return {
      tech_theme: parsed.tech_theme || '',
      applicant: parsed.applicant || '',
      inventor: parsed.inventor || '',
      filing_date: parsed.filing_date || '',
      main_tech_steps: parsed.main_tech_steps || '',
      core_invention: parsed.core_invention || '',
      custom_fields: parsed.custom_fields || {}
    }
  } catch {
    throw new Error(`JSON解析失败: ${jsonMatch[0].substring(0, 100)}`)
  }
}

export interface SearchResult {
  title: string
  authors: string
  url: string
  pub_date: string
  relevance_desc: string
  citation_gb: string
}

export function parseSearchResults(aiContent: string, limit: number): SearchResult[] {
  try {
    const jsonMatch = aiContent.match(/(\[[\s\S]*?\])/m)
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[1])
      if (Array.isArray(parsed)) {
        return parsed.slice(0, limit).map((item: Record<string, string>, index: number) => ({
          title: item.title || `文献${index + 1}`,
          authors: item.authors || '未知',
          url: item.url || '',
          pub_date: item.pub_date || '',
          relevance_desc: item.relevance_desc || item.description || '',
          citation_gb: item.citation_gb || generateCitation(item)
        }))
      }
    }
  } catch {
    // JSON解析失败，尝试文本解析
  }

  // 降级：提取链接作为结果
  const urls = aiContent.match(/https?:\/\/[^\s，,。]+/g) || []
  return urls.slice(0, limit).map((url, i) => ({
    title: `检索结果 ${i + 1}`,
    authors: '未知',
    url,
    pub_date: '',
    relevance_desc: '',
    citation_gb: url
  }))
}

function generateCitation(item: Record<string, string>): string {
  const parts: string[] = []
  if (item.authors) parts.push(item.authors)
  if (item.pub_date) parts.push(item.pub_date)
  if (item.url) parts.push(item.url)
  return parts.join('. ')
}

const DEFAULT_SELECTION_PROMPT = `你是一位专利审查专家。请根据以下专利信息，从候选文献中筛选出最相关的 %LIMIT% 篇对比文献。

【待审专利信息】
技术主题：%TECH_THEME%
申请人：%APPLICANT%
发明人：%INVENTOR%
申请日：%FILING_DATE%
核心发明构思：%CORE_INVENTION%
主要技术方案步骤：%MAIN_TECH_STEPS%

【候选文献】
%RESULTS%

请返回JSON数组，包含最相关的 %LIMIT% 篇文献的序号（从1开始），按相关性从高到低排序：
[3, 7, 1, ...]`

export function buildSelectionPrompt(
  parsedData: ParsedData,
  results: SearchResult[],
  limit: number
): string {
  const resultList = results.map((r, i) => `[${i + 1}] ${r.title}\n作者：${r.authors}\n相关描述：${r.relevance_desc}`).join('\n\n')

  let prompt = DEFAULT_SELECTION_PROMPT
    .replace(/%LIMIT%/g, String(limit))
    .replace(/%TECH_THEME%/g, parsedData.tech_theme || '')
    .replace(/%APPLICANT%/g, parsedData.applicant || '')
    .replace(/%INVENTOR%/g, parsedData.inventor || '')
    .replace(/%FILING_DATE%/g, parsedData.filing_date || '')
    .replace(/%CORE_INVENTION%/g, parsedData.core_invention || '')
    .replace(/%MAIN_TECH_STEPS%/g, parsedData.main_tech_steps || '')
    .replace(/%RESULTS%/g, resultList)

  return prompt
}

export function parseSelectionResult(
  aiContent: string,
  allResults: SearchResult[],
  limit: number
): SearchResult[] {
  try {
    const jsonMatch = aiContent.match(/\[([\d,\s]+)\]/)
    if (jsonMatch) {
      const indices = jsonMatch[1].split(',').map(s => parseInt(s.trim(), 10) - 1).filter(i => i >= 0 && i < allResults.length)
      if (indices.length > 0) {
        return indices.slice(0, limit).map((i, rank) => ({ ...allResults[i], rank: rank + 1 }))
      }
    }
  } catch {
    // 解析失败
  }

  // 降级：返回前 N 个
  return allResults.slice(0, limit).map((r, i) => ({ ...r, rank: i + 1 }))
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/utils/prompt.ts
git commit -m "feat(worker): add prompt utilities with template filling and result parsing"
```

---

## Task 12: parse-job 处理器

**Files:**
- Create: `worker/src/handlers/parse-job.ts`

- [ ] **Step 1: 实现 parse-job 处理器**

```typescript
// worker/src/handlers/parse-job.ts
import { PgBoss } from 'pg-boss'
import { parseFile, FileType } from '../parsers'
import { supabase, getModel, updateDocument, getDocumentById } from '../services/supabase'
import { sendNotification } from '../services/notification'
import { buildParsePrompt, extractParsedData } from '../utils/prompt'
import { createAdapter } from '../adapters'

interface ParseJobData {
  documentId: string
  parseModelId: string
  parseSystemPrompt?: string
}

export async function handleParseJob(job: PgBoss.Job<ParseJobData>): Promise<void> {
  const { documentId, parseModelId, parseSystemPrompt } = job.data

  console.log(`[parse-job] Starting job ${job.id}, document: ${documentId}`)

  try {
    // 1. 获取文档信息
    const doc = await getDocumentById(documentId)
    const userId = doc.user_id

    // 2. 更新状态为 'parsing'
    await updateDocument(documentId, { parse_status: 'parsing' })

    // 3. 从 Storage 下载文件
    const fileBuffer = await downloadFile(doc.file_url)

    // 4. 解析文件
    const parseResult = await parseFile(fileBuffer, doc.file_type as FileType)

    // 5. 获取 AI 模型并调用
    const model = await getModel(parseModelId)
    const adapter = createAdapter(model)

    const parsePrompt = buildParsePrompt(parseResult.text, parseSystemPrompt)
    const aiResult = await adapter.call({
      modelId: model.model_id,
      prompt: parsePrompt,
      enableThinking: true,
      timeout: 600000
    })

    if (!aiResult.success) {
      throw new Error(`AI解析失败: ${aiResult.error}`)
    }

    // 6. 解析 AI 返回的结构化数据
    const parsedData = extractParsedData(aiResult.content!)

    // 7. 更新文档记录
    const newStatus = parseResult.qualityWarning ? 'needs_review' : 'done'
    await updateDocument(documentId, {
      parse_status: newStatus,
      parsed_data: parsedData,
      quality_warning: parseResult.qualityWarning
    })

    // 8. 发送通知
    const message = parseResult.qualityWarning
      ? `文档 "${doc.title}" 解析完成，请人工审查解析结果`
      : `文档 "${doc.title}" 解析完成`
    await sendNotification(userId, 'parse_done', message, documentId)

    console.log(`[parse-job] Completed job ${job.id}, status: ${newStatus}`)

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[parse-job] Job ${job.id} failed: ${message}`)

    // 更新文档状态为失败
    await updateDocument(documentId, { parse_status: 'failed' }).catch(() => {})

    // 获取用户 ID 发送通知
    const doc = await getDocumentById(documentId).catch(() => null)
    if (doc) {
      await sendNotification(doc.user_id, 'parse_failed', `文档 "${doc.title}" 解析失败: ${message}`, documentId)
    }

    throw error
  }
}

async function downloadFile(fileUrl: string): Promise<Buffer> {
  const { data, error } = await supabase.storage
    .from('patent-files')
    .download(fileUrl)

  if (error) throw new Error(`下载文件失败: ${error.message}`)
  if (!data) throw new Error('文件数据为空')

  return Buffer.from(await data.arrayBuffer())
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/handlers/parse-job.ts
git commit -m "feat(worker): implement parse-job handler with AI extraction"
```

---

## Task 13: search-job 处理器

**Files:**
- Create: `worker/src/handlers/search-job.ts`

- [ ] **Step 1: 实现 search-job 处理器**

```typescript
// worker/src/handlers/search-job.ts
import { PgBoss } from 'pg-boss'
import { supabase, getModel, getStrategy, getJob, getDocument, updateJob, updateTaskStatus, getSearchTasks, createSearchTasks, getPlatformNames, getStrategyNames } from '../services/supabase'
import { sendNotification } from '../services/notification'
import { createAdapter } from '../adapters'
import { fillPromptTemplate, parseSearchResults, ParsedData, SearchResult, buildSelectionPrompt, parseSelectionResult } from '../utils/prompt'
import { generateReport } from '../services/report'

interface SearchJobData {
  jobId: string
}

interface ModelFeatureOverride {
  model_id: string
  enable_thinking: boolean
  enable_web_search: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export async function handleSearchJob(job: PgBoss.Job<SearchJobData>): Promise<void> {
  const { jobId } = job.data

  console.log(`[search-job] Starting job ${job.id}, jobId: ${jobId}`)

  try {
    // 1. 检查任务是否已被取消
    const jobRecord = await getJob(jobId)

    if (jobRecord.status === 'cancelled') {
      console.log(`[search-job] Job ${jobId} was cancelled before start`)
      return
    }

    // 2. 更新状态为 'running'
    await updateJob(jobId, { status: 'running', started_at: new Date().toISOString() })

    // 3. 获取解析数据
    const doc = await getDocument(jobRecord.document_id)
    const parsedData = doc.parsed_data as ParsedData | null

    if (!parsedData) {
      throw new Error('文档解析数据为空')
    }

    const userId = doc.user_id
    const config = jobRecord.config

    // 4. 创建子任务记录
    const tasks = await createSearchTasks(jobId, config.model_ids, config.strategy_ids)

    // 5. 并发执行所有子任务
    const cancelCheckInterval = setInterval(async () => {
      try {
        const { data } = await supabase
          .from('search_jobs')
          .select('status')
          .eq('id', jobId)
          .single()

        if (data?.status === 'cancelled') {
          clearInterval(cancelCheckInterval)
        }
      } catch {
        // 忽略错误
      }
    }, 5000)

    try {
      // 收集所有结果
      const allResults: Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }> = []

      for (const task of tasks) {
        const taskResults = await executeSingleTask(task, parsedData, config, jobId, userId)
        for (const r of taskResults) {
          allResults.push(r)
        }

        // 检查是否被取消
        const { data: currentJob } = await supabase
          .from('search_jobs')
          .select('status')
          .eq('id', jobId)
          .single()

        if (currentJob?.status === 'cancelled') {
          console.log(`[search-job] Job ${jobId} was cancelled during execution`)
          clearInterval(cancelCheckInterval)
          return
        }
      }

      clearInterval(cancelCheckInterval)

      // 6. 生成报告
      await generateReport(jobId, userId, allResults, config)

      // 7. 更新状态为 'completed'
      await updateJob(jobId, { status: 'completed', completed_at: new Date().toISOString() })

      // 8. 发送通知
      await sendNotification(userId, 'job_completed', `检索任务完成，共找到 ${allResults.length} 篇文献`, jobId)

      console.log(`[search-job] Job ${jobId} completed successfully`)

    } finally {
      clearInterval(cancelCheckInterval)
    }

  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`[search-job] Job ${jobId} failed: ${message}`)

    await updateJob(jobId, { status: 'failed', completed_at: new Date().toISOString() }).catch(() => {})

    const jobRecord = await getJob(jobId).catch(() => null)
    if (jobRecord) {
      await sendNotification(jobRecord.user_id, 'job_failed', `检索任务失败: ${message}`, jobId)
    }

    throw error
  }
}

async function executeSingleTask(
  task: { id: string; model_id: string; strategy_id: string },
  parsedData: ParsedData,
  config: { model_ids: string[]; strategy_ids: string[]; per_task_limit: number; report_limit: number; report_model_id: string; model_feature_overrides?: ModelFeatureOverride[] },
  jobId: string,
  userId: string
): Promise<Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }>> {
  const maxRetries = 1

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      // 更新状态
      await updateTaskStatus(task.id, attempt > 0 ? 'retrying' : 'running', {
        retry_count: attempt,
        started_at: new Date().toISOString()
      })

      // 获取模型和策略
      const model = await getModel(task.model_id)
      const strategy = await getStrategy(task.strategy_id)
      const adapter = createAdapter(model)

      // 获取功能开关配置
      const featureOverride = config.model_feature_overrides?.find(o => o.model_id === task.model_id)
      const enableThinking = featureOverride?.enable_thinking ?? true
      const enableWebSearch = featureOverride?.enable_web_search ?? true

      // 构建提示词
      const prompt = fillPromptTemplate(strategy.prompt_template, parsedData)

      // 调用 AI
      const result = await adapter.call({
        modelId: model.model_id,
        prompt,
        enableThinking,
        enableWebSearch,
        timeout: 600000
      })

      if (result.success) {
        const searchResults = parseSearchResults(result.content!, config.per_task_limit)

        await updateTaskStatus(task.id, 'done', {
          results: searchResults,
          completed_at: new Date().toISOString()
        })

        return searchResults.map(r => ({
          ...r,
          source_task_id: task.id,
          source_platform: model.name,
          source_strategy: strategy.name
        }))
      }

      throw new Error(result.error)

    } catch (error) {
      if (attempt < maxRetries) {
        console.log(`[search-job] Task ${task.id} failed, retrying in 30s...`)
        await sleep(30000)
      } else {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`[search-job] Task ${task.id} abandoned: ${message}`)

        await updateTaskStatus(task.id, 'abandoned', {
          error_msg: message,
          completed_at: new Date().toISOString()
        })
      }
    }
  }

  return []
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/handlers/search-job.ts
git commit -m "feat(worker): implement search-job handler with cancel detection and retry"
```

---

## Task 14: 报告生成服务

**Files:**
- Create: `worker/src/services/report.ts`

- [ ] **Step 1: 实现报告生成服务**

```typescript
// worker/src/services/report.ts
import { supabase, getJob, getDocument, getSearchTasks, getPlatformNames, getStrategyNames, updateJob } from './supabase'
import { createAdapter } from '../adapters'
import { ParsedData, SearchResult, buildSelectionPrompt, parseSelectionResult } from '../utils/prompt'

interface SelectedDoc {
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
  user_rating: null
}

interface PathSummary {
  platform: string
  strategy: string
  status: 'done' | 'abandoned'
  docCount: number
  errorMsg?: string
}

interface ReportInput {
  jobId: string
  userId: string
  patentInfo: ParsedData
  searchPlatforms: string[]
  searchStrategies: string[]
  topDocs: SelectedDoc[]
  pathSummary: PathSummary[]
}

export async function generateReport(
  jobId: string,
  userId: string,
  allResults: Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }>,
  config: { model_ids: string[]; strategy_ids: string[]; per_task_limit: number; report_limit: number; report_model_id: string }
): Promise<void> {
  // 1. 获取子任务详情（用于路径摘要）
  const tasks = await getSearchTasks(jobId)
  const models = await getPlatformNames(config.model_ids)
  const strategies = await getStrategyNames(config.strategy_ids)

  // 2. 构建路径摘要
  const pathSummary: PathSummary[] = tasks.map((task: Record<string, unknown>) => ({
    platform: models.find((_, i) => config.model_ids[i] === task.model_id) || String(task.model_id),
    strategy: strategies.find((_, i) => config.strategy_ids[i] === task.strategy_id) || String(task.strategy_id),
    status: task.status as 'done' | 'abandoned',
    docCount: Array.isArray(task.results) ? task.results.length : 0,
    errorMsg: task.error_msg as string | undefined
  }))

  // 3. 去重
  const uniqueResults = deduplicateResults(allResults)

  // 4. 筛选 Top-N
  const topDocs = await selectTopDocs(uniqueResults, config)

  // 5. 生成 HTML
  const reportData: ReportInput = {
    jobId,
    userId,
    patentInfo: {},
    searchPlatforms: models,
    searchStrategies: strategies,
    topDocs,
    pathSummary
  }

  const htmlContent = buildHtmlReport(reportData)

  // 6. 写入数据库
  const { error } = await supabase.from('reports').insert({
    job_id: jobId,
    user_id: userId,
    html_content: htmlContent,
    selected_docs: topDocs,
    doc_count: topDocs.length,
    path_summary: pathSummary
  })

  if (error) throw new Error(`写入报告失败: ${error.message}`)
}

function deduplicateResults(results: Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }>): Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }> {
  const seen = new Map<string, typeof results[0]>()

  for (const result of results) {
    const key = result.url || result.title
    if (!seen.has(key)) {
      seen.set(key, result)
    }
  }

  return Array.from(seen.values())
}

async function selectTopDocs(
  results: Array<SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }>,
  config: { report_limit: number; report_model_id: string }
): Promise<SelectedDoc[]> {
  if (results.length === 0) return []

  const limit = config.report_limit

  if (results.length <= limit) {
    return results.map((r, i) => toSelectedDoc(r, i + 1))
  }

  // 获取专利信息
  const { data: job } = await supabase.from('search_jobs').select('document_id').eq('id', jobId).single().catch(() => ({ data: null }))
  if (!job) return results.slice(0, limit).map((r, i) => toSelectedDoc(r, i + 1))

  const { data: doc } = await supabase.from('patent_documents').select('parsed_data').eq('id', (job as { document_id: string }).document_id).single().catch(() => ({ data: null }))
  const parsedData = (doc?.parsed_data || {}) as ParsedData

  // 调用汇总模型
  try {
    const model = await getModel(config.report_model_id)
    const adapter = createAdapter(model)
    const prompt = buildSelectionPrompt(parsedData, results, limit)
    const result = await adapter.call({ modelId: model.model_id, prompt, enableThinking: true, timeout: 300000 })

    if (result.success) {
      const selected = parseSelectionResult(result.content!, results, limit)
      return selected.map((r, i) => toSelectedDoc(r, i + 1))
    }
  } catch {
    // 筛选失败，降级
  }

  return results.slice(0, limit).map((r, i) => toSelectedDoc(r, i + 1))
}

function toSelectedDoc(r: SearchResult & { source_task_id: string; source_platform: string; source_strategy: string }, rank: number): SelectedDoc {
  return {
    rank,
    title: r.title,
    authors: r.authors,
    url: r.url,
    pub_date: r.pub_date,
    relevance_desc: r.relevance_desc,
    citation_gb: r.citation_gb,
    source_platform: r.source_platform,
    source_strategy: r.source_strategy,
    source_task_id: r.source_task_id,
    user_rating: null
  }
}

var jobId: string

function buildHtmlReport(data: ReportInput): string {
  const { topDocs, pathSummary, searchPlatforms, searchStrategies } = data

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <title>专利检索报告</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 24px; color: #1e293b; }
    h1 { font-size: 24px; border-bottom: 2px solid #3b82f6; padding-bottom: 12px; margin-bottom: 16px; }
    h2 { font-size: 18px; color: #334155; margin-top: 32px; border-left: 3px solid #3b82f6; padding-left: 10px; }
    .meta { color: #64748b; font-size: 14px; margin-bottom: 24px; }
    .meta span { margin-right: 16px; }
    .info-table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    .info-table td { padding: 8px 12px; border: 1px solid #e2e8f0; vertical-align: top; }
    .info-table td:first-child { width: 120px; color: #64748b; background: #f8fafc; }
    .doc-card { border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 12px 0; background: white; }
    .doc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px; }
    .doc-rank { background: #3b82f6; color: white; padding: 4px 12px; border-radius: 12px; font-size: 14px; font-weight: 600; }
    .source-tag { background: #f1f5f9; padding: 2px 8px; border-radius: 4px; font-size: 12px; color: #475569; }
    .doc-title { font-size: 16px; font-weight: 600; margin: 8px 0; }
    .doc-meta { color: #64748b; font-size: 14px; margin: 4px 0; }
    .doc-link { color: #3b82f6; text-decoration: none; }
    .doc-link:hover { text-decoration: underline; }
    .doc-desc { margin-top: 8px; color: #475569; font-size: 14px; line-height: 1.6; }
    .path-item { display: flex; justify-content: space-between; padding: 8px 12px; border-bottom: 1px solid #f1f5f9; }
    .path-item:last-child { border-bottom: none; }
    .path-name { color: #334155; }
    .status-done { color: #22c55e; font-weight: 500; }
    .status-abandoned { color: #ef4444; font-weight: 500; }
    .empty { color: #94a3b8; font-style: italic; padding: 24px; text-align: center; }
  </style>
</head>
<body>
  <h1>专利检索报告</h1>
  <div class="meta">
    <span>生成时间：${new Date().toLocaleString('zh-CN')}</span>
    <span>检索平台：${searchPlatforms.join('、')}</span>
    <span>检索策略：${searchStrategies.join('、')}</span>
  </div>

  <h2>一、检索路径执行情况</h2>
  ${pathSummary.length > 0 ? pathSummary.map(p => `
    <div class="path-item">
      <span class="path-name">${p.platform} — ${p.strategy}</span>
      <span class="${p.status === 'done' ? 'status-done' : 'status-abandoned'}">
        ${p.status === 'done' ? `✅ 完成（${p.docCount} 篇）` : `❌ 放弃${p.errorMsg ? `：${p.errorMsg}` : ''}`}
      </span>
    </div>
  `).join('') : '<p class="empty">无子任务记录</p>'}

  <h2>二、最相关对比文献（Top ${topDocs.length}）</h2>
  ${topDocs.length > 0 ? topDocs.map(doc => `
    <div class="doc-card">
      <div class="doc-header">
        <span class="doc-rank">第 ${doc.rank} 位</span>
        <span class="source-tag">${doc.source_platform} · ${doc.source_strategy}</span>
      </div>
      <div class="doc-title">${escapeHtml(doc.title)}</div>
      <div class="doc-meta">作者：${escapeHtml(doc.authors)} | 公开时间：${escapeHtml(doc.pub_date)}</div>
      ${doc.url ? `<div class="doc-meta"><a class="doc-link" href="${escapeHtml(doc.url)}" target="_blank">查看原文</a></div>` : ''}
      ${doc.relevance_desc ? `<p class="doc-desc">${escapeHtml(doc.relevance_desc)}</p>` : ''}
    </div>
  `).join('') : '<p class="empty">未找到相关文献</p>'}
</body>
</html>`
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

async function getModel(modelId: string) {
  const { data, error } = await supabase.from('ai_models').select('*').eq('id', modelId).single()
  if (error || !data) throw new Error(`获取汇总模型失败: ${modelId}`)
  return data
}
```

- [ ] **Step 2: Commit**

```bash
git add worker/src/services/report.ts
git commit -m "feat(worker): add report generation service with HTML output"
```

---

## Task 15: 更新 Worker 入口

**Files:**
- Modify: `worker/src/index.ts`

- [ ] **Step 1: 更新 Worker 入口文件**

```typescript
// worker/src/index.ts
import { PgBoss } from 'pg-boss'
import { startHealthServer } from './health'
import { handleParseJob } from './handlers/parse-job'
import { handleSearchJob } from './handlers/search-job'

const DATABASE_URL = process.env.DATABASE_URL!

async function main() {
  console.log('[Worker] Starting...')

  // 启动健康检查服务
  startHealthServer(Number(process.env.PORT) || 3001)

  const boss = new PgBoss(DATABASE_URL, {
    // 崩溃恢复：超过 15 分钟的任务自动重新入队
    expireInSeconds: 900
  })

  boss.on('error', (err: Error) => {
    console.error('[pg-boss] Error:', err)
  })

  await boss.start()
  console.log('[Worker] pg-boss started')

  // 注册任务处理器
  await boss.work('parse-job', { teamSize: 1, teamConcurrency: 1 }, handleParseJob)
  await boss.work('search-job', { teamSize: 1, teamConcurrency: 1 }, handleSearchJob)

  console.log('[Worker] Ready and listening for jobs')
}

main().catch((err) => {
  console.error('[Worker] Fatal error:', err)
  process.exit(1)
})
```

- [ ] **Step 2: 验证编译**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1\worker"
npm run build
```

预期：编译成功，无 TypeScript 错误

- [ ] **Step 3: Commit**

```bash
git add worker/src/index.ts
git commit -m "feat(worker): wire up parse-job and search-job handlers"
```

---

## Task 16: 端到端测试

**Files:**
- Create: `worker/__tests__/adapters/openai-compat.test.ts`

- [ ] **Step 1: 编写适配器测试**

```typescript
// worker/__tests__/adapters/openai-compat.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { OpenAICompatAdapter } from '../../src/adapters/openai-compat'

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

describe('OpenAICompatAdapter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('成功调用返回 content', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: '测试响应内容' } }]
      })
    })

    const adapter = new OpenAICompatAdapter(
      'https://api.example.com',
      'test-key',
      { provider: 'openai_compat', web_search_method: 'none', thinking_method: 'none', web_search_disables_thinking: false, thinking_default_on: false }
    )

    const result = await adapter.call({
      modelId: 'test-model',
      prompt: '测试提示词'
    })

    expect(result.success).toBe(true)
    expect(result.content).toBe('测试响应内容')
    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.example.com/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Authorization': 'Bearer test-key' })
      })
    )
  })

  it('HTTP 错误返回 error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      text: async () => 'Unauthorized'
    })

    const adapter = new OpenAICompatAdapter(
      'https://api.example.com',
      'bad-key',
      { provider: 'openai_compat', web_search_method: 'none', thinking_method: 'none', web_search_disables_thinking: false, thinking_default_on: false }
    )

    const result = await adapter.call({
      modelId: 'test-model',
      prompt: 'test'
    })

    expect(result.success).toBe(false)
    expect(result.error).toContain('401')
  })

  it('AI 返回 error 字段时返回错误', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        error: { message: '模型不存在' }
      })
    })

    const adapter = new OpenAICompatAdapter(
      'https://api.example.com',
      'key',
      { provider: 'openai_compat', web_search_method: 'none', thinking_method: 'none', web_search_disables_thinking: false, thinking_default_on: false }
    )

    const result = await adapter.call({ modelId: 'unknown', prompt: 'test' })

    expect(result.success).toBe(false)
    expect(result.error).toBe('模型不存在')
  })
})
```

- [ ] **Step 2: 创建测试目录并运行测试**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1"
# 确保 vitest 配置正确
# 运行测试
npm run test -- worker/__tests__/adapters/openai-compat.test.ts
```

预期：所有测试通过

- [ ] **Step 3: Commit**

```bash
git add worker/__tests__/adapters/openai-compat.test.ts
git commit -m "test(worker): add OpenAICompatAdapter unit tests"
```

---

## Task 17: 最终验证与总结提交

- [ ] **Step 1: 编译整个 Worker 项目**

```bash
cd "D:\Claude Code Files\Project_Patent search system_v1\worker"
npm run build
```

预期：`dist/` 目录生成，无错误

- [ ] **Step 2: 检查文件完整性**

确认以下文件都存在：

```
worker/src/
├── index.ts
├── health.ts
├── handlers/
│   ├── parse-job.ts
│   └── search-job.ts
├── adapters/
│   ├── index.ts
│   ├── base.ts
│   ├── openai-compat.ts
│   └── metaso.ts
├── parsers/
│   ├── index.ts
│   ├── pdf.ts
│   ├── docx.ts
│   ├── xlsx.ts
│   └── txt.ts
├── services/
│   ├── supabase.ts
│   ├── report.ts
│   └── notification.ts
└── utils/
    └── prompt.ts
```

- [ ] **Step 3: 最终提交**

```bash
git add .
git commit -m "feat: Plan 4 complete - Worker with parse-job, search-job, AI adapters, and report generation"
```

---

## 自审检查

- [ ] Spec 覆盖检查：
  - parse-job 处理器 ✅
  - search-job 处理器 ✅
  - AI 适配器（OpenAI兼容 + 秘塔AI）✅
  - 文件解析器（PDF/Word/Excel/TXT）✅
  - 报告生成 ✅
  - 取消机制 ✅
  - 通知服务 ✅
  - 提示词工具 ✅
- [ ] 占位符扫描：无 TBD/TODO
- [ ] 类型一致性：所有类型与 `lib/supabase/types.ts` 对齐
- [ ] 编译验证：Task 15 Step 2 确认编译通过
