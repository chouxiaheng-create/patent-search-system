import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { webSearch } from '../../worker/src/services/web-search'

const mockFetch = vi.fn()
vi.stubGlobal('fetch', mockFetch)

describe('web-search (Tavily 后端)', () => {
  const savedEnv: Record<string, string | undefined> = {}
  const ENV_KEYS = [
    'WEB_SEARCH_PROVIDER', 'WEB_SEARCH_API_KEY',
    'WEB_SEARCH_DEPTH', 'WEB_SEARCH_MAX_RESULTS', 'WEB_SEARCH_INCLUDE_RAW_CONTENT',
    'WEB_SEARCH_CHUNKS_PER_SOURCE', 'WEB_SEARCH_INCLUDE_DOMAINS', 'WEB_SEARCH_EXCLUDE_DOMAINS',
    'WEB_SEARCH_TOPIC', 'WEB_SEARCH_TIME_RANGE', 'WEB_SEARCH_COUNTRY',
    'WEB_SEARCH_INCLUDE_ANSWER', 'WEB_SEARCH_RAW_CONTENT_MAX_CHARS', 'WEB_SEARCH_TIMEOUT_MS',
  ]
  beforeEach(() => {
    vi.resetAllMocks()
    ENV_KEYS.forEach(k => { savedEnv[k] = process.env[k]; delete process.env[k] })
    process.env.WEB_SEARCH_PROVIDER = 'tavily'
    process.env.WEB_SEARCH_API_KEY = 'tvly-test'
  })
  afterEach(() => {
    ENV_KEYS.forEach(k => {
      if (savedEnv[k] === undefined) delete process.env[k]
      else process.env[k] = savedEnv[k]
    })
  })

  it('默认使用 advanced 深度，含 raw_content/chunks/白名单/超时 15s 参数', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ results: [{ title: 'T1', url: 'https://a', content: 'C1', score: 0.92 }] }),
    })
    const ctrl = new AbortController()
    const hits = await webSearch('深度学习 专利', ctrl.signal)

    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ title: 'T1', url: 'https://a', snippet: 'C1', score: 0.92 })

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.api_key).toBe('tvly-test')
    expect(body.query).toBe('深度学习 专利')
    expect(body.search_depth).toBe('advanced')
    expect(body.max_results).toBe(15)
    expect(body.include_raw_content).toBe(true)
    expect(body.chunks_per_source).toBe(3)
    expect(Array.isArray(body.include_domains)).toBe(true)
    // 默认白名单应包含 google patents 和 arxiv
    expect(body.include_domains).toContain('patents.google.com')
    expect(body.include_domains).toContain('arxiv.org')
    // 默认黑名单包含 zhihu/csdn
    expect(body.exclude_domains).toContain('zhihu.com')
    expect(body.exclude_domains).toContain('blog.csdn.net')
    // basic 默认的旧字段保持合理值
    expect(body.include_answer).toBe(false)
  })

  it('basic 深度 + include_raw_content=false 时不发送 raw_content/chunks 参数', async () => {
    process.env.WEB_SEARCH_DEPTH = 'basic'
    process.env.WEB_SEARCH_INCLUDE_RAW_CONTENT = 'false'
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) })

    await webSearch('q', new AbortController().signal)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.search_depth).toBe('basic')
    expect(body.include_raw_content).toBeUndefined()
    expect(body.chunks_per_source).toBeUndefined()
  })

  it('WEB_SEARCH_INCLUDE_DOMAINS=* 关闭白名单（即允许所有域名）', async () => {
    process.env.WEB_SEARCH_INCLUDE_DOMAINS = '*'
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) })
    await webSearch('q', new AbortController().signal)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.include_domains).toBeUndefined()
    // 黑名单仍生效
    expect(body.exclude_domains).toBeDefined()
  })

  it('WEB_SEARCH_INCLUDE_DOMAINS 逗号分隔追加到默认白名单', async () => {
    process.env.WEB_SEARCH_INCLUDE_DOMAINS = 'www.example.com, foo.cn'
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) })
    await webSearch('q', new AbortController().signal)
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.include_domains).toContain('www.example.com')
    expect(body.include_domains).toContain('foo.cn')
    expect(body.include_domains).toContain('patents.google.com') // 默认仍在
  })

  it('raw_content 超长会按 WEB_SEARCH_RAW_CONTENT_MAX_CHARS 截断', async () => {
    process.env.WEB_SEARCH_RAW_CONTENT_MAX_CHARS = '50'
    const longText = 'A'.repeat(500)
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [{ title: 'T', url: 'https://x', content: 'short', raw_content: longText, published_date: '2024-01-02', score: 0.5 }],
      }),
    })
    const hits = await webSearch('q', new AbortController().signal)
    expect(hits[0].raw_content).toMatch(/^A{50}…（原文过长已截断）$/)
    expect(hits[0].snippet).toBe('short')
    expect(hits[0].pub_date).toBe('2024-01-02')
  })

  it('未配置 API key 时抛错', async () => {
    delete process.env.WEB_SEARCH_API_KEY
    await expect(webSearch('x', new AbortController().signal)).rejects.toThrow(/WEB_SEARCH_API_KEY/)
  })

  it('HTTP 错误时抛错并包含状态码', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' })
    await expect(webSearch('x', new AbortController().signal)).rejects.toThrow(/Tavily HTTP 401/)
  })

  it('空结果返回空数组', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) })
    const hits = await webSearch('x', new AbortController().signal)
    expect(hits).toEqual([])
  })

  it('不支持的 provider 抛错', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'unknown'
    await expect(webSearch('x', new AbortController().signal)).rejects.toThrow(/不支持的 WEB_SEARCH_PROVIDER/)
  })

  it('opts 参数覆盖环境变量（便于上层细粒度控制）', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) })
    await webSearch('q', new AbortController().signal, { depth: 'basic', maxResults: 3, includeRawContent: false })
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.search_depth).toBe('basic')
    expect(body.max_results).toBe(3)
    expect(body.include_raw_content).toBeUndefined()
  })
})
