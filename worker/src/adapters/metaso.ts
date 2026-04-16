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
      const response = await fetch(`${this.baseUrl}/search`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          query: options.prompt,
          model: options.modelId
        }),
        signal: controller.signal
      })

      clearTimeout(timeoutId)

      if (!response.ok) {
        const errorText = await response.text()
        return { success: false, error: `HTTP ${response.status}: ${errorText}` }
      }

      const data = await response.json() as { results?: Array<{ content?: string }>; answer?: string; error?: string }

      if (data.error) {
        return { success: false, error: data.error }
      }

      const content = data.answer || data.results?.map(r => r.content).join('\n') || ''
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
