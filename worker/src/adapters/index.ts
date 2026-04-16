import { AIAdapter } from './base'
import { OpenAICompatAdapter, AIModelRecord } from './openai-compat'
import { MetasoAdapter } from './metaso'

export { AIAdapter, AIAdapterCallOptions, AIAdapterResult } from './base'

export function createAdapter(model: AIModelRecord): AIAdapter {
  if (model.adapter_config.provider === 'metaso') {
    return new MetasoAdapter(model.api_base_url, model.api_key_encrypted)
  }
  return new OpenAICompatAdapter(
    model.api_base_url,
    model.api_key_encrypted,
    model.adapter_config
  )
}
