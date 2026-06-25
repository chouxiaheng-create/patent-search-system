-- 修正 MiniMax API base URL → api.minimaxi.com
-- MiniMax 有两套域名：
--   LLM/Chat Completions: api.minimaxi.com (国内) / api.minimax.io (国际)
--   MCP/TTS: api.minimax.chat (国内) / api.minimaxi.chat (国际)
-- 我们用的是 Chat Completions 国内版，必须使用 api.minimaxi.com
-- api.minimax.io 和 api.minimax.chat 都会导致 2049 (invalid api key / invalid URL)

UPDATE ai_models SET
  api_base_url = 'https://api.minimaxi.com/v1',
  model_id = 'MiniMax-M2.7'
WHERE name = 'MiniMax' AND is_builtin = true
  AND api_base_url != 'https://api.minimaxi.com/v1';
