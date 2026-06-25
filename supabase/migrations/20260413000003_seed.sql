-- supabase/migrations/20260413000003_seed.sql

-- 内置 AI 模型（owner_id = NULL 表示系统内置）
INSERT INTO ai_models (name, api_base_url, model_id, is_builtin, usage_types, capabilities, api_key_encrypted)
VALUES
  (
    '秘塔AI',
    'https://metaso.cn/api',
    'metaso-search',
    true,
    ARRAY['search'],
    '{"deep_reasoning": true, "web_search": true}',
    ''
  ),
  (
    'Kimi K2.6',
    'https://api.moonshot.cn/v1',
    'kimi-k2.6',
    true,
    ARRAY['search', 'parse', 'report'],
    '{"deep_reasoning": true, "web_search": true}',
    ''
  ),
  (
    '智谱GLM-5.1',
    'https://open.bigmodel.cn/api/paas/v4',
    'glm-4',
    true,
    ARRAY['search', 'parse', 'report'],
    '{"deep_reasoning": true, "web_search": true}',
    ''
  );

-- 内置检索策略（幂等：每项检查是否已存在）
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM search_strategies WHERE name = '追踪检索' AND is_builtin = true AND owner_id IS NULL) THEN
    INSERT INTO search_strategies (name, prompt_template, is_builtin)
    VALUES ('追踪检索', '提供由"{{inventor}}"发表的涉及"{{tech_theme}}"的相关文献或网页，注明出处链接和公开时间。', true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM search_strategies WHERE name = '发明构思检索' AND is_builtin = true AND owner_id IS NULL) THEN
    INSERT INTO search_strategies (name, prompt_template, is_builtin)
    VALUES ('发明构思检索', '提供与"{{core_invention}}"技术构思最接近的文献或网页，若存在，按照相关程度从高到低排序，注明出处链接和公开时间，若不存在，则输出无符合要求的相关文献。', true);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM search_strategies WHERE name = '主要技术方案步骤检索' AND is_builtin = true AND owner_id IS NULL) THEN
    INSERT INTO search_strategies (name, prompt_template, is_builtin)
    VALUES ('主要技术方案步骤检索', '提供与"{{main_tech_steps}}"技术构思最接近的文献或网页，若存在，按照相关程度从高到低排序，注明出处链接和公开时间，若不存在，则输出无符合要求的相关文献。', true);
  END IF;
END $$;
