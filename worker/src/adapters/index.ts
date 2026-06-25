import { AIAdapter } from './base'
import { OpenAICompatAdapter } from './openai-compat'
import { MetasoAdapter } from './metaso'
import { KimiAdapter } from './kimi'
import { ZhipuAdapter } from './zhipu'
import { MockAdapter } from './mock-adapter'
import type { AIModelRecord } from '../types'

export { AIAdapter, AIAdapterCallOptions, AIAdapterResult } from './base'

/**
 * 创建 AI 适配器。
 * 当环境变量 MOCK_MODE=true 时，返回 MockAdapter，用于在 API 不可用时继续开发。
 */
export function createAdapter(model: AIModelRecord): AIAdapter {
  if (process.env.MOCK_MODE === 'true') {
    console.log(`[adapter] MOCK_MODE enabled, using MockAdapter for model ${model.id}`)
    return new MockAdapter()
  }

  if (model.adapter_config.provider === 'metaso') {
    return new MetasoAdapter(model.api_base_url, model.api_key_encrypted)
  }

  if (model.adapter_config.provider === 'kimi') {
    return new KimiAdapter(
      model.api_base_url,
      model.api_key_encrypted,
      model.adapter_config
    )
  }

  if (model.adapter_config.provider === 'zhipu') {
    return new ZhipuAdapter(
      model.api_base_url,
      model.api_key_encrypted,
      model.adapter_config
    )
  }

  return new OpenAICompatAdapter(
    model.api_base_url,
    model.api_key_encrypted,
    model.adapter_config
  )
}
