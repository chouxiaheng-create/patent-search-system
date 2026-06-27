import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  enrichMetadata, enrichOne,
  extractArxivId, extractDoi, extractS2Id,
  parseArxiv, parseCrossrefMessage, parseS2Paper, parsePageMeta,
  titleSimilarity, isPrivateUrl, mapWithConcurrency,
} from '../../worker/src/services/enrichment'
import type { SearchResult } from '../../worker/src/utils/prompt'

function mockResponse(body: string, ok = true) {
  return {
    ok,
    status: ok ? 200 : 404,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
  }
}

const ARXIV_XML = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
<entry><id>http://arxiv.org/abs/2401.12345</id><title>Some Title</title>
<author><name>Alice Smith</name></author>
<author><name>Bob Jones</name></author>
<published>2024-01-15T00:00:00Z</published></entry>
</feed>`

const CROSSREF_JSON = JSON.stringify({
  message: {
    author: [{ given: 'Alice', family: 'Smith' }, { given: 'Bob', family: 'Jones' }],
    'published-print': { 'date-parts': [[2023, 5, 15]] },
  },
})

const S2_PAPER_JSON = JSON.stringify({ authors: [{ name: 'Alice Smith' }], year: 2023 })
const S2_SEARCH_JSON = JSON.stringify({
  data: [{ title: 'Attention Is All You Need', authors: [{ name: 'Ashish Vaswani' }], year: 2017 }],
})
const S2_SEARCH_NOMATCH_JSON = JSON.stringify({
  data: [{ title: 'A Totally Unrelated Paper About Cooking', authors: [{ name: 'Chef' }], year: 2019 }],
})

const PAGE_HTML = `<html><head>
<meta name="citation_author" content="Alice Smith">
<meta name="citation_author" content="Bob Jones">
<meta name="citation_publication_date" content="2022-06-01">
<script type="application/ld+json">{"@type":"ScholarlyArticle","author":[{"name":"Carol Lee"}],"datePublished":"2022-06-01"}</script>
</head></html>`

const PATENT_HTML = `<html><head>
<script type="application/ld+json">{"@type":"Patent","inventors":[{"name":"Inventor One"},{"name":"Inventor Two"}],"dateFiled":"2021-03-10"}</script>
</head></html>`

describe('enrichment - 标识符提取', () => {
  it('extractArxivId', () => {
    expect(extractArxivId('https://arxiv.org/abs/2401.12345')).toBe('2401.12345')
    expect(extractArxivId('https://arxiv.org/pdf/2401.12345v2')).toBe('2401.12345v2')
    expect(extractArxivId('https://example.com/x')).toBeNull()
    expect(extractArxivId('')).toBeNull()
  })
  it('extractDoi', () => {
    expect(extractDoi('https://doi.org/10.1109/ICCV.2023.00123')).toBe('10.1109/ICCV.2023.00123')
    expect(extractDoi('https://dx.doi.org/10.1000/182')).toBe('10.1000/182')
    expect(extractDoi('https://example.com/10.1000/xyz')).toBe('10.1000/xyz')
    expect(extractDoi('https://example.com/no-doi')).toBeNull()
  })
  it('extractS2Id', () => {
    expect(extractS2Id('https://www.semanticscholar.org/paper/some-slug/abc123def4567890abc123def4567890abc12345'))
      .toBe('abc123def4567890abc123def4567890abc12345')
    expect(extractS2Id('https://example.com')).toBeNull()
  })
})

describe('enrichment - 解析器', () => {
  it('parseArxiv 提取作者与日期', () => {
    const m = parseArxiv(ARXIV_XML)
    expect(m.authors).toBe('Alice Smith;Bob Jones')
    expect(m.pub_date).toBe('2024-01-15')
    expect(m.source).toBe('arXiv')
  })
  it('parseCrossrefMessage 提取作者与日期', () => {
    const m = parseCrossrefMessage(JSON.parse(CROSSREF_JSON).message)
    expect(m.authors).toBe('Alice Smith;Bob Jones')
    expect(m.pub_date).toBe('2023-05-15')
    expect(m.source).toBe('Crossref')
  })
  it('parseS2Paper 年份→YYYY-01-01', () => {
    const m = parseS2Paper(JSON.parse(S2_PAPER_JSON))
    expect(m.authors).toBe('Alice Smith')
    expect(m.pub_date).toBe('2023-01-01')
  })
  it('parsePageMeta meta + JSON-LD 合并', () => {
    const m = parsePageMeta(PAGE_HTML)
    expect(m.authors).toBe('Alice Smith;Bob Jones;Carol Lee')
    expect(m.pub_date).toBe('2022-06-01')
    expect(m.source).toBe('页面meta')
  })
  it('parsePageMeta 专利 JSON-LD（inventors/dateFiled）', () => {
    const m = parsePageMeta(PATENT_HTML)
    expect(m.authors).toBe('Inventor One;Inventor Two')
    expect(m.pub_date).toBe('2021-03-10')
  })
})

describe('enrichment - 标题相似度守卫', () => {
  it('相同标题≈1.0', () => {
    expect(titleSimilarity('Attention Is All You Need', 'Attention Is All You Need')).toBeGreaterThan(0.85)
  })
  it('无关标题低于阈值', () => {
    expect(titleSimilarity('Attention Is All You Need', 'A Totally Unrelated Paper About Cooking')).toBeLessThan(0.85)
  })
})

describe('enrichment - SSRF 防护', () => {
  it('私网/本地拒绝', () => {
    expect(isPrivateUrl('http://localhost/x')).toBe(true)
    expect(isPrivateUrl('http://127.0.0.1/x')).toBe(true)
    expect(isPrivateUrl('http://10.0.0.1/x')).toBe(true)
    expect(isPrivateUrl('http://192.168.1.1/x')).toBe(true)
  })
  it('公网放行', () => {
    expect(isPrivateUrl('https://arxiv.org/abs/123')).toBe(false)
    expect(isPrivateUrl('https://example.com/x')).toBe(false)
  })
})

describe('enrichment - enrichOne 路由', () => {
  let originalFetch: typeof global.fetch
  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = vi.fn(async (url: string) => {
      const u = String(url)
      if (u.includes('arxiv.org')) return mockResponse(ARXIV_XML) as any
      if (u.includes('crossref.org')) return mockResponse(CROSSREF_JSON) as any
      if (u.includes('semanticscholar.org') && u.includes('/paper/search')) return mockResponse(S2_SEARCH_JSON) as any
      if (u.includes('semanticscholar.org')) return mockResponse(S2_PAPER_JSON) as any
      if (u.includes('example.com/patent')) return mockResponse(PATENT_HTML) as any
      if (u.includes('example.com/page')) return mockResponse(PAGE_HTML) as any
      return mockResponse(PAGE_HTML) as any
    }) as any
  })
  afterEach(() => { global.fetch = originalFetch })

  it('arXiv URL → arXiv 富化', async () => {
    const r: SearchResult = { title: 'T', authors: '未知', url: 'https://arxiv.org/abs/2401.12345', pub_date: '', relevance_desc: 'd', citation_gb: '' }
    const out = await enrichOne(r)
    expect(out.authors).toBe('Alice Smith;Bob Jones')
    expect(out.pub_date).toBe('2024-01-15')
    expect(out.metadata_source).toBe('arXiv')
  })

  it('DOI URL → Crossref 富化', async () => {
    const r: SearchResult = { title: 'T', authors: '未知', url: 'https://doi.org/10.1109/ICCV.2023.00123', pub_date: '', relevance_desc: 'd', citation_gb: '' }
    const out = await enrichOne(r)
    expect(out.authors).toBe('Alice Smith;Bob Jones')
    expect(out.pub_date).toBe('2023-05-15')
    expect(out.metadata_source).toBe('Crossref')
  })

  it('专利 URL → JSON-LD/meta 富化', async () => {
    const r: SearchResult = { title: 'Patent', authors: '未知', url: 'https://example.com/patent/US123', pub_date: '', relevance_desc: 'd', citation_gb: '' }
    const out = await enrichOne(r)
    expect(out.authors).toBe('Inventor One;Inventor Two')
    expect(out.pub_date).toBe('2021-03-10')
    expect(out.metadata_source).toBe('页面meta')
  })

  it('仅 title（无 URL）→ S2 按标题，标题匹配则采信', async () => {
    const r: SearchResult = { title: 'Attention Is All You Need', authors: '未知', url: '', pub_date: '', relevance_desc: 'd', citation_gb: '' }
    const out = await enrichOne(r)
    expect(out.authors).toBe('Ashish Vaswani')
    expect(out.metadata_source).toBe('Semantic Scholar(title)')
  })

  it('S2 按标题返回不匹配标题 → 守卫拒绝，保持缺失', async () => {
    global.fetch = vi.fn(async () => mockResponse(S2_SEARCH_NOMATCH_JSON) as any) as any
    const r: SearchResult = { title: 'Attention Is All You Need', authors: '未知', url: '', pub_date: '', relevance_desc: 'd', citation_gb: '' }
    const out = await enrichOne(r)
    expect(out.authors).toBe('未知')
    expect(out.metadata_source).toBeUndefined()
  })

  it('只填不覆写：已有作者不被覆盖', async () => {
    const r: SearchResult = { title: 'T', authors: 'John Doe', url: 'https://arxiv.org/abs/2401.12345', pub_date: '', relevance_desc: 'd', citation_gb: '' }
    const out = await enrichOne(r)
    expect(out.authors).toBe('John Doe')  // 不覆写
    expect(out.pub_date).toBe('2024-01-15')  // 日期仍被补
  })

  it('两字段都已填 → 不发请求', async () => {
    const fetchSpy = vi.fn(async () => mockResponse('')) as any
    global.fetch = fetchSpy
    const r: SearchResult = { title: 'T', authors: 'John', url: 'https://arxiv.org/abs/1.2', pub_date: '2020-01-01', relevance_desc: 'd', citation_gb: '' }
    const out = await enrichOne(r)
    expect(out.authors).toBe('John')
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('全部失败 → 保持原值且不抛错', async () => {
    global.fetch = vi.fn(async () => mockResponse('', false)) as any
    const r: SearchResult = { title: 'T', authors: '未知', url: 'https://example.com/page', pub_date: '', relevance_desc: 'd', citation_gb: '' }
    const out = await enrichOne(r)
    expect(out.authors).toBe('未知')
    expect(out.pub_date).toBe('')
  })
})

describe('enrichment - enrichMetadata 批量', () => {
  let originalFetch: typeof global.fetch
  beforeEach(() => {
    originalFetch = global.fetch
    global.fetch = vi.fn(async (url: string) => {
      if (String(url).includes('arxiv.org')) return mockResponse(ARXIV_XML) as any
      return mockResponse('', false) as any
    }) as any
  })
  afterEach(() => { global.fetch = originalFetch })

  it('只对缺字段的结果富化；全满时原样返回', async () => {
    const full: SearchResult = { title: 'T', authors: 'A', url: 'https://arxiv.org/abs/2401.12345', pub_date: '2020-01-01', relevance_desc: 'd', citation_gb: '' }
    const missing: SearchResult = { title: 'T', authors: '未知', url: 'https://arxiv.org/abs/2401.12345', pub_date: '', relevance_desc: 'd', citation_gb: '' }
    const out = await enrichMetadata([full, missing])
    expect(out[0].authors).toBe('A')  // 未变
    expect(out[1].authors).toBe('Alice Smith;Bob Jones')
    expect(out[1].pub_date).toBe('2024-01-15')
  })
})

describe('enrichment - mapWithConcurrency', () => {
  it('保持顺序、全部完成', async () => {
    const items = [1, 2, 3, 4, 5]
    const out = await mapWithConcurrency(items, 2, async n => n * 10)
    expect(out).toEqual([10, 20, 30, 40, 50])
  })
})
