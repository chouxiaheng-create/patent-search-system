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

  it("default_on 开启思考时发送 thinking.type=adaptive（DeepSeek/MiniMax 要求，'enabled' 会报 2013）", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] })
    })

    const adapter = new OpenAICompatAdapter(
      'https://api.example.com',
      'key',
      { provider: 'openai_compat', web_search_method: 'none', thinking_method: 'default_on', reasoning_effort: 'high', web_search_disables_thinking: false, thinking_default_on: true }
    )

    await adapter.call({ modelId: 'test-model', prompt: 'test', enableThinking: true })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.thinking).toEqual({ type: 'adaptive' })
    expect(body.reasoning_effort).toBe('high')
  })

  it('param 关闭思考时发送 thinking.type=disabled', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'ok' } }] })
    })

    const adapter = new OpenAICompatAdapter(
      'https://api.example.com',
      'key',
      { provider: 'openai_compat', web_search_method: 'none', thinking_method: 'param', web_search_disables_thinking: false, thinking_default_on: false }
    )

    await adapter.call({ modelId: 'test-model', prompt: 'test', enableThinking: false })

    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.thinking).toEqual({ type: 'disabled' })
  })
})