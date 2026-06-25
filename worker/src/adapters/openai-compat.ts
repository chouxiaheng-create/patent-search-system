import { AIAdapter, AIAdapterCallOptions, AIAdapterResult } from './base'

export interface AIModelRecord {
  id: string
  name: string
  api_base_url: string
  api_key_encrypted: string
  model_id: string
  adapter_config: {
    provider: 'openai_compat' | 'metaso' | 'kimi' | 'zhipu'
    web_search_method: 'tools_builtin' | 'tools_web_search' | 'extra_body' | 'native' | 'web_search_options' | 'none'
    web_search_tool_name?: string
    web_search_params?: Record<string, unknown>  // 智谱等需要额外参数
    thinking_method: 'param' | 'model_switch' | 'extra_body' | 'default_on' | 'reasoning_split' | 'none'
    thinking_model_id?: string
    reasoning_effort?: 'high' | 'max'
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
      const hasThinking = !!body.thinking || !!body.enable_thinking
      const hasTools = !!body.tools
      const hasWebSearch = !!body.web_search_options || !!body.enable_search
      console.log(`[adapter] ${this.baseUrl}/chat/completions model=${body.model} thinking=${hasThinking} tools=${hasTools} webSearch=${hasWebSearch} bodyKeys=${Object.keys(body).join(',')}`)
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

      const data = await response.json() as {
        choices?: Array<{
          message?: {
            content?: string
            tool_calls?: Array<{ function?: { arguments?: string } }>
          }
        }>
        error?: { message?: string }
      }

      if (data.error) {
        return { success: false, error: data.error.message }
      }

      const message = data.choices?.[0]?.message

      // 优先取 content
      if (message?.content) {
        // 剥离 MiniMax 等模型的 <think>...</think> 标签（原生格式下思考内容混入 content）
        let content = message.content
        if (content.includes('<think>')) {
          content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
          console.log(`[adapter] 剥离 <think> 标签后内容长度: ${content.length} 字符`)
        }
        console.log(`[adapter] 响应内容长度: ${content.length} 字符`)
        return { success: true, content }
      }

      // 如果使用了工具，尝试从 tool_calls 获取结果
      if (message?.tool_calls && message.tool_calls.length > 0) {
        // 工具调用的结果通常在 arguments 中，是 JSON 字符串
        const toolResult = message.tool_calls[0]?.function?.arguments
        if (toolResult) {
          try {
            const parsed = JSON.parse(toolResult)
            // 有些 API 返回的结果在不同字段
            const content = parsed.content || parsed.result || JSON.stringify(parsed)
            if (content) {
              return { success: true, content }
            }
          } catch {
            // 如果不是 JSON，直接返回
            return { success: true, content: toolResult }
          }
        }
      }

      return { success: false, error: 'AI 返回内容为空' }
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
      // param: 直接作为请求体顶层参数（如 Kimi thinking: {type: 'enabled'}）
      if (options.enableThinking) {
        body.thinking = { type: 'enabled' }
      } else {
        body.thinking = { type: 'disabled' }
      }
    } else if (thinking_method === 'default_on') {
      // default_on: 模型默认开启思考（如 DeepSeek v4）
      // 支持 reasoning_effort 控制思考强度（'high' | 'max'）
      if (options.enableThinking) {
        const thinkingParam: Record<string, unknown> = { type: 'enabled' }
        body.thinking = thinkingParam
        if (this.adapterConfig.reasoning_effort) {
          body.reasoning_effort = this.adapterConfig.reasoning_effort
        }
      } else {
        body.thinking = { type: 'disabled' }
      }
    } else if (thinking_method === 'extra_body') {
      // extra_body: 合并到请求体顶层（兼容 DashScope 等 API，如千问 enable_thinking）
      if (options.enableThinking) {
        body.enable_thinking = true
      }
    } else if (thinking_method === 'reasoning_split') {
      // MiniMax: reasoning_split 将思考内容分离到 reasoning_details 字段
      body.reasoning_split = options.enableThinking
    }

    // 处理联网搜索
    if (options.enableWebSearch && web_search_method && web_search_method !== 'none') {
      if (web_search_disables_thinking) {
        // 清除可能已设置的 thinking 参数
        delete body.thinking
        delete body.enable_thinking
      }

      if (web_search_method === 'tools_builtin') {
        // 使用数据库中配置的工具名（如 $web_search）
        const toolName = this.adapterConfig.web_search_tool_name || '$web_search'
        body.tools = [{ type: 'builtin_function', function: { name: toolName } }]
      } else if (web_search_method === 'tools_web_search') {
        // MiniMax, 智谱等使用 web_search 工具类型
        // 智谱要求 web_search 属性必须存在且非空
        const webSearchParams = this.adapterConfig.web_search_params
        if (webSearchParams && Object.keys(webSearchParams).length > 0) {
          body.tools = [{ type: 'web_search', web_search: webSearchParams }]
        } else {
          // 默认参数，智谱可能需要 search_mode
          body.tools = [{ type: 'web_search', web_search: { search_mode: 'online' } }]
        }
      } else if (web_search_method === 'extra_body') {
        // 合并到请求体顶层（兼容 DashScope 等 API，如千问 enable_search）
        body.enable_search = true
      } else if (web_search_method === 'web_search_options') {
        // 部分 OpenAI 兼容 API 支持 web_search_options 参数
        // 注意：DeepSeek v4 文档中未提及此参数，建议将 DeepSeek 的 web_search_method 设为 'none'
        body.web_search_options = { search_mode: 'auto' }
      } else if (web_search_method === 'native') {
        // 搜索引擎本身支持搜索，无需额外参数
      }
    }

    return body
  }
}
