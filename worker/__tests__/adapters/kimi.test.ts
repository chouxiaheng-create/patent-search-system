import { describe, it, expect, vi, beforeEach } from 'vitest'
import { KimiAdapter } from '../../src/adapters/kimi'

// Mock global fetch
const mockFetch = vi.fn()
global.fetch = mockFetch

// 与 DB 中 Kimi (kimi-k2.6) 的实际配置一致
const KIMI_CONFIG = {
  thinking_method: 'default_on',
  web_search_method: 'tools_builtin',
  thinking_default_on: true,
  web_search_disables_thinking: false,
  web_search_tool_name: '$web_search',
}

function makeAdapter(overrides: Partial<typeof KIMI_CONFIG> = {}) {
  return new KimiAdapter(
    'https://api.moonshot.cn',
    'test-key',
    { ...KIMI_CONFIG, ...overrides }
  )
}

/** 解析某次请求的 body */
function bodyOf(callIndex: number): Record<string, unknown> {
  const raw = mockFetch.mock.calls[callIndex][1] as RequestInit
  return JSON.parse(String(raw.body))
}

describe('KimiAdapter', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('联网搜索任务：第1次调用声明 $web_search 工具并强制禁用思考', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '["结果"]' } }] })
    })

    const adapter = makeAdapter()
    const result = await adapter.call({
      modelId: 'kimi-k2.6',
      prompt: '测试',
      enableThinking: true,
      enableWebSearch: true
    })

    expect(result.success).toBe(true)
    expect(result.content).toBe('["结果"]')
    expect(mockFetch).toHaveBeenCalledTimes(1)

    const body = bodyOf(0)
    expect(body.tools).toEqual([{ type: 'builtin_function', function: { name: '$web_search' } }])
    // $web_search 多步调用要求禁用思考 —— 历史 400（thinking enabled + 缺 reasoning_content）的根因防护
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('工具调用后：assistant 消息完整回传 reasoning_content 与 tool_calls，第2次调用保持 thinking 禁用', async () => {
    // 第1次：模型发起 $web_search 工具调用（带思考内容——API 可能回传）
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '',
            reasoning_content: '需要搜索餐厨垃圾厌氧消化相关文献',
            tool_calls: [{ id: 'call_001', function: { name: '$web_search', arguments: '{"query":"餐厨垃圾 厌氧消化"}' } }]
          }
        }]
      })
    })
    // 第2次：Kimi 服务端执行搜索后返回最终回答
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '[{"title":"A"}]' } }] })
    })

    const adapter = makeAdapter()
    const result = await adapter.call({
      modelId: 'kimi-k2.6',
      prompt: '测试',
      enableThinking: true,
      enableWebSearch: true
    })

    expect(result.success).toBe(true)
    expect(result.content).toBe('[{"title":"A"}]')
    expect(mockFetch).toHaveBeenCalledTimes(2)

    // 第1次调用：thinking 必须禁用
    const body1 = bodyOf(0)
    expect(body1.thinking).toEqual({ type: 'disabled' })

    // 第2次调用：assistant 消息必须带 tool_calls + reasoning_content（Kimi 要求回传，缺失报 400）
    const body2 = bodyOf(1)
    const messages = body2.messages as Array<Record<string, unknown>>
    const assistantMsg = messages.find(m => m.role === 'assistant') as Record<string, unknown>
    expect(assistantMsg.tool_calls).toEqual([{ id: 'call_001', function: { name: '$web_search', arguments: '{"query":"餐厨垃圾 厌氧消化"}' } }])
    expect(assistantMsg.reasoning_content).toBe('需要搜索餐厨垃圾厌氧消化相关文献')
    // 与上下文一致：thinking 保持禁用（否则 API 会因 assistant 消息缺 reasoning_content 报 400）
    expect(body2.thinking).toEqual({ type: 'disabled' })

    // tool 消息原封不动回传 arguments（Kimi 服务端执行搜索）
    const toolMsg = messages.find(m => m.role === 'tool') as Record<string, unknown>
    expect(toolMsg.tool_call_id).toBe('call_001')
    expect(toolMsg.name).toBe('$web_search')
    expect(toolMsg.content).toBe('{"query":"餐厨垃圾 厌氧消化"}')
  })

  it('工具调用但响应无 reasoning_content（thinking 禁用场景）：第2次调用不报 400', async () => {
    // 历史错误场景的当前正确行为：thinking 禁用时 assistant 无 reasoning_content 是合法的
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '',
            tool_calls: [{ id: 'call_002', function: { name: '$web_search', arguments: '{"query":"专利检索"}' } }]
          }
        }]
      })
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '[]' } }] })
    })

    const adapter = makeAdapter()
    const result = await adapter.call({
      modelId: 'kimi-k2.6',
      prompt: '测试',
      enableThinking: true,
      enableWebSearch: true
    })

    expect(result.success).toBe(true)
    expect(result.content).toBe('[]')

    const body2 = bodyOf(1)
    expect(body2.thinking).toEqual({ type: 'disabled' })
    const messages = body2.messages as Array<Record<string, unknown>>
    const assistantMsg = messages.find(m => m.role === 'assistant') as Record<string, unknown>
    expect(assistantMsg.reasoning_content).toBeUndefined()
  })

  it('第2次响应仍含工具调用：第3次调用同样保持 thinking 禁用并回传上下文', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '',
            tool_calls: [{ id: 'call_1', function: { name: '$web_search', arguments: '{"query":"q1"}' } }]
          }
        }]
      })
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '',
            tool_calls: [{ id: 'call_2', function: { name: '$web_search', arguments: '{"query":"q2"}' } }]
          }
        }]
      })
    })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '[{"title":"B"}]' } }] })
    })

    const adapter = makeAdapter()
    const result = await adapter.call({
      modelId: 'kimi-k2.6',
      prompt: '测试',
      enableThinking: true,
      enableWebSearch: true
    })

    expect(result.success).toBe(true)
    expect(result.content).toBe('[{"title":"B"}]')
    expect(mockFetch).toHaveBeenCalledTimes(3)

    const body3 = bodyOf(2)
    expect(body3.thinking).toEqual({ type: 'disabled' })
    const messages = body3.messages as Array<Record<string, unknown>>
    const assistantMsgs = messages.filter(m => m.role === 'assistant')
    expect(assistantMsgs).toHaveLength(2)
    expect((assistantMsgs[1] as Record<string, unknown>).tool_calls).toBeDefined()
  })

  it('default_on 配置 + enableThinking=false：请求体必须显式禁用思考', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] })
    })

    const adapter = makeAdapter() // thinking_method: 'default_on'
    const result = await adapter.call({
      modelId: 'kimi-k2.6',
      prompt: '测试',
      enableThinking: false,
      enableWebSearch: false
    })

    expect(result.success).toBe(true)
    const body = bodyOf(0)
    expect(body.thinking).toEqual({ type: 'disabled' })
  })

  it('default_on 配置 + enableThinking=true：不发思考参数（模型默认开启）', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] })
    })

    const adapter = makeAdapter()
    const result = await adapter.call({
      modelId: 'kimi-k2.6',
      prompt: '测试',
      enableThinking: true,
      enableWebSearch: false
    })

    expect(result.success).toBe(true)
    const body = bodyOf(0)
    expect(body.thinking).toBeUndefined()
  })
})
