-- ⚠️ 本脚本于 2026-08-04 校准为"当前已验证可用"的模型配置。
--
-- 历史版本曾把 DeepSeek/MiniMax 的 web_search_method 写成 'tools_web_search'，
-- 该工具类型被这两家 API 拒绝（HTTP 400 "tools[0].type: unknown variant"，任务 abandoned）。
-- 当前版本与数据库实际配置一致：DeepSeek/MiniMax 使用 'agentic'（type:'function' 工具 + 适配器自行搜索）。
-- 请勿回退到旧配置；如需校准数据库，优先执行迁移 20260804_calibrate_openai_compat_web_search.sql。
-- 请在 Supabase Dashboard > SQL Editor 中执行此脚本。

-- 1. DeepSeek: deepseek-v4-flash + agentic 联网（实测可用）
UPDATE ai_models SET
  model_id = 'deepseek-v4-flash',
  capabilities = '{"deep_reasoning": true, "web_search": true}'::jsonb,
  adapter_config = '{
    "provider": "openai_compat",
    "web_search_method": "agentic",
    "thinking_method": "default_on",
    "reasoning_effort": "high",
    "web_search_disables_thinking": false,
    "thinking_default_on": true
  }'::jsonb
WHERE name = 'DeepSeek' AND is_builtin = true;

-- 2. 阿里千问: qwen3.7-max（extra_body 模式不变）
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

-- 3. Kimi: kimi-k2.6 + $web_search 内置工具（独立 kimi 适配器）
UPDATE ai_models SET
  model_id = 'kimi-k2.6',
  capabilities = '{"deep_reasoning": true, "web_search": true}'::jsonb,
  adapter_config = '{
    "provider": "kimi",
    "web_search_method": "tools_builtin",
    "web_search_tool_name": "$web_search",
    "thinking_method": "default_on",
    "web_search_disables_thinking": false,
    "thinking_default_on": true
  }'::jsonb
WHERE name = 'Kimi' AND is_builtin = true;

-- 4. 智谱GLM: glm-5.1（独立 zhipu 适配器；tools_web_search 对其有效）
UPDATE ai_models SET
  model_id = 'glm-5.1',
  capabilities = '{"deep_reasoning": true, "web_search": true}'::jsonb,
  adapter_config = '{
    "provider": "zhipu",
    "web_search_method": "tools_web_search",
    "thinking_method": "default_on",
    "web_search_disables_thinking": false,
    "thinking_default_on": true
  }'::jsonb
WHERE name = '智谱GLM' AND is_builtin = true;

-- 5. MiniMax: MiniMax-M3 + agentic 联网（实测可用；tools_web_search 已被 API 拒绝）
UPDATE ai_models SET
  model_id = 'MiniMax-M3',
  capabilities = '{"deep_reasoning": true, "web_search": true}'::jsonb,
  adapter_config = '{
    "provider": "openai_compat",
    "web_search_method": "agentic",
    "thinking_method": "default_on",
    "web_search_disables_thinking": false,
    "thinking_default_on": true
  }'::jsonb
WHERE name = 'MiniMax' AND is_builtin = true;

-- 6. 秘塔AI: metaso-search（原生搜索，无需修改，仅校准 model_id）
UPDATE ai_models SET
  model_id = 'metaso-search',
  capabilities = '{"deep_reasoning": false, "web_search": true}'::jsonb,
  adapter_config = '{
    "provider": "metaso",
    "web_search_method": "native",
    "thinking_method": "none",
    "web_search_disables_thinking": false,
    "thinking_default_on": false
  }'::jsonb
WHERE name = '秘塔AI' AND is_builtin = true;

-- 验证更新结果
SELECT name, model_id, adapter_config
FROM ai_models
WHERE is_builtin = true
ORDER BY name;
