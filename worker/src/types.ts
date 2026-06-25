// worker/src/types.ts — Worker 共享类型定义

export interface AIModelRecord {
  id: string
  owner_id: string | null
  name: string
  api_base_url: string
  api_key_encrypted: string
  model_id: string
  is_builtin: boolean
  usage_types: string[]
  adapter_config: AdapterConfig
  created_at: string
}

export interface AdapterConfig {
  provider: 'openai_compat' | 'metaso' | 'kimi' | 'zhipu'
  web_search_method: 'tools_builtin' | 'tools_web_search' | 'extra_body' | 'native' | 'web_search_options' | 'none'
  web_search_tool_name?: string
  web_search_params?: Record<string, unknown>
  thinking_method: 'param' | 'model_switch' | 'extra_body' | 'default_on' | 'reasoning_split' | 'none'
  thinking_model_id?: string
  reasoning_effort?: 'high' | 'max'
  web_search_disables_thinking: boolean
  thinking_default_on: boolean
}

export interface SearchStrategyRecord {
  id: string
  owner_id: string | null
  name: string
  prompt_template: string
  is_builtin: boolean
  created_at: string
}
