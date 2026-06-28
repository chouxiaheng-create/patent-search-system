// worker/src/services/web-search.ts
// 适配器 agentic 联网的搜索后端封装。
// DeepSeek/MiniMax 的模型 API 不提供服务端网页搜索，由本模块代为执行真实搜索，
// 结果以 {title,url,snippet,pub_date} 形式回灌进 LLM 的 tool 消息，实现"真联网"。

import { withTimeout } from '../utils/retry'

export interface WebSearchHit {
  title: string
  url: string
  snippet: string
  pub_date?: string
}

const TAVILY_ENDPOINT = 'https://api.tavily.com/search'

/**
 * 调用 Tavily 搜索 API。
 * 文档：https://docs.tavily.com/docs/rest-api/api-reference
 */
async function tavilySearch(query: string, signal: AbortSignal): Promise<WebSearchHit[]> {
  const apiKey = process.env.WEB_SEARCH_API_KEY
  if (!apiKey) throw new Error('WEB_SEARCH_API_KEY 未配置，无法执行 agentic 联网搜索')

  const res = await fetch(TAVILY_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: apiKey,
      query,
      search_depth: 'basic',
      max_results: 10,
      include_answer: false,
    }),
    signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Tavily HTTP ${res.status}: ${text}`)
  }

  const data = await res.json() as {
    results?: Array<{ title?: string; url?: string; content?: string; published_date?: string }>
  }

  return (data.results ?? []).map(r => ({
    title: r.title || '',
    url: r.url || '',
    snippet: r.content || '',
    pub_date: r.published_date,
  }))
}

/**
 * 执行网页搜索（按 WEB_SEARCH_PROVIDER 路由，默认 tavily）。
 * 包 8s 超时上限，保证 agentic 循环不会被搜索后端拖死。
 */
export async function webSearch(query: string, signal: AbortSignal): Promise<WebSearchHit[]> {
  const provider = (process.env.WEB_SEARCH_PROVIDER || 'tavily').toLowerCase()

  let fn: (q: string, s: AbortSignal) => Promise<WebSearchHit[]>
  if (provider === 'tavily') {
    fn = tavilySearch
  } else {
    throw new Error(`不支持的 WEB_SEARCH_PROVIDER: ${provider}`)
  }

  return withTimeout(fn(query, signal), 8000, 'web_search')
}
