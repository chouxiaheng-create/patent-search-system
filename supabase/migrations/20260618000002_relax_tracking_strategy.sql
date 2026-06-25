-- 放宽"追踪检索"策略的 prompt
-- 原 prompt: "提供由"{{inventor}}"发表的涉及"{{tech_theme}}"的相关文献或网页"
--   问题：要求严格匹配发明人，如果 Kimi 搜索找不到这些作者则返回 []
--
-- 改为：优先匹配发明人；找不到时返回主题相关文献
UPDATE public.search_strategies
SET prompt_template = '提供与"{{tech_theme}}"相关的文献或网页。优先返回作者包含"{{inventor}}"的文献；如果搜索结果中没有这些作者的相关文献，则返回与该技术主题相关的所有其他文献。注明出处链接和公开时间。'
WHERE name = '追踪检索';
