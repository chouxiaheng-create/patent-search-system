-- 幂等：创建 send_pgboss_job 函数，供前端 API 通过 RPC 向 pg-boss 队列发送作业
CREATE OR REPLACE FUNCTION public.send_pgboss_job(
  job_name text,
  job_data jsonb,
  start_after timestamptz DEFAULT now()
) RETURNS void AS $$
BEGIN
  INSERT INTO pgboss.job (name, data, state, priority, retrylimit, retrydelay, retrybackoff, startafter, expirein, keepuntil, on_complete)
  VALUES (job_name, job_data, 'created', 0, 2, 0, false, start_after, '15 minutes', '7 days', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;