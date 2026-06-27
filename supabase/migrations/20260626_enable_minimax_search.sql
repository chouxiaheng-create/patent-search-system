-- supabase/migrations/20260626_enable_minimax_search.sql
-- 让 MiniMax 可用于检索（usage_types 加 'search'）。
-- 说明：MiniMax 与 DeepSeek 的官方 API 均不支持"服务端一次调用即联网返回结果"
--   - DeepSeek：chat/completions 无联网参数（文档仅 model/messages/thinking/reasoning_effort/stream）。
--   - MiniMax：tools:[{type:'web_search'}] 返回 tool_calls（plugin_web_search），需客户端执行搜索后回传，
--     适配器无搜索后端，无法走该 agentic 循环。
-- 故两者 web_search_method 保持 'none'（知识检索），缺失的作者/公开时间由 enrichment 管线
-- 按 URL/title 从 arXiv/Crossref/Semantic Scholar/页面meta 回填。capabilities.web_search 已为 true。
UPDATE public.ai_models
SET usage_types = '{search,parse,report}'
WHERE name = 'MiniMax';
