// worker/src/services/web-search.ts
// 适配器 agentic 联网的搜索后端封装。
// DeepSeek/MiniMax 的模型 API 不提供服务端网页搜索，由本模块代为执行真实搜索，
// 结果以 {title,url,snippet,raw_content,pub_date,score} 形式回灌进 LLM 的 tool 消息，实现"真联网"。
//
// 目前只实现 Tavily 一个 provider；通过 WEB_SEARCH_PROVIDER 环境变量路由，未来可扩展 Bing/Serper 等。

import { withTimeout } from '../utils/retry'

export interface WebSearchHit {
  title: string
  url: string
  snippet: string
  /** Tavily advanced 深度返回的正文 markdown（已按 WEB_SEARCH_RAW_CONTENT_MAX_CHARS 截断） */
  raw_content?: string
  pub_date?: string
  /** Tavily 相关性评分（0-1），越高越相关；basic 深度可能缺失 */
  score?: number
}

const TAVILY_ENDPOINT = 'https://api.tavily.com/search'

/** 权威专利/学术域名白名单（默认值；可用 WEB_SEARCH_INCLUDE_DOMAINS 覆盖/追加） */
const DEFAULT_PATENT_INCLUDE_DOMAINS = [
  // 专利局
  'patents.google.com',
  'patentcenter.uspto.gov',
  'ppubs.uspto.gov',
  'worldwide.espacenet.com',
  'data.epo.org',
  'patentscope.wipo.int',
  'www.wipo.int',
  'pss-system.cponline.cnipa.gov.cn',
  'www.cnipa.gov.cn',
  'epub.cnipa.gov.cn',
  'www.soopat.com',
  'www.xinzhihua.com',
  'www.patenthub.cn',
  // 中文学术
  'www.cnki.net',
  'kns.cnki.net',
  'www.wanfangdata.com.cn',
  'd.wanfangdata.com.cn',
  'www.cqvip.com',
  // 英文学术
  'arxiv.org',
  'doi.org',
  'www.semanticscholar.org',
  'ieeexplore.ieee.org',
  'dl.acm.org',
  'www.nature.com',
  'www.science.org',
  'link.springer.com',
  'www.sciencedirect.com',
  'onlinelibrary.wiley.com',
  'pubmed.ncbi.nlm.nih.gov',
  'www.ncbi.nlm.nih.gov',
]

/** 默认黑名单：高噪声/SEO 站点（可用 WEB_SEARCH_EXCLUDE_DOMAINS 追加） */
const DEFAULT_EXCLUDE_DOMAINS = [
  'zhihu.com',
  'zhuanlan.zhihu.com',
  'blog.csdn.net',
  'jianshu.com',
  'juejin.cn',
  'baidu.com',
  'wenku.baidu.com',
  'docin.com',
  'doc88.com',
  'mbalib.com',
  'qcc.com',
  'tianyancha.com',
  'crunchbase.com',
]

type SearchDepth = 'ultra-fast' | 'fast' | 'basic' | 'advanced'

interface TavilySearchOptions {
  depth?: SearchDepth
  maxResults?: number
  /** 返回 raw_content（markdown 正文）；advanced/fast 深度生效，basic 不返回 */
  includeRawContent?: boolean
  chunksPerSource?: number
  includeDomains?: string[]
  excludeDomains?: string[]
  topic?: 'general' | 'news' | 'finance'
  timeRange?: 'day' | 'week' | 'month' | 'year'
  country?: string
  includeAnswer?: boolean | 'basic' | 'advanced'
}

/** 从逗号分隔的环境变量解析域名列表，自动去空、去 www. 前缀差异，小写 */
function parseDomainList(envVal: string | undefined, defaults: string[]): string[] {
  const fromEnv = (envVal ?? '')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter(Boolean)
  const merged = [...defaults, ...fromEnv]
  // 简单去重
  return Array.from(new Set(merged))
}

function readPositiveInt(env: string, defaultValue: number): number {
  const raw = process.env[env]
  if (!raw) return defaultValue
  const n = parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : defaultValue
}

/**
 * 调用 Tavily 搜索 API。
 * 文档：https://docs.tavily.com/documentation/api-reference/endpoint/search
 */
async function tavilySearch(
  query: string,
  signal: AbortSignal,
  opts: TavilySearchOptions = {}
): Promise<WebSearchHit[]> {
  const apiKey = process.env.WEB_SEARCH_API_KEY
  if (!apiKey) throw new Error('WEB_SEARCH_API_KEY 未配置，无法执行 agentic 联网搜索')

  // 环境变量配置（与入参 opts 合并，opts 优先）
  const envDepth = (process.env.WEB_SEARCH_DEPTH || 'advanced').toLowerCase() as SearchDepth
  const depth = opts.depth ?? (['ultra-fast', 'fast', 'basic', 'advanced'].includes(envDepth) ? envDepth : 'advanced')
  const maxResults = opts.maxResults ?? readPositiveInt('WEB_SEARCH_MAX_RESULTS', 15)
  const includeRawContent = opts.includeRawContent ?? (process.env.WEB_SEARCH_INCLUDE_RAW_CONTENT !== 'false')
  const chunksPerSource = opts.chunksPerSource ?? readPositiveInt('WEB_SEARCH_CHUNKS_PER_SOURCE', 3)
  const topic = opts.topic ?? ((process.env.WEB_SEARCH_TOPIC as 'general' | 'news' | 'finance') || undefined)
  const timeRange = opts.timeRange ?? ((process.env.WEB_SEARCH_TIME_RANGE as 'day' | 'week' | 'month' | 'year') || undefined)
  const country = opts.country ?? (process.env.WEB_SEARCH_COUNTRY || undefined)
  const includeAnswer = opts.includeAnswer ?? ((process.env.WEB_SEARCH_INCLUDE_ANSWER || 'false') as 'false' | 'true' | 'basic' | 'advanced')
  const answer = includeAnswer === true ? 'advanced' : includeAnswer === false || includeAnswer === 'false' ? false : includeAnswer

  // 域名列表：默认白/黑名单 + WEB_SEARCH_INCLUDE_DOMAINS 环境变量追加
  // 若显式设置了 WEB_SEARCH_INCLUDE_DOMAINS=* （或显式传 opts.includeDomains=[]），则不使用白名单
  const envIncludeRaw = process.env.WEB_SEARCH_INCLUDE_DOMAINS
  const includeDomains = opts.includeDomains !== undefined
    ? opts.includeDomains
    : (envIncludeRaw === '*' ? [] : parseDomainList(envIncludeRaw, DEFAULT_PATENT_INCLUDE_DOMAINS))
  const excludeDomains = opts.excludeDomains ?? parseDomainList(process.env.WEB_SEARCH_EXCLUDE_DOMAINS, DEFAULT_EXCLUDE_DOMAINS)

  // raw_content 截断上限（字符数，粗略按 1 字符≈0.5 token 估算）
  const rawContentMaxChars = readPositiveInt('WEB_SEARCH_RAW_CONTENT_MAX_CHARS', 1200)

  const body: Record<string, unknown> = {
    api_key: apiKey,
    query,
    search_depth: depth,
    max_results: maxResults,
    include_answer: answer,
  }
  if (includeRawContent && (depth === 'advanced' || depth === 'fast')) {
    body.include_raw_content = true
    body.chunks_per_source = chunksPerSource
  }
  if (includeDomains.length > 0) body.include_domains = includeDomains
  if (excludeDomains.length > 0) body.exclude_domains = excludeDomains
  if (topic) body.topic = topic
  if (timeRange) body.time_range = timeRange
  if (country) body.country = country

  const res = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Tavily HTTP ${res.status}: ${text.slice(0, 300)}`)
  }

  const data = await res.json() as {
    results?: Array<{
      title?: string
      url?: string
      content?: string
      raw_content?: string
      published_date?: string
      score?: number
    }>
    answer?: string
  }

  const hits: WebSearchHit[] = (data.results ?? []).map(r => {
    let raw = r.raw_content
    if (raw && raw.length > rawContentMaxChars) {
      raw = raw.slice(0, rawContentMaxChars) + '…（原文过长已截断）'
    }
    return {
      title: r.title || '',
      url: r.url || '',
      snippet: r.content || '',
      raw_content: raw || undefined,
      pub_date: r.published_date,
      score: typeof r.score === 'number' ? r.score : undefined,
    }
  })

  // 按 Tavily 返回的 score 降序排序（basic 深度部分响应可能不带 score，保持原序）
  hits.sort((a, b) => (b.score ?? -1) - (a.score ?? -1))

  return hits
}

export interface WebSearchOptions extends TavilySearchOptions {
  /** 单次搜索超时（毫秒），默认 15000；advanced 深度比 basic 慢，给足时间 */
  timeoutMs?: number
}

/**
 * 执行网页搜索（按 WEB_SEARCH_PROVIDER 路由，默认 tavily）。
 * 包超时上限，保证 agentic 循环不会被搜索后端拖死。
 */
export async function webSearch(
  query: string,
  signal: AbortSignal,
  opts: WebSearchOptions = {}
): Promise<WebSearchHit[]> {
  const provider = (process.env.WEB_SEARCH_PROVIDER || 'tavily').toLowerCase()

  let fn: (q: string, s: AbortSignal, o?: TavilySearchOptions) => Promise<WebSearchHit[]>
  if (provider === 'tavily') {
    fn = tavilySearch
  } else {
    throw new Error(`不支持的 WEB_SEARCH_PROVIDER: ${provider}`)
  }

  const timeoutMs = opts.timeoutMs ?? readPositiveInt('WEB_SEARCH_TIMEOUT_MS', 15000)
  return withTimeout(fn(query, signal, opts), timeoutMs, 'web_search')
}
