-- 更新所有内置模型（除秘塔AI）到最新最强版本
-- 默认开启深度思考、联网搜索功能

-- 1. DeepSeek: deepseek-chat → deepseek-v4-pro
UPDATE ai_models SET
  model_id = 'deepseek-v4-pro',
  capabilities = '{"deep_reasoning": true, "web_search": true}'::jsonb,
  adapter_config = '{
    "provider": "openai_compat",
    "web_search_method": "tools_web_search",
    "thinking_method": "default_on",
    "web_search_disables_thinking": false,
    "thinking_default_on": true
  }'::jsonb
WHERE name = 'DeepSeek' AND is_builtin = true;

-- 2. 阿里千问: qwen3-max → qwen3.7-max
UPDATE ai_models SET
  model_id = 'qwen3.7-max',
  capabilities = '{"deep_reasoning": true, "web_search": true}'::jsonb,
  adapter_config = '{
    "provider": "openai_compat",
    "web_search_method": "extra_body",
    "thinking_method": "extra_body",
    "web_search_disables_thinking": false,
    "thinking_default_on": true
  }'::jsonb
WHERE name = '阿里千问' AND is_builtin = true;

-- 3. Kimi K2.6: 保持 model_id，开启默认思考
UPDATE ai_models SET
  capabilities = '{"deep_reasoning": true, "web_search": true}'::jsonb,
  adapter_config = '{
    "provider": "openai_compat",
    "web_search_method": "tools_builtin",
    "web_search_tool_name": "$web_search",
    "thinking_method": "default_on",
    "web_search_disables_thinking": false,
    "thinking_default_on": true
  }'::jsonb
WHERE name = 'Kimi K2.6' AND is_builtin = true;

-- 4. 智谱GLM: glm-4 → glm-5.1
UPDATE ai_models SET
  model_id = 'glm-5.1',
  capabilities = '{"deep_reasoning": true, "web_search": true}'::jsonb,
  adapter_config = '{
    "provider": "openai_compat",
    "web_search_method": "tools_web_search",
    "thinking_method": "default_on",
    "web_search_disables_thinking": false,
    "thinking_default_on": true
  }'::jsonb
WHERE name = '智谱GLM-5.1' AND is_builtin = true;

-- 5. MiniMax: MiniMax-M2 → MiniMax-M2.7
UPDATE ai_models SET
  model_id = 'MiniMax-M2.7',
  capabilities = '{"deep_reasoning": true, "web_search": true}'::jsonb,
  adapter_config = '{
    "provider": "openai_compat",
    "web_search_method": "tools_web_search",
    "thinking_method": "default_on",
    "web_search_disables_thinking": false,
    "thinking_default_on": true
  }'::jsonb
WHERE name = 'MiniMax' AND is_builtin = true;

-- 秘塔AI 保持不变（原生搜索，无需修改）
