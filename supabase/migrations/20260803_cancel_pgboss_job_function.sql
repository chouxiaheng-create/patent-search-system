-- supabase/migrations/20260803_cancel_pgboss_job_function.sql
-- L7 修复：取消 pg-boss 队列中尚未开始执行的 job（state ∈ created/retry）。
-- 前端 API（app/api/jobs/route.ts PATCH 取消）在把 search_jobs 置为 cancelled 后调用此 RPC，
-- 清理队列中残留的排队任务，避免 worker 白白消费一次。
--
-- 安全设计：
-- - SECURITY DEFINER 需要访问 pgboss schema（普通用户无权限），但函数内通过
--   auth.uid() + search_jobs.user_id/status 双重校验，确保只能取消属于自己的、
--   且已在 DB 层标记为 cancelled 的任务——恶意调用者无法取消他人任务。
-- - 显式 REVOKE PUBLIC，仅授予 authenticated。

CREATE OR REPLACE FUNCTION public.cancel_pgboss_job(p_job_name text, p_job_data jsonb)
RETURNS void AS $$
BEGIN
  UPDATE pgboss.job
  SET state = 'cancelled'
  WHERE name = p_job_name
    AND state IN ('created', 'retry')
    AND data = p_job_data
    AND data->>'jobId' IN (
      SELECT sj.id::text
      FROM public.search_jobs sj
      WHERE sj.id::text = data->>'jobId'
        AND sj.user_id = auth.uid()
        AND sj.status = 'cancelled'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.cancel_pgboss_job(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_pgboss_job(text, jsonb) TO authenticated;
