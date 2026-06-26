-- supabase/migrations/20260626_stuck_job_recovery.sql
-- 卡住任务自动恢复 + 失败任务重试：数据模型与入队参数调整
-- 幂等：所有变更可重复执行。

-- 1. search_jobs 新增列：JOB 级自动重排计数、手动全量重试关联
ALTER TABLE public.search_jobs
  ADD COLUMN IF NOT EXISTS retry_count integer NOT NULL DEFAULT 0;
ALTER TABLE public.search_jobs
  ADD COLUMN IF NOT EXISTS retried_from_job_id uuid REFERENCES public.search_jobs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_search_jobs_status_started_at
  ON public.search_jobs (status, started_at);

-- 2. 调整 send_pgboss_job 入队参数（对齐 pg-boss v12 schema）：
--    v12 的 pgboss.job 列名为 retry_limit / retry_delay / retry_backoff / expire_seconds / deletion_seconds / keep_until
--    （旧版 retrylimit / expirein / keepuntil / on_complete 已不存在，旧函数因此一直报 42703）。
--    - expire_seconds 900(15min) -> 1800(30min)：>= handler 25min 硬超时，消除过早 expire/重复执行
--    - retry_limit 2 -> 0：关闭 pg-boss 自带重排，改由应用层 handleJobFailure 控制，语义可控
--    - deletion_seconds / keep_until：保留 7 天（与 v12 默认一致）
CREATE OR REPLACE FUNCTION public.send_pgboss_job(
  job_name text,
  job_data jsonb,
  start_after timestamptz DEFAULT now()
) RETURNS void AS $$
BEGIN
  INSERT INTO pgboss.job (
    name, data, state, priority,
    retry_limit, retry_delay, retry_backoff,
    start_after, expire_seconds, deletion_seconds, keep_until
  )
  VALUES (
    job_name, job_data, 'created', 0,
    0, 0, false,
    start_after, 1800, 604800, start_after + interval '7 days'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
