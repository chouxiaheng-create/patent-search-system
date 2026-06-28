import { AIAdapter, AIAdapterCallOptions, AIAdapterResult } from './base'
import { webSearch, type WebSearchHit } from '../services/web-search'

export interface AIModelRecord {
  id: string
  name: string
  api_base_url: string
  api_key_encrypted: string
  model_id: string
  adapter_config: {
    provider: 'openai_compat' | 'metaso' | 'kimi' | 'zhipu'
    web_search_method: 'tools_builtin' | 'tools_web_search' | 'extra_body' | 'native' | 'web_search_options' | 'agentic' | 'none'
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
      // agentic 联网：DeepSeek/MiniMax 等无服务端搜索的模型，由适配器自身跑工具调用循环
      if (options.enableWebSearch && this.adapterConfig.web_search_method === 'agentic') {
        return await this.agenticCall(options, controller)
      }

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

    const { web_search_method, web_search_disables_thinking } = this.adapterConfig

    // 处理深度思考（抽到 applyThinkingParams，agentic 循环也复用）
    // 注意：web_search 开启且 web_search_disables_thinking=true 时，下方联网段会清除 thinking 参数
    this.applyThinkingParams(body, options.enableThinking)

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

  // ============ Agentic 联网（工具调用循环） ============
  // 用于 web_search_method='agentic' 的模型（DeepSeek/MiniMax）：
  // 模型 API 不提供服务端网页搜索，由适配器声明 web_search 函数工具，LLM 决定搜什么，
  // 适配器代为执行真实搜索（Tavily），把结果回灌为 tool 消息，循环直到 LLM 输出最终 JSON 或触顶。

  /**
   * 将思考参数写入请求体（从 buildRequestBody 抽出，agentic 循环复用）。
   */
  private applyThinkingParams(body: Record<string, unknown>, enableThinking: boolean | undefined): void {
    const { thinking_method, thinking_model_id, reasoning_effort } = this.adapterConfig
    if (thinking_method === 'model_switch' && thinking_model_id && enableThinking) {
      body.model = thinking_model_id
    } else if (thinking_method === 'param') {
      body.thinking = enableThinking ? { type: 'enabled' } : { type: 'disabled' }
    } else if (thinking_method === 'default_on') {
      if (enableThinking) {
        const thinkingParam: Record<string, unknown> = { type: 'enabled' }
        body.thinking = thinkingParam
        if (reasoning_effort) body.reasoning_effort = reasoning_effort
      } else {
        body.thinking = { type: 'disabled' }
      }
    } else if (thinking_method === 'extra_body') {
      if (enableThinking) body.enable_thinking = true
    } else if (thinking_method === 'reasoning_split') {
      body.reasoning_split = enableThinking
    }
    // 'none' → 不设置任何思考参数
  }

  private static readonly WEB_SEARCH_TOOL = {
    type: 'function' as const,
    function: {
      name: 'web_search',
      description: '在互联网上搜索与专利检索相关的文献、论文、专利公开。当需要查找真实、最新的文献信息时调用。query 为搜索关键词。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '搜索关键词，中英文均可' }
        },
        required: ['query']
      }
    }
  }

  private async agenticCall(
    options: AIAdapterCallOptions,
    controller: AbortController
  ): Promise<AIAdapterResult> {
    const maxRounds = Math.max(1, Number(process.env.WEB_SEARCH_MAX_ROUNDS) || 3)
    // 联网开启时若配置了 web_search_disables_thinking，则关闭思考
    const enableThinking = options.enableThinking && !this.adapterConfig.web_search_disables_thinking

    const messages: Array<Record<string, unknown>> = []
    if (options.systemPrompt) messages.push({ role: 'system', content: options.systemPrompt })
    messages.push({ role: 'user', content: options.prompt })

    console.log(`[adapter] agentic 循环开始 model=${options.modelId} maxRounds=${maxRounds}`)

    for (let round = 0; round < maxRounds; round++) {
      const body: Record<string, unknown> = {
        model: options.modelId,
        messages,
        tools: [OpenAICompatAdapter.WEB_SEARCH_TOOL],
        tool_choice: 'auto',
      }
      this.applyThinkingParams(body, enableThinking)

      const res = await this.chatCompletions(body, controller)
      if (!res.ok) return { success: false, error: res.error }

      const message = res.message
      // 把 assistant 回合原样追加，保持上下文（含 tool_calls 以对齐后续 tool 消息）
      messages.push(this.serializeAssistantMessage(message))

      const toolCalls = message?.tool_calls
      if (toolCalls && toolCalls.length > 0) {
        for (const tc of toolCalls) {
          const id = (tc as { id?: string })?.id ?? `call_${round}`
          const query = this.extractToolCallQuery(tc)
          if (!query) {
            messages.push({ role: 'tool', tool_call_id: id, content: '搜索关键词为空，跳过' })
            continue
          }
          console.log(`[adapter] agentic 第${round + 1}轮 搜索: "${query}"`)
          try {
            const hits = await webSearch(query, controller.signal)
            const toolContent = hits.length ? this.formatSearchHits(hits) : '搜索未返回结果'
            messages.push({ role: 'tool', tool_call_id: id, content: toolContent })
            console.log(`[adapter] agentic 第${round + 1}轮 搜索返回 ${hits.length} 条`)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            console.warn(`[adapter] agentic 第${round + 1}轮 搜索失败: ${msg}`)
            messages.push({ role: 'tool', tool_call_id: id, content: `搜索失败: ${msg}` })
          }
        }
        continue // 让 LLM 基于搜索结果继续
      }

      // 无 tool_calls → 最终内容
      if (message?.content) {
        let content = message.content
        if (content.includes('<think>')) {
          // 兼容部分模型把思考混入 content（<think>...</think>）
          content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
        }
        console.log(`[adapter] agentic 第${round + 1}轮 返回最终内容 (${content.length} 字符)`)
        return { success: true, content }
      }

      // 既无 content 也无 tool_calls，停止空转
      break
    }

    // 触顶或空转：强制收尾，不带 tools，要求直接输出 JSON
    console.log(`[adapter] agentic 触顶，强制收尾`)
    messages.push({
      role: 'user',
      content: '请基于以上已搜索到的资料，现在直接返回符合系统提示要求的 JSON 文献数组，不要再调用搜索工具。'
    })
    const finalBody: Record<string, unknown> = { model: options.modelId, messages }
    this.applyThinkingParams(finalBody, enableThinking)
    const finalRes = await this.chatCompletions(finalBody, controller)
    if (!finalRes.ok) return { success: false, error: finalRes.error }
    const finalContent = finalRes.message?.content
    if (finalContent) {
      let content = finalContent
      if (content.includes('<think>')) {
        content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
      }
      return { success: true, content }
    }
    return { success: false, error: 'agentic 循环触顶且最终未返回内容' }
  }

  /**
   * 调用 chat/completions，统一处理 HTTP/业务错误。
   */
  private async chatCompletions(
    body: Record<string, unknown>,
    controller: AbortController
  ): Promise<{ ok: true; message: { content?: string; tool_calls?: unknown[] } | undefined } | { ok: false; error: string }> {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, error: `HTTP ${response.status}: ${text}` }
    }

    const data = await response.json() as {
      choices?: Array<{ message?: { content?: string; tool_calls?: unknown[] } }>
      error?: { message?: string }
    }
    if (data.error) return { ok: false, error: data.error.message ?? JSON.stringify(data.error) }
    return { ok: true, message: data.choices?.[0]?.message }
  }

  /**
   * 把模型返回的 assistant 消息序列化回 messages（保留 tool_calls 以对齐后续 tool 消息）。
   */
  private serializeAssistantMessage(message: { content?: string; tool_calls?: unknown[] } | undefined): Record<string, unknown> {
    const msg: Record<string, unknown> = { role: 'assistant' }
    if (message?.tool_calls && message.tool_calls.length > 0) {
      msg.tool_calls = message.tool_calls
      msg.content = message.content ?? ''
    } else {
      msg.content = message?.content ?? ''
    }
    return msg
  }

  private extractToolCallQuery(toolCall: unknown): string {
    try {
      const tc = toolCall as { function?: { arguments?: string | Record<string, unknown> } }
      const args = tc?.function?.arguments
      if (!args) return ''
      const parsed = typeof args === 'string' ? JSON.parse(args) : args
      const obj = (parsed ?? {}) as Record<string, unknown>
      return String(obj.query ?? obj.q ?? obj.keyword ?? '').trim()
    } catch {
      return ''
    }
  }

  private formatSearchHits(hits: WebSearchHit[]): string {
    return hits.map((h, i) =>
      `[${i + 1}] 标题: ${h.title}\nURL: ${h.url}${h.pub_date ? `\n发布日期: ${h.pub_date}` : ''}\n摘要: ${h.snippet}`
    ).join('\n\n')
  }
}
