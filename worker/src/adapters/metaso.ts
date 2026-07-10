import { AIAdapter, AIAdapterCallOptions, AIAdapterResult } from './base'

/**
 * 秘塔AI 搜索适配器
 * API: POST https://metaso.cn/api/v1/search
 * 文档: https://metaso.cn/search-api/playground
 */
export class MetasoAdapter implements AIAdapter {
  name = 'metaso'

  constructor(
    private baseUrl: string,
    private apiKey: string
  ) {}

  async call(options: AIAdapterCallOptions): Promise<AIAdapterResult> {
    const timeout = options.timeout ?? 600000
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), timeout)

    console.log(`[metaso] 开始调用: baseUrl=${this.baseUrl}, prompt前80字="${options.prompt.substring(0, 80)}"`)

    try {
      const response = await fetch(`${this.baseUrl}/v1/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          q: this.extractSearchQuery(options.prompt),
          scope: 'web',
          size: 20,
          includeSummary: true,
          conciseSnippet: true
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `秘塔API HTTP ${response.status}: ${errorText}` }
      }

      const data = await response.json() as {
        webpages?: Array<{
          title?: string
          link?: string
          snippet?: string
          date?: string
          score?: string
        }>
        total?: number
      }

      if (!data.webpages || data.webpages.length === 0) {
        const query = this.extractSearchQuery(options.prompt)
        console.log(`[metaso] 搜索关键词: "${query}", 返回 0 条结果`)
        return { success: true, content: '[]' }
      }

      // 直接返回 JSON 数组格式，与 parseSearchResults() 的 JSON 解析路径对接
      const results = data.webpages.map(w => ({
        title: w.title || '',
        url: w.link || '',
        authors: '未知',
        pub_date: w.date || '',
        relevance_desc: w.snippet || '',
        citation_gb: w.link || w.title || ''
      }))

      console.log(`[metaso] 搜索关键词: "${this.extractSearchQuery(options.prompt)}", 返回 ${results.length} 条结果`)
      return { success: true, content: JSON.stringify(results) }
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, error: `秘塔API请求超时（${timeout / 1000}秒）` }
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * 从提示词中提取搜索关键词
   *
   * 实际 prompt 格式（来自 search_strategies）：
   * - "提供由"{{inventor}}"发表的涉及"{{tech_theme}}"的相关文献或网页"
   * - "提供与"{{core_invention}}"技术构思最接近的文献或网页"
   * - "提供与"{{main_tech_steps}}"技术构思最接近的文献或网页"
   *
   * 关键：秘塔 scholar 搜索对 query 长度敏感，过长（>50字）会返回 0 results
   * 策略：剥离包装文字（"提供由"、"提供与"、"技术构思最接近"等），保留核心关键词
   */
  private extractSearchQuery(prompt: string): string {
    // 1. 尝试匹配"{{XXX}}"格式的引用内容（来自搜索策略模板）
    const quotedMatches = prompt.match(/"([^"]{4,})"/g)
    if (quotedMatches && quotedMatches.length > 0) {
      // 取最长的引号内容作为核心关键词
      const longest = quotedMatches
        .map(m => m.replace(/^"|"$/g, ''))
        .sort((a, b) => b.length - a.length)[0]

      // 秘塔 scholar 搜索建议 query ≤ 50 字符
      if (longest.length <= 50) return longest
      // 超过则截取前 50 字符
      return longest.substring(0, 50)
    }

    // 2. 尝试匹配"发明名称"等字段
    const titleMatch = prompt.match(/发明名称[：:]\s*([^\n]+)/)
    if (titleMatch) {
      const t = titleMatch[1].trim()
      return t.length > 50 ? t.substring(0, 50) : t
    }

    // 3. 剥离常见包装词，回退到正文
    let cleaned = prompt
      .replace(/^提供[由与]"[^"]*"/g, '')
      .replace(/技术构思[最]?接近的相关文献[或网页]*/g, '')
      .replace(/相关文献[或网页，,。]*/g, '')
      .replace(/注明出处链接和公开时间[，,。]*/g, '')
      .replace(/，按相关程度从高到低排序[，,。]*/g, '')
      .replace(/若不存在[，,。]*则输出[^。]*[。]/g, '')
      .trim()

    if (cleaned && cleaned.length >= 4) {
      return cleaned.length > 50 ? cleaned.substring(0, 50) : cleaned
    }

    // 4. 最后回退
    return prompt.substring(0, 50)
  }
}
