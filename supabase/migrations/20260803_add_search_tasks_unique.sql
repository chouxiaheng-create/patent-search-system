-- supabase/migrations/20260803_add_search_tasks_unique.sql
-- M12 修复：search_tasks 增加 (job_id, model_id, strategy_id) 唯一索引，
-- 配合 worker 侧 createSearchTasks 的 upsert(ignoreDuplicates=true) 幂等插入，
-- 从根上消除"先查后插"竞态窗口下的重复子任务。
-- 幂等：可重复执行。

-- 1. 先清理历史重复数据（保留每个 job+model+strategy 组合中 id 最小的行）
--    这些重复行是旧版竞态窗口产生的 bug 数据，删除安全。
DELETE FROM public.search_tasks a
USING public.search_tasks b
WHERE a.id > b.id
  AND a.job_id = b.job_id
  AND a.model_id = b.model_id
  AND a.strategy_id = b.strategy_id;

-- 2. 创建唯一索引（若已存在则跳过）
CREATE UNIQUE INDEX IF NOT EXISTS uq_search_tasks_job_model_strategy
  ON public.search_tasks (job_id, model_id, strategy_id);
