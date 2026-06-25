-- 修复 send_pgboss_job 函数：列名适配 pg-boss v12 schema
-- 旧版列名 retrylimit/retrydelay/retrybackoff/startafter/expirein/keepuntil/on_complete
-- v12 正确列名 retry_limit/retry_delay/retry_backoff/start_after/expire_seconds/deletion_seconds
-- expire_seconds 和 deletion_seconds 为整数（秒），不是字符串
CREATE OR REPLACE FUNCTION public.send_pgboss_job(
  job_name text,
  job_data jsonb,
  start_after timestamptz DEFAULT now()
) RETURNS void AS $$
BEGIN
  INSERT INTO pgboss.job (
    name, data, state, priority,
    retry_limit, retry_delay, retry_backoff,
    start_after, expire_seconds, deletion_seconds
  )
  VALUES (
    job_name, job_data, 'created', 0,
    2, 0, false,
    start_after, 900, 604800
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
