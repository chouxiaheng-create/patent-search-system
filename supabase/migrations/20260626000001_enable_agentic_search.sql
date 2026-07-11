-- DeepSeek / MiniMax：启用适配器 agentic 联网（工具调用循环 + Tavily 后端）
--
-- 背景：这两个模型的 API 都不提供服务端网页搜索——
--   DeepSeek 无搜索参数；MiniMax 的 tools:[{type:'web_search'}] 返回需客户端执行的 tool_calls。
--   故此前 web_search_method='none'（见 20260618000001_fix_deepseek_config.sql）。
--
-- 现由 worker 适配器自身声明 web_search 函数工具并执行真实搜索（Tavily），
-- 把结果回灌为 tool 消息循环，实现"真联网"。详见 worker/src/adapters/openai-compat.ts agenticCall。
UPDATE public.ai_models
SET adapter_config = jsonb_set(adapter_config, '{web_search_method}', '"agentic"'::jsonb)
WHERE name IN ('DeepSeek', 'MiniMax');
