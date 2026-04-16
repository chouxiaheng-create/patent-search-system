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