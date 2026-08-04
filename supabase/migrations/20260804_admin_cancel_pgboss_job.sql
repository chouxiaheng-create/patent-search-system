-- supabase/migrations/20260804_admin_cancel_pgboss_job.sql
-- 管理后台取消：清理 pg-boss 队列中尚未开始执行的 job（state ∈ created/retry）。
-- 与 20260803_cancel_pgboss_job_function.sql 的区别：不做属主校验（管理员可取消任意用户任务）。
-- 安全设计：
-- - 仅两种调用方合法：service-role（auth.uid() 为 NULL，服务端密钥，天然可信）或 role='admin' 的登录用户；
-- - 函数内显式校验，不依赖 RLS 单点防御；
-- - 仅 state ∈ ('created','retry') 的排队中 job 会被清理，执行中的 job 不受影响（由 worker 轮询协作退出）。
-- 幂等：CREATE OR REPLACE，可重复执行。

CREATE OR REPLACE FUNCTION public.admin_cancel_pgboss_job(p_job_name text, p_job_data jsonb)
RETURNS void AS $$
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = auth.uid() AND role = 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  UPDATE pgboss.job
  SET state = 'cancelled'
  WHERE name = p_job_name
    AND state IN ('created', 'retry')
    AND data = p_job_data;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.admin_cancel_pgboss_job(text, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_cancel_pgboss_job(text, jsonb) TO authenticated;
