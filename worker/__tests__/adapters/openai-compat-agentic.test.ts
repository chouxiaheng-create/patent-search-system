import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// 自动 mock web-search 模块，避免 agentic 测试真实访问 Tavily
vi.mock('../../src/services/web-search')
import { webSearch } from '../../src/services/web-search'
import { OpenAICompatAdapter } from '../../src/adapters/openai-compat'

const mockWebSearch = vi.mocked(webSearch)
const mockFetch = vi.fn()
global.fetch = mockFetch

const agenticConfig = {
  provider: 'openai_compat' as const,
  web_search_method: 'agentic' as const,
  thinking_method: 'none' as const,
  web_search_disables_thinking: false,
  thinking_default_on: false,
}

function chatResponse(message: Record<string, unknown>) {
  return { ok: true, json: async () => ({ choices: [{ message }] }) }
}

describe('OpenAICompatAdapter agentic 循环', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    process.env.WEB_SEARCH_MAX_ROUNDS = '3'
  })
  afterEach(() => {
    delete process.env.WEB_SEARCH_MAX_ROUNDS
  })

  it('LLM 调用 web_search 后，将结果回灌并在下一轮返回最终内容', async () => {
    // 第 1 轮：返回 tool_calls
    mockFetch.mockResolvedValueOnce(
      chatResponse({
        content: null,
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"图像识别 专利"}' } },
        ],
      })
    )
    // 第 2 轮：返回最终 JSON
    mockFetch.mockResolvedValueOnce(chatResponse({ content: '[{"title":"真实文献","url":"https://x"}]' }))

    mockWebSearch.mockResolvedValue([{ title: '真实文献', url: 'https://x', snippet: '摘要' }])

    const adapter = new OpenAICompatAdapter('https://api.example.com', 'k', agenticConfig)
    const result = await adapter.call({
      modelId: 'm',
      prompt: '检索图像识别相关专利',
      systemPrompt: '你是专利检索专家',
      enableWebSearch: true,
      enableThinking: false,
    })

    expect(result.success).toBe(true)
    expect(result.content).toContain('真实文献')
    // webSearch 被调用一次，参数为 LLM 给出的 query
    expect(mockWebSearch).toHaveBeenCalledTimes(1)
    expect(mockWebSearch.mock.calls[0][0]).toBe('图像识别 专利')
    // 第 2 次 chat 请求体里应包含 role:'tool' 消息与带 tool_calls 的 assistant 消息
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(secondBody.messages.some((m: { role: string }) => m.role === 'tool')).toBe(true)
    expect(
      secondBody.messages.some((m: { role: string; tool_calls?: unknown[] }) => m.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0)
    ).toBe(true)
    // 第 2 轮仍在循环内，请求应带 web_search 工具
    expect(Array.isArray(secondBody.tools)).toBe(true)
    expect(secondBody.tools[0].function.name).toBe('web_search')
  })

  it('触顶后强制收尾（不带 tools）并返回内容', async () => {
    process.env.WEB_SEARCH_MAX_ROUNDS = '1'
    // 带工具的请求一律回 tool_calls；不带工具的强制收尾请求回 content
    mockFetch.mockImplementation(async (_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body)
      if (Array.isArray(body.tools)) {
        return chatResponse({
          content: null,
          tool_calls: [{ id: 'c', type: 'function', function: { name: 'web_search', arguments: '{"query":"q"}' } }],
        })
      }
      return chatResponse({ content: '[{"title":"final"}]' })
    })
    mockWebSearch.mockResolvedValue([])

    const adapter = new OpenAICompatAdapter('https://api.example.com', 'k', agenticConfig)
    const result = await adapter.call({
      modelId: 'm',
      prompt: '检索',
      systemPrompt: '你是专家',
      enableWebSearch: true,
      enableThinking: false,
    })

    expect(result.success).toBe(true)
    expect(result.content).toContain('final')
    // 恰好两次 chat：1 次带 tools（循环），1 次不带 tools（强制收尾）
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const finalBody = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(finalBody.tools).toBeUndefined()
  })

  it('chat/completions HTTP 错误时返回 error 且不调用 webSearch', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' })

    const adapter = new OpenAICompatAdapter('https://api.example.com', 'k', agenticConfig)
    const result = await adapter.call({
      modelId: 'm',
      prompt: '检索',
      enableWebSearch: true,
      enableThinking: false,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/HTTP 500/)
    expect(mockWebSearch).not.toHaveBeenCalled()
  })

  it('tools_web_search 配置被 API 拒绝（unknown variant）时自动降级 agentic 并成功返回', async () => {
    // 配置错误地写成了 tools_web_search（DeepSeek/MiniMax 只接受 type:'function'，会报 400）
    const badConfig = {
      provider: 'openai_compat' as const,
      web_search_method: 'tools_web_search' as const,
      thinking_method: 'none' as const,
      web_search_disables_thinking: false,
      thinking_default_on: false,
    }

    // 第 1 次请求：带 web_search 工具类型 → API 拒绝
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => '{"error":{"message":"Failed to deserialize the JSON body into the target type: tools[0].type: unknown variant `web_search`, expected `function`"}}',
    })
    // 降级后的 agentic 循环：第 1 轮带 function 工具返回 tool_calls
    mockFetch.mockResolvedValueOnce(
      chatResponse({
        content: null,
        tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'web_search', arguments: '{"query":"降级检索"}' } }],
      })
    )
    // 第 2 轮返回最终内容
    mockFetch.mockResolvedValueOnce(chatResponse({ content: '[{"title":"降级成功"}]' }))
    mockWebSearch.mockResolvedValue([{ title: '降级成功', url: 'https://x', snippet: '摘要' }])

    const adapter = new OpenAICompatAdapter('https://api.example.com', 'k', badConfig)
    const result = await adapter.call({
      modelId: 'm',
      prompt: '检索',
      enableWebSearch: true,
      enableThinking: false,
    })

    expect(result.success).toBe(true)
    expect(result.content).toContain('降级成功')
    // 原配置发出的请求确实带了 web_search 工具类型（证明降级前走的是原配置）
    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(firstBody.tools[0].type).toBe('web_search')
    // 降级后（第 2 次起）工具类型切换为 function（agentic 循环），且真的执行了搜索
    const degradedBody = JSON.parse(mockFetch.mock.calls[1][1].body)
    expect(degradedBody.tools[0].type).toBe('function')
    expect(mockWebSearch).toHaveBeenCalledTimes(1)
    expect(mockWebSearch.mock.calls[0][0]).toBe('降级检索')
  })

  it('tools_web_search 配置遇其他 HTTP 错误（401）时不做降级，直接返回错误', async () => {
    const badConfig = {
      provider: 'openai_compat' as const,
      web_search_method: 'tools_web_search' as const,
      thinking_method: 'none' as const,
      web_search_disables_thinking: false,
      thinking_default_on: false,
    }
    mockFetch.mockResolvedValue({ ok: false, status: 401, text: async () => 'Unauthorized' })

    const adapter = new OpenAICompatAdapter('https://api.example.com', 'k', badConfig)
    const result = await adapter.call({
      modelId: 'm',
      prompt: '检索',
      enableWebSearch: true,
      enableThinking: false,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/401/)
    expect(mockWebSearch).not.toHaveBeenCalled()
  })

  it('web_search 失败时回灌错误消息、循环继续', async () => {
    process.env.WEB_SEARCH_MAX_ROUNDS = '1'
    mockFetch.mockImplementation(async (_url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body)
      if (Array.isArray(body.tools)) {
        return chatResponse({
          content: null,
          tool_calls: [{ id: 'c', type: 'function', function: { name: 'web_search', arguments: '{"query":"q"}' } }],
        })
      }
      return chatResponse({ content: '[{"title":"recovered"}]' })
    })
    mockWebSearch.mockRejectedValue(new Error('Tavily 宕机'))

    const adapter = new OpenAICompatAdapter('https://api.example.com', 'k', agenticConfig)
    const result = await adapter.call({
      modelId: 'm',
      prompt: '检索',
      enableWebSearch: true,
      enableThinking: false,
    })

    // 搜索失败但回灌了错误消息，强制收尾仍能返回内容
    expect(result.success).toBe(true)
    expect(result.content).toContain('recovered')
    const finalBody = JSON.parse(mockFetch.mock.calls[1][1].body)
    const toolMsg = finalBody.messages.find((m: { role: string }) => m.role === 'tool')
    expect(toolMsg).toBeTruthy()
    expect(toolMsg.content).toMatch(/搜索失败/)
  })
})
