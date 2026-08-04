-- supabase/migrations/20260804_calibrate_openai_compat_web_search.sql
-- 校准迁移：openai_compat 模型的 web_search_method 若被设为 'tools_web_search'，统一校准为 'agentic'。
--
-- 背景（2026-08-04 实测）：DeepSeek / MiniMax 等 OpenAI 兼容 API 拒绝 `type: 'web_search'` 工具
-- （HTTP 400 "tools[0].type: unknown variant `web_search`, expected `function`"）。
-- 历史配置（scripts/update-models.sql 旧版、迁移 20260416000002 / 20260515000001）曾把
-- DeepSeek/MiniMax 写成 tools_web_search，导致任务 400 abandoned。
-- 'agentic'（type:'function' 工具 + 适配器自行搜索）为实测可行的替代方案。
--
-- 幂等：DO 块条件更新，重复执行无副作用。智谱（provider='zhipu'，独立适配器）不受影响。
-- 代码层另有兜底：openai-compat 适配器遇 "unknown variant" 400 时自动降级 agentic（见 openai-compat.ts）。

DO $$
BEGIN
  UPDATE ai_models
  SET adapter_config = adapter_config || '{"web_search_method": "agentic"}'::jsonb
  WHERE adapter_config->>'provider' = 'openai_compat'
    AND adapter_config->>'web_search_method' = 'tools_web_search';
END $$;
