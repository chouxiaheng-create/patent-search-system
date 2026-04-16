export interface AIAdapterCallOptions {
  modelId: string
  prompt: string
  systemPrompt?: string
  enableThinking?: boolean
  enableWebSearch?: boolean
  timeout?: number
}

export interface AIAdapterResult {
  success: boolean
  content?: string
  error?: string
}

export interface AIAdapter {
  name: string
  call(options: AIAdapterCallOptions): Promise<AIAdapterResult>
}
