import { AIAdapter, AIAdapterCallOptions, AIAdapterResult } from './base'

interface WebSearchResult {
  title: string
  content: string
  link: string
  media?: string
  publish_date?: string
}

interface WebSearchResponse {
  search_result?: WebSearchResult[]
  error?: { code: string; message: string }
}

/**
 * 智谱 GLM 专用适配器
 *
 * 智谱的网络搜索是独立 API（POST /paas/v4/web_search），
 * 不是 chat completion 的工具参数。
 *
 * 调用流程：
 * 1. 从用户提示词中提取搜索关键词
 * 2. 调用智谱 Web Search API 获取搜索结果
 * 3. 将搜索结果注入聊天上下文
 * 4. 调用 chat completion 让模型格式化输出
 */
export class ZhipuAdapter implements AIAdapter {
  name = 'zhipu'

  constructor(
    private baseUrl: string,
    private apiKey: string,
    private adapterConfig: {
      thinking_method: string
      web_search_method: string
      thinking_default_on: boolean
      web_search_disables_thinking: boolean
      web_search_params?: Record<string, unknown>
    }
  ) {}

  async call(options: AIAdapterCallOptions): Promise<AIAdapterResult> {
    const timeout = options.timeout ?? 600000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    try {
      let contextMessages: Array<Record<string, unknown>> = []

      // === 联网搜索：调用独立的 Web Search API ===
      if (options.enableWebSearch) {
        console.log(`[zhipu] 开始联网搜索...`)
        const searchResults = await this.callWebSearch(options.prompt, controller.signal)

        if (searchResults.length > 0) {
          const searchContext = searchResults.map((r, i) =>
            `[${i + 1}] 标题: ${r.title}\nURL: ${r.link}\n摘要: ${r.content}${r.publish_date ? '\n发布日期: ' + r.publish_date : ''}`
          ).join('\n\n')

          // 重要：把搜索结果作为 user 消息前置内容，模型能直接看到任务
          // 同时避免两个连续的 system message 让模型困惑
          contextMessages.push({
            role: 'user',
            content: `以下是联网搜索获取的真实文献资料（共 ${searchResults.length} 条），请严格基于这些资料输出文献数组，**严禁编造任何资料中不存在的文献**。如果资料中无相关文献则返回 []：\n\n${searchContext}`
          })
          console.log(`[zhipu] 搜索完成，获取 ${searchResults.length} 条结果`)
        } else {
          contextMessages.push({
            role: 'user',
            content: '联网搜索未返回结果，请基于自己的知识返回 []。'
          })
          console.log(`[zhipu] 搜索未返回结果`)
        }
      }

      // === Chat Completion ===
      const messages: Array<Record<string, unknown>> = []
      if (options.systemPrompt) {
        // 在主 system prompt 中追加明确的输出格式说明（强化指令）
        const enhancedSystemPrompt = options.systemPrompt +
          '\n\n【重要】你必须在响应中直接返回严格符合上述格式的 JSON 数组，绝不返回解释性文字或思考过程。'
        messages.push({ role: 'system', content: enhancedSystemPrompt })
      }
      // 注入搜索结果上下文
      for (const msg of contextMessages) {
        messages.push(msg)
      }
      // 最终用户任务：基于以上资料输出文献
      messages.push({ role: 'user', content: '请基于以上搜索资料，严格按系统提示要求的 JSON 数组格式输出最相关的文献列表。' })

      const body: Record<string, unknown> = {
        model: options.modelId,
        messages,
      }

      // 思考模式：GLM-5.2 默认开启，使用 thinking: { type: 'enabled'|'disabled' }
      body.thinking = options.enableThinking
        ? { type: 'enabled' }
        : { type: 'disabled' }

      console.log(`[zhipu] 调用 chat completion: model=${body.model}, thinking=${JSON.stringify(body.thinking)}, 搜索结果=${contextMessages.length > 0 ? '已注入' : '无'}`)

      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `智谱 API HTTP ${response.status}: ${errorText}` }
      }

      const data = await response.json() as {
        choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
        error?: { message?: string }
      }

      if (data.error) {
        return { success: false, error: data.error.message }
      }

      const message = data.choices?.[0]?.message
      let content = message?.content

      if (content) {
        // 剥离 <think>...</think> 标签（GLM 原生格式下思考内容可能混入 content）
        if (content.includes('<think>')) {
          content = content.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
          console.log(`[zhipu] 剥离 <think> 标签后内容长度: ${content.length} 字符`)
        }
        console.log(`[zhipu] 响应内容长度: ${content.length} 字符`)
        return { success: true, content }
      }

      return { success: false, error: '智谱 API 返回内容为空' }
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, error: `智谱 API 请求超时（${timeout / 1000}秒）` }
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * 调用智谱 Web Search API（独立端点）
   */
  private async callWebSearch(prompt: string, signal: AbortSignal): Promise<WebSearchResult[]> {
    try {
      const searchQuery = this.extractSearchKeywords(prompt)
      console.log(`[zhipu] 搜索关键词: "${searchQuery}"`)

      const searchBody: Record<string, unknown> = {
        search_query: searchQuery,
        search_engine: 'search_std',
        search_intent: false,
        count: 20,
      }

      // 合并自定义搜索参数（如指定搜索引擎）
      if (this.adapterConfig.web_search_params) {
        Object.assign(searchBody, this.adapterConfig.web_search_params)
      }

      const response = await fetch(`${this.baseUrl}/web_search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(searchBody),
        signal
      })

      if (!response.ok) {
        console.error(`[zhipu] Web Search API HTTP ${response.status}: ${await response.text()}`)
        return []
      }

      const data = await response.json() as WebSearchResponse

      if (data.error) {
        console.error(`[zhipu] Web Search 错误: ${data.error.message}`)
        return []
      }

      if (!data.search_result?.length) {
        console.log(`[zhipu] 搜索无结果`)
        return []
      }

      return data.search_result.map(r => ({
        title: r.title || '',
        content: r.content || '',
        link: r.link || '',
        media: r.media,
        publish_date: r.publish_date,
      }))
    } catch (err: unknown) {
      console.error(`[zhipu] Web Search 异常: ${err instanceof Error ? err.message : String(err)}`)
      return []
    }
  }

  /**
   * 从提示词中提取搜索关键词
   * 智谱 Web Search API 限制 search_query 不超过 70 字符
   */
  private extractSearchKeywords(prompt: string): string {
    // 尝试提取发明名称
    const titleMatch = prompt.match(/发明名称[：:]\s*(.+)/)
    // 尝试提取技术领域
    const fieldMatch = prompt.match(/技术领域[：:]\s*(.+)/)
    // 尝试提取关键词
    const keywordMatch = prompt.match(/关键词[：:]\s*(.+)/)

    const parts: string[] = []
    if (titleMatch) parts.push(titleMatch[1].trim())
    if (keywordMatch) parts.push(keywordMatch[1].trim())
    if (fieldMatch && parts.join(' ').length < 50) parts.push(fieldMatch[1].trim())

    let query = parts.join(' ') || prompt.substring(0, 70)

    // 智谱 API 限制 70 字符
    if (query.length > 70) {
      query = query.substring(0, 67) + '...'
    }

    return query
  }
}
