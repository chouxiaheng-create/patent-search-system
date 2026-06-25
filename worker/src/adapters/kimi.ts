import { AIAdapter, AIAdapterCallOptions, AIAdapterResult } from './base'

interface KimiToolCall {
  id: string
  function?: { name?: string; arguments?: string }
}

interface KimiMessage {
  content?: string
  tool_calls?: KimiToolCall[]
  reasoning_content?: string
  [key: string]: unknown
}

interface KimiResponse {
  choices?: Array<{ message?: KimiMessage }>
  error?: { message?: string }
}

/**
 * Kimi (Moonshot AI) 专用适配器
 *
 * 核心特性：$web_search 是多步工具调用
 * 1. 第一次调用：注册 $web_search 工具 → 模型返回 tool_calls（搜索参数）
 * 2. 回传参数：将 arguments 原封不动作为 role=tool 消息返回
 * 3. 第二次调用：Kimi 服务端执行搜索 → 返回包含搜索结果的最终回答
 *
 * 关键约束：使用 $web_search 时必须禁用思考能力（thinking: disabled）
 */
export class KimiAdapter implements AIAdapter {
  name = 'kimi'

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private adapterConfig: {
      thinking_method: string
      web_search_method: string
      thinking_default_on: boolean
      web_search_disables_thinking: boolean
      web_search_tool_name?: string
    }
  ) {}

  async call(options: AIAdapterCallOptions): Promise<AIAdapterResult> {
    const timeout = options.timeout ?? 600000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      const messages: Array<Record<string, unknown>> = []
      if (options.systemPrompt) {
        messages.push({ role: 'system', content: options.systemPrompt })
      }
      messages.push({ role: 'user', content: options.prompt })

      // === 第一步：带 $web_search 工具声明发起请求 ===
      const body1 = this.buildRequestBody(options, messages)
      const useWebSearch = options.enableWebSearch &&
        this.adapterConfig.web_search_method === 'tools_builtin'

      if (useWebSearch) {
        const toolName = this.adapterConfig.web_search_tool_name || '$web_search'
        body1.tools = [{
          type: 'builtin_function',
          function: { name: toolName }
        }]
        // 文档明确要求：使用 $web_search 时必须禁用思考
        body1.thinking = { type: 'disabled' }
      }

      console.log(`[kimi] 第1次调用: model=${body1.model} tools=${!!body1.tools} thinking=${JSON.stringify(body1.thinking || 'default')}`)

      const response1 = await this.callApi(body1, controller.signal)
      clearTimeout(timeoutId)

      if (!response1.ok) {
        const errorText = await response1.text()
        return { success: false, error: `Kimi API HTTP ${response1.status}: ${errorText}` }
      }

      const data1 = await this.parseResponse(response1)
      if (data1.error) {
        return { success: false, error: data1.error.message }
      }

      const choice1 = data1.choices?.[0]
      if (!choice1) {
        return { success: false, error: 'Kimi API 返回为空' }
      }

      // === 如果没有 tool_calls，直接返回 ===
      if (!choice1.message?.tool_calls?.length) {
        const content = choice1.message?.content
        if (content) {
          console.log(`[kimi] 直接返回 ${content.length} 字符`)
          return { success: true, content }
        }
        return { success: false, error: 'Kimi 返回内容为空' }
      }

      // === 第二步：处理 $web_search 多步调用 ===
      console.log(`[kimi] 模型触发 ${choice1.message.tool_calls.length} 个工具调用，执行联网搜索回传`)
      // 打印模型生成的搜索参数（调试用，便于排查 query 质量问题）
      for (const tc of choice1.message.tool_calls) {
        console.log(`[kimi] 工具参数: ${tc.function?.arguments?.substring(0, 200)}`)
      }

      // 将 assistant 消息（含 tool_calls）加入上下文
      messages.push(this.buildAssistantMessage(choice1.message))

      // 回传工具调用结果（原封不动返回 arguments）
      for (const toolCall of choice1.message.tool_calls) {
        const args = toolCall.function?.arguments || '{}'
        messages.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          name: toolCall.function?.name || '$web_search',
          content: args  // 原封不动回传，Kimi 服务端执行搜索
        })
      }

      // === 第三步：发起第二次请求获取最终结果 ===
      const body2 = this.buildRequestBody(options, messages)
      // 注意：第一次调用因 $web_search 禁用了 thinking，上下文中的 assistant 消息
      // 没有 reasoning_content。Kimi API 要求：若 thinking 启用，历史 assistant 消息
      // 必须包含 reasoning_content。因此第二次调用保持 thinking 禁用，与上下文一致。
      if (useWebSearch) {
        body2.thinking = { type: 'disabled' }
      }

      // 重要：给第 2 次调用追加宽松指令
      // Kimi 模型对"严格基于搜索结果"过度严格，搜索结果不完美时直接返回 []
      // 追加指令让模型允许"找不到精确匹配时返回主题相关的所有文献"
      if (useWebSearch && options.systemPrompt) {
        const relaxedPrompt = options.systemPrompt +
          '\n\n【追加指令】如果搜索结果中未包含精确匹配的文献（如未找到指定发明人的专利），请返回与查询主题相关的所有文献。允许基于搜索结果扩展推断。'
        const bodyMessages = body2.messages as Array<Record<string, unknown>>
        const sysIdx = bodyMessages.findIndex(m => m.role === 'system')
        if (sysIdx >= 0) {
          bodyMessages[sysIdx] = { ...bodyMessages[sysIdx], content: relaxedPrompt }
        }
      }

      // 调试：打印第2次请求的 messages 数和最后一条 user 消息的前 200 字
      const lastUser = [...messages].reverse().find(m => m.role === 'user')
      const lastUserContent = typeof lastUser?.content === 'string' ? lastUser.content : ''
      console.log(`[kimi] 第2次消息数: ${messages.length}, 最后 user prompt: "${lastUserContent.substring(0, 150)}"`)

      console.log(`[kimi] 第2次调用: model=${body2.model} thinking=${JSON.stringify(body2.thinking || 'default')}`)

      const timeoutId2 = setTimeout(() => controller.abort(), timeout)
      const response2 = await this.callApi(body2, controller.signal)
      clearTimeout(timeoutId2)

      if (!response2.ok) {
        const errorText = await response2.text()
        return { success: false, error: `Kimi API 第2次调用 HTTP ${response2.status}: ${errorText}` }
      }

      const data2 = await this.parseResponse(response2)
      if (data2.error) {
        return { success: false, error: data2.error.message }
      }

      const message2 = data2.choices?.[0]?.message

      // === 重试机制：第2步返回空时重发一次（Kimi 模型行为不稳定） ===
      // 触发条件：第 2 步没有 tool_calls 且 content 极短（≤ 2 字符如 "[]"）
      // 原因：模型可能因为随机性过度严格返回空，重发通常能得到真实结果
      let finalMessage = message2
      if (useWebSearch && !message2?.tool_calls?.length) {
        const content2 = message2?.content || ''
        if (content2.length <= 5) {
          console.log(`[kimi] 第2次返回过短(${content2.length}字符)，重发一次`)
          const timeoutIdRetry = setTimeout(() => controller.abort(), timeout)
          try {
            const response2Retry = await this.callApi(body2, controller.signal)
            clearTimeout(timeoutIdRetry)
            if (response2Retry.ok) {
              const data2Retry = await this.parseResponse(response2Retry)
              if (!data2Retry.error) {
                const retryMessage = data2Retry.choices?.[0]?.message
                if (retryMessage?.content && retryMessage.content.length > content2.length) {
                  console.log(`[kimi] 重发成功，从 ${content2.length} 字符提升到 ${retryMessage.content.length} 字符`)
                  finalMessage = retryMessage
                }
              }
            }
          } catch (retryErr) {
            console.log(`[kimi] 重发异常: ${retryErr instanceof Error ? retryErr.message : String(retryErr)}`)
          }
        }
      }

      // 可能需要多轮工具调用（文档示例中有 while 循环）
      // 检查是否还有 tool_calls（极少见，但安全处理）
      if (finalMessage?.tool_calls?.length) {
        console.log(`[kimi] 第2次调用仍有 ${finalMessage.tool_calls.length} 个工具调用，继续回传`)
        messages.push(this.buildAssistantMessage(finalMessage as unknown as Record<string, unknown>))
        for (const toolCall of finalMessage.tool_calls) {
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            name: toolCall.function?.name || '$web_search',
            content: toolCall.function?.arguments || '{}'
          })
        }

        const body3 = this.buildRequestBody(options, messages)
        // 同上：保持 thinking 禁用，与上下文一致
        if (useWebSearch) {
          body3.thinking = { type: 'disabled' }
        }
        console.log(`[kimi] 第3次调用`)
        const timeoutId3 = setTimeout(() => controller.abort(), timeout)
        const response3 = await this.callApi(body3, controller.signal)
        clearTimeout(timeoutId3)

        if (!response3.ok) {
          const errorText = await response3.text()
          return { success: false, error: `Kimi API 第3次调用 HTTP ${response3.status}: ${errorText}` }
        }
        const data3 = await this.parseResponse(response3)
        if (data3.error) {
          return { success: false, error: data3.error.message }
        }
        const content3 = data3.choices?.[0]?.message?.content
        if (content3) {
          console.log(`[kimi] 第3次调用返回 ${content3.length} 字符`)
          return { success: true, content: content3 }
        }
      }

      if (finalMessage?.content) {
        console.log(`[kimi] 联网搜索完成，最终回答 ${finalMessage.content.length} 字符`)
        return { success: true, content: finalMessage.content }
      }

      return { success: false, error: 'Kimi 联网搜索后未返回有效内容' }
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, error: `Kimi API 请求超时（${timeout / 1000}秒）` }
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * 构造 assistant 消息对象，保留 reasoning_content（如有）
   */
  private buildAssistantMessage(message: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {
      role: 'assistant',
      content: message.content || null,
    }
    if (message.tool_calls) {
      result.tool_calls = message.tool_calls
    }
    if (message.reasoning_content) {
      result.reasoning_content = message.reasoning_content
    }
    return result
  }

  private buildRequestBody(
    options: AIAdapterCallOptions,
    messages: Array<Record<string, unknown>>
  ): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model: options.modelId,
      messages,
    }

    // 思考参数（thinking_method: 'param'）
    if (this.adapterConfig.thinking_method === 'param') {
      body.thinking = options.enableThinking
        ? { type: 'enabled' }
        : { type: 'disabled' }
    }

    return body
  }

  private async callApi(
    body: Record<string, unknown>,
    signal: AbortSignal
  ): Promise<Response> {
    return fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`
      },
      body: JSON.stringify(body),
      signal
    })
  }

  private async parseResponse(response: Response): Promise<KimiResponse> {
    return response.json() as Promise<KimiResponse>
  }
}
