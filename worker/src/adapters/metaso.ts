import { AIAdapter, AIAdapterCallOptions, AIAdapterResult } from './base'

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

    try {
      const response = await fetch(`${this.baseUrl}/v1/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          q: options.prompt
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `HTTP ${response.status}: ${errorText}` }
      }

      const data = await response.json() as {
        errCode?: number
        errMsg?: string
        webpages?: Array<{ title?: string; link?: string; snippet?: string }>
      }

      if (data.errCode && data.errCode !== 0) {
        return { success: false, error: `Metaso API error: ${data.errCode} - ${data.errMsg}` }
      }

      if (!data.webpages || data.webpages.length === 0) {
        return { success: true, content: '' }
      }

      const content = data.webpages.map(w =>
        `标题：${w.title || '未知'}\n链接：${w.link || '无'}\n摘要：${w.snippet || '无'}`
      ).join('\n\n')

      return { success: true, content }
    } catch (err: unknown) {
      clearTimeout(timeoutId)
      if (err instanceof Error && err.name === 'AbortError') {
        return { success: false, error: `请求超时（${timeout / 1000}秒）` }
      }
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }
}
