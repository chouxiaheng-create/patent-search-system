import { describe, it, expect, vi, beforeEach } from 'vitest'
import { webSearch } from '../../worker/src/services/web-search'

const mockFetch = vi.fn()
global.fetch = mockFetch

describe('web-search (Tavily 后端)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.WEB_SEARCH_PROVIDER = 'tavily'
    process.env.WEB_SEARCH_API_KEY = 'tvly-test'
  })

  it('构造正确的 Tavily 请求并映射结果字段', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { title: 'T1', url: 'https://a', content: 'C1', published_date: '2024-01-02' },
          { title: 'T2', url: 'https://b', content: 'C2' },
        ],
      }),
    })

    const ctrl = new AbortController()
    const hits = await webSearch('深度学习 专利', ctrl.signal)

    expect(hits).toHaveLength(2)
    expect(hits[0]).toMatchObject({ title: 'T1', url: 'https://a', snippet: 'C1', pub_date: '2024-01-02' })
    expect(hits[1].pub_date).toBeUndefined()

    expect(mockFetch).toHaveBeenCalledWith(
      'https://api.tavily.com/search',
      expect.objectContaining({ method: 'POST' })
    )
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.api_key).toBe('tvly-test')
    expect(body.query).toBe('深度学习 专利')
    expect(body.max_results).toBe(10)
    expect(body.search_depth).toBe('basic')
  })

  it('未配置 API key 时抛错', async () => {
    delete process.env.WEB_SEARCH_API_KEY
    const ctrl = new AbortController()
    await expect(webSearch('x', ctrl.signal)).rejects.toThrow(/WEB_SEARCH_API_KEY/)
  })

  it('HTTP 错误时抛错并包含状态码', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' })
    const ctrl = new AbortController()
    await expect(webSearch('x', ctrl.signal)).rejects.toThrow(/Tavily HTTP 401/)
  })

  it('空结果返回空数组', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) })
    const ctrl = new AbortController()
    const hits = await webSearch('x', ctrl.signal)
    expect(hits).toEqual([])
  })

  it('不支持的 provider 抛错', async () => {
    process.env.WEB_SEARCH_PROVIDER = 'unknown'
    const ctrl = new AbortController()
    await expect(webSearch('x', ctrl.signal)).rejects.toThrow(/不支持的 WEB_SEARCH_PROVIDER/)
  })
})
