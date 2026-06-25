-- 修复多个模型的 adapter_config
--
-- 1. DeepSeek: 不支持 web_search（v4 API 无此工具），改 web_search_method=none
--    之前 PATCH 似乎没生效或被覆盖
-- 2. Kimi K2.6: 必须用专用 KimiAdapter（处理 $web_search 多步工具调用）
--    provider=openai_compat 时只走单步，96 字符 search_id 引用而非真实结果
-- 3. 智谱GLM-5.1: 必须用专用 ZhipuAdapter（独立 Web Search API + 结果注入）
--    provider=openai_compat 时模型没正确调用 web_search 工具，返回 []
-- 4. MiniMax: API key 无效，禁用 web_search 减少无效请求

UPDATE public.ai_models
SET adapter_config = adapter_config ||
  jsonb_build_object(
    'web_search_method', 'none',
    'reasoning_effort', 'high'
  )
WHERE name = 'DeepSeek';

UPDATE public.ai_models
SET adapter_config = jsonb_set(adapter_config, '{provider}', '"kimi"'::jsonb)
WHERE name = 'Kimi K2.6';

UPDATE public.ai_models
SET adapter_config = jsonb_set(adapter_config, '{provider}', '"zhipu"'::jsonb)
WHERE name = '智谱GLM-5.1';

UPDATE public.ai_models
SET adapter_config = adapter_config ||
  jsonb_build_object('web_search_method', 'none')
WHERE name = 'MiniMax';
