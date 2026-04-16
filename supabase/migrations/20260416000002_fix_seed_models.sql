-- 修正 Kimi K2.5（旧 model_id = moonshot-v1-32k）
UPDATE ai_models SET
  model_id = 'kimi-k2.5',
  adapter_config = '{
    "provider": "openai_compat",
    "web_search_method": "tools_builtin",
    "web_search_tool_name": "$web_search",
    "thinking_method": "default_on",
    "web_search_disables_thinking": true,
    "thinking_default_on": true
  }'::jsonb
WHERE name = 'Kimi K2.5' AND is_builtin = true;

-- 修正 智谱GLM-5.1（旧 model_id = glm-4）
UPDATE ai_models SET
  model_id = 'glm-5.1',
  adapter_config = '{
    "provider": "openai_compat",
    "web_search_method": "tools_web_search",
    "thinking_method": "param",
    "web_search_disables_thinking": false,
    "thinking_default_on": false
  }'::jsonb
WHERE name = '智谱GLM-5.1' AND is_builtin = true;

-- 修正 秘塔AI
UPDATE ai_models SET
  api_base_url = 'https://metaso.cn/api',
  adapter_config = '{
    "provider": "metaso",
    "web_search_method": "native",
    "thinking_method": "none",
    "web_search_disables_thinking": false,
    "thinking_default_on": false
  }'::jsonb
WHERE name = '秘塔AI' AND is_builtin = true;

-- 新增 DeepSeek
INSERT INTO ai_models (name, api_base_url, model_id, is_builtin, usage_types, capabilities, api_key_encrypted, adapter_config)
VALUES (
  'DeepSeek',
  'https://api.deepseek.com/v1',
  'deepseek-chat',
  true,
  ARRAY['search', 'parse', 'report'],
  '{"deep_reasoning": true, "web_search": false}',
  '',
  '{
    "provider": "openai_compat",
    "web_search_method": "none",
    "thinking_method": "model_switch",
    "thinking_model_id": "deepseek-reasoner",
    "web_search_disables_thinking": false,
    "thinking_default_on": false
  }'::jsonb
);

-- 新增 千问(Qwen)
INSERT INTO ai_models (name, api_base_url, model_id, is_builtin, usage_types, capabilities, api_key_encrypted, adapter_config)
VALUES (
  '阿里千问',
  'https://dashscope.aliyuncs.com/compatible-mode/v1',
  'qwen3-max',
  true,
  ARRAY['search', 'parse', 'report'],
  '{"deep_reasoning": true, "web_search": true}',
  '',
  '{
    "provider": "openai_compat",
    "web_search_method": "extra_body",
    "thinking_method": "extra_body",
    "web_search_disables_thinking": true,
    "thinking_default_on": false
  }'::jsonb
);

-- 新增 MiniMax
INSERT INTO ai_models (name, api_base_url, model_id, is_builtin, usage_types, capabilities, api_key_encrypted, adapter_config)
VALUES (
  'MiniMax',
  'https://api.minimax.io/v1',
  'MiniMax-M2',
  true,
  ARRAY['search', 'parse', 'report'],
  '{"deep_reasoning": true, "web_search": true}',
  '',
  '{
    "provider": "openai_compat",
    "web_search_method": "tools_web_search",
    "thinking_method": "extra_body",
    "web_search_disables_thinking": false,
    "thinking_default_on": false
  }'::jsonb
);
