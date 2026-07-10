// worker/src/services/enrichment.ts
// 检索结果元数据富化：按 URL/title 从权威结构化源回填 authors/pub_date。
// 全程无 LLM 调用（防幻觉）；只填不覆写；S2 按标题需相似度守卫。
// 集成在 executeSingleTask 的 filterByQuality 之前（质量优先），质量分由 filterByQuality 重算。
import type { SearchResult } from '../utils/prompt'
import { normalizeDate } from '../utils/prompt'
import { withTimeout, callWithRetry } from '../utils/retry'

export interface Meta {
  authors?: string
  pub_date?: string
  source?: string
}

const STEP_TIMEOUT_MS = 8000
const ENRICH_CONCURRENCY = 3
/** S2 按标题匹配的相似度阈值（≥ 才采信，防张冠李戴） */
const TITLE_SIM_THRESHOLD = 0.85
const PAGE_MAX_BYTES = 500_000

/** 需要补作者：空 / "未知" */
function needsAuthor(r: { authors: string }): boolean {
  const a = r.authors
  return !a || a.trim() === '' || a === '未知'
}
/** 需要补日期：空 */
function needsDate(r: { pub_date: string }): boolean {
  return !r.pub_date || r.pub_date.trim() === ''
}

/**
 * 对结果数组富化（仅对缺 authors/pub_date 的项发请求；两字段都已填的跳过）。
 * 并发限 ENRICH_CONCURRENCY，避免冲击 S2/arXiv 限流。
 */
export async function enrichMetadata(results: SearchResult[]): Promise<SearchResult[]> {
  if (!results.some(r => needsAuthor(r) || needsDate(r))) return results
  return mapWithConcurrency(results, ENRICH_CONCURRENCY, enrichOne)
}

/** 单条结果富化：按优先级链尝试各源，取到即填、两字段填满即停；全程失败则保持原值。 */
export async function enrichOne(r: SearchResult): Promise<SearchResult> {
  if (!needsAuthor(r) && !needsDate(r)) return r

  const acc = { authors: r.authors, pub_date: r.pub_date, source: r.metadata_source }
  const needMore = () => needsAuthor(acc) || needsDate(acc)

  const arxivId = extractArxivId(r.url)
  const doi = extractDoi(r.url)
  const s2id = extractS2Id(r.url)
  const isPublicUrl = !!r.url && /^https?:\/\//i.test(r.url) && !isPrivateUrl(r.url)

  const steps: Array<() => Promise<Meta>> = []
  if (arxivId) steps.push(() => fetchArxiv(arxivId))
  if (doi) steps.push(() => fetchCrossref(doi))
  if (s2id) steps.push(() => fetchS2ByPaperId(s2id))
  if (isPublicUrl && !arxivId && !doi && !s2id) steps.push(() => fetchPageMeta(r.url))
  // 最后手段：按标题查 S2（带相似度守卫）
  if (needMore() && r.title) steps.push(() => fetchS2ByTitle(r.title))

  for (const step of steps) {
    if (!needMore()) break
    const m = await tryFetch(step)
    if (!m) continue
    if (needsAuthor(acc) && m.authors) { acc.authors = m.authors; acc.source = m.source || acc.source }
    if (needsDate(acc) && m.pub_date) { acc.pub_date = m.pub_date; if (!acc.source) acc.source = m.source }
  }

  return { ...r, authors: acc.authors, pub_date: acc.pub_date, metadata_source: acc.source }
}

/** 带超时 + 429 退避的请求包装；失败返回 null（调用方顺延） */
async function tryFetch<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await withTimeout(callWithRetry(fn, { maxRetries: 2, baseDelayMs: 1000 }), STEP_TIMEOUT_MS, 'enrich')
  } catch {
    return null
  }
}

// ---------- 标识符提取 ----------

export function extractArxivId(url: string): string | null {
  if (!url) return null
  const m = url.match(/arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5}(?:v[0-9]+)?|[a-z-]+\/[0-9]{7})/i)
  return m ? m[1] : null
}

export function extractDoi(url: string): string | null {
  if (!url) return null
  // DOI 形如 10.<registrant>/<suffix>，suffix 可含 / . - 等；到空白/?/# 为止
  const m = url.match(/(?:dx\.)?doi\.org\/(10\.[0-9]{4,9}\/[^\s?#]+)/i)
  if (m) return decodeURIComponent(m[1].replace(/[/-]+$/, ''))
  // 识别 URL 内嵌的 DOI（如出版社页面路径里带 DOI）
  const m2 = url.match(/(10\.[0-9]{4,9}\/[^\s?#]+)/)
  return m2 ? m2[1].replace(/[/-]+$/, '') : null
}

export function extractS2Id(url: string): string | null {
  if (!url) return null
  const m = url.match(/semanticscholar\.org\/(?:paper|article)\/[^/]*\/?([0-9a-f]{40})/i)
  return m ? m[1] : null
}

// ---------- arXiv ----------

export function parseArxiv(xml: string): Meta {
  const authors = Array.from(xml.matchAll(/<author>[\s\S]*?<name>\s*([^<]+?)\s*<\/name>[\s\S]*?<\/author>/g))
    .map(m => m[1].trim())
  const pubMatch = xml.match(/<published>([^<]+)<\/published>/)
  const pub_date = pubMatch ? normalizeDate(pubMatch[1].substring(0, 10)) : ''
  return { authors: uniq(authors).join(';'), pub_date, source: 'arXiv' }
}

async function fetchArxiv(id: string): Promise<Meta> {
  const res = await fetch(`http://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`)
  if (!res.ok) throw new Error(`arXiv ${res.status}`)
  return parseArxiv(await res.text())
}

// ---------- Crossref (DOI) ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseCrossrefMessage(msg: any): Meta {
  const authorArr = Array.isArray(msg?.author) ? msg.author : []
  const authors = authorArr
    .map((a: any) => [a?.given, a?.family].filter(Boolean).join(' '))
    .filter(Boolean)
    .join(';')
  const dp = msg?.['published-print']?.['date-parts']?.[0]
    || msg?.['published-online']?.['date-parts']?.[0]
    || msg?.created?.['date-parts']?.[0]
    || msg?.issued?.['date-parts']?.[0]
  const pub_date = Array.isArray(dp) && dp.length ? normalizeDate(dp.join('-')) : ''
  return { authors, pub_date, source: 'Crossref' }
}

async function fetchCrossref(doi: string): Promise<Meta> {
  const res = await fetch(`https://api.crossref.org/works/${encodeURIComponent(doi)}`)
  if (!res.ok) throw new Error(`Crossref ${res.status}`)
  const j = await res.json() as any
  return parseCrossrefMessage(j?.message)
}

// ---------- Semantic Scholar ----------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function parseS2Paper(j: any): Meta {
  const authorArr = Array.isArray(j?.authors) ? j.authors : []
  const authors = authorArr.map((a: any) => a?.name).filter(Boolean).join(';')
  const pub_date = j?.year ? `${j.year}-01-01` : ''
  return { authors, pub_date, source: 'Semantic Scholar' }
}

async function fetchS2ByPaperId(id: string): Promise<Meta> {
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/${encodeURIComponent(id)}?fields=authors,year`)
  if (!res.ok) throw new Error(`S2 ${res.status}`)
  return parseS2Paper(await res.json() as any)
}

async function fetchS2ByTitle(title: string): Promise<Meta> {
  const res = await fetch(`https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(title)}&limit=1&fields=title,authors,year`)
  if (!res.ok) throw new Error(`S2search ${res.status}`)
  const j = await res.json() as any
  const paper = Array.isArray(j?.data) && j.data[0] ? j.data[0] : null
  if (!paper) return {}
  // 守卫：标题不一致不采信（防张冠李戴）
  if (titleSimilarity(title, paper.title || '') < TITLE_SIM_THRESHOLD) return {}
  const m = parseS2Paper(paper)
  m.source = 'Semantic Scholar(title)'
  return m
}

// ---------- 通用网页 meta + JSON-LD（含专利）----------

export function parsePageMeta(html: string): Meta {
  const authorMetas = [
    ...matchAllMeta(html, 'citation_author'),
    ...matchAllMeta(html, 'DC.creator'),
    ...matchAllMeta(html, 'article:author'),
    ...matchAllMeta(html, 'og:article:author'),
  ]
  const ldAuthors = parseJsonLdAuthors(html)
  const authors = uniq([...authorMetas, ...ldAuthors].filter(a => a && a !== '未知'))

  const dateMeta =
    matchMeta(html, 'citation_publication_date')
    || matchMeta(html, 'citation_date')
    || matchMeta(html, 'DC.date')
    || matchMeta(html, 'article:published_time')
    || matchMeta(html, 'og:article:published_time')
    || matchMeta(html, 'prism.publicationDate')
  const ldDate = parseJsonLdDate(html)
  const pub_date = normalizeDate(dateMeta || ldDate || '')

  return { authors: authors.join(';'), pub_date, source: '页面meta' }
}

async function fetchPageMeta(url: string): Promise<Meta> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'PatentSearchBot/1.0 (+metadata enrichment)' },
    redirect: 'follow',
  })
  if (!res.ok) throw new Error(`pageMeta ${res.status}`)
  const full = await res.text()
  // meta/JSON-LD 在 <head>，取前 PAGE_MAX_BYTES 足够且避免巨型页面
  return parsePageMeta(full.slice(0, PAGE_MAX_BYTES))
}

// ---------- meta 标签 / JSON-LD 解析 ----------

function matchAllMeta(html: string, key: string): string[] {
  const k = escapeRegex(key)
  const out: string[] = []
  const re1 = new RegExp(`<meta[^>]+(?:name|property)=["']${k}["'][^>]*?content=["']([^"']*)["']`, 'gi')
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*?(?:name|property)=["']${k}["']`, 'gi')
  for (const m of html.matchAll(re1)) out.push(decodeEntities(m[1].trim()))
  for (const m of html.matchAll(re2)) out.push(decodeEntities(m[1].trim()))
  return out
}

function matchMeta(html: string, key: string): string {
  return matchAllMeta(html, key)[0] || ''
}

const ARTICLE_TYPES = ['article', 'scholarlyarticle', 'techarticle', 'report', 'patent', 'publication', 'creativework', 'thesis', 'dissertation', 'medicalscholarlyarticle', 'blogposting']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function isArticleNode(node: any): boolean {
  const t = node?.['@type']
  if (!t) return false
  const types = Array.isArray(t) ? t : [t]
  return types.some(x => ARTICLE_TYPES.includes(String(x).toLowerCase()))
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectLdAuthors(node: any, out: string[]): void {
  if (!node || typeof node !== 'object') return
  if (Array.isArray(node)) { for (const n of node) collectLdAuthors(n, out); return }
  const hasInventor = node.inventor != null || node.inventors != null
  if (isArticleNode(node) || hasInventor) {
    for (const key of ['author', 'inventor', 'inventors', 'creator']) {
      const v = node[key]
      if (v == null) continue
      const arr = Array.isArray(v) ? v : [v]
      for (const a of arr) {
        if (typeof a === 'string') {
          if (a.trim()) out.push(a.trim())
        } else if (a && typeof a === 'object') {
          // 排除组织作者（防把机构名当作者）
          if (a['@type'] === 'Organization') continue
          const name = a.name || (a.givenName && a.familyName ? `${a.givenName} ${a.familyName}` : null)
          if (name && typeof name === 'string' && !/organization|company|corp|inc\.|ltd/i.test(name)) {
            out.push(name.trim())
          }
        }
      }
    }
  }
  if (node['@graph']) collectLdAuthors(node['@graph'], out)
}

function parseJsonLdAuthors(html: string): string[] {
  const out: string[] = []
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim()
    if (!raw) continue
    try {
      collectLdAuthors(JSON.parse(raw), out)
    } catch { /* malformed JSON-LD, skip */ }
  }
  return out
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function findLdDate(node: any): string | null {
  if (!node || typeof node !== 'object') return null
  if (Array.isArray(node)) { for (const n of node) { const d = findLdDate(n); if (d) return d } return null }
  if (isArticleNode(node) || node.inventor != null || node.inventors != null) {
    for (const key of ['datePublished', 'publicationDate', 'filingDate', 'dateFiled', 'dateCreated']) {
      const v = node[key]
      if (typeof v === 'string' && v) return v
    }
  }
  if (node['@graph']) { const d = findLdDate(node['@graph']); if (d) return d }
  return null
}

function parseJsonLdDate(html: string): string {
  for (const m of html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    const raw = m[1].trim()
    if (!raw) continue
    try {
      const d = findLdDate(JSON.parse(raw))
      if (d) return d
    } catch { /* skip */ }
  }
  return ''
}

// ---------- 标题相似度守卫 ----------

export function titleSimilarity(a: string, b: string): number {
  const ta = normalizeTitle(a), tb = normalizeTitle(b)
  if (!ta || !tb) return 0
  const sa = new Set(ta.split(/\s+/)), sb = new Set(tb.split(/\s+/))
  let inter = 0
  for (const t of sa) if (sb.has(t)) inter++
  const jaccard = inter / (sa.size + sb.size - inter || 1)
  const lev = 1 - levenshtein(ta, tb) / Math.max(ta.length, tb.length)
  const lenRatio = Math.min(ta.length, tb.length) / Math.max(ta.length, tb.length)
  return Math.max(jaccard, lev) * lenRatio
}

function normalizeTitle(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim()
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  if (!m) return n
  if (!n) return m
  let prev = Array.from({ length: n + 1 }, (_, i) => i)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur.push(Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)))
    }
    prev = cur
  }
  return prev[n]
}

// ---------- 工具 ----------

/** SSRF 防护：私网/本地地址不抓 */
export function isPrivateUrl(url: string): boolean {
  try {
    const u = new URL(url)
    const h = u.hostname.toLowerCase()
    if (h === 'localhost' || h.endsWith('.local') || h === 'metadata.google.internal') return true
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(h)) return true
    if (/^172\.(1[6-9]|2[0-9]|3[01])\./.test(h)) return true
    if (h === '::1' || h.startsWith('fe80:') || h.startsWith('fc') || h.startsWith('fd')) return true
    return false
  } catch {
    return true
  }
}

function uniq(arr: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const x of arr) {
    const k = x.toLowerCase().trim()
    if (x && k && !seen.has(k)) { seen.add(k); out.push(x) }
  }
  return out
}

function decodeEntities(s: string): string {
  if (!s) return s
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(parseInt(n, 10)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 简易并发池：最多 limit 个 fn 同时执行，保持顺序返回 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let idx = 0
  async function worker(): Promise<void> {
    while (idx < items.length) {
      const cur = idx++
      results[cur] = await fn(items[cur])
    }
  }
  const n = Math.min(limit, items.length)
  await Promise.all(Array.from({ length: n }, () => worker()))
  return results
}
