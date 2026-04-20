-- supabase/migrations/20260413000002_rls.sql

-- 开启 RLS（幂等）
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

-- Helper: 判断当前用户是否为 Admin
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin'
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- profiles
DROP POLICY IF EXISTS "users_read_own_profile" ON profiles;
DROP POLICY IF EXISTS "users_update_own_profile" ON profiles;
CREATE POLICY "users_read_own_profile" ON profiles FOR SELECT USING (id = auth.uid() OR is_admin());
CREATE POLICY "users_update_own_profile" ON profiles FOR UPDATE USING (id = auth.uid());

-- ai_models（内置模型所有人可读，私有模型仅自己可读写）
DROP POLICY IF EXISTS "read_ai_models" ON ai_models;
DROP POLICY IF EXISTS "insert_own_ai_models" ON ai_models;
DROP POLICY IF EXISTS "update_own_ai_models" ON ai_models;
DROP POLICY IF EXISTS "delete_own_ai_models" ON ai_models;
CREATE POLICY "read_ai_models" ON ai_models FOR SELECT
  USING (owner_id IS NULL OR owner_id = auth.uid() OR is_admin());
CREATE POLICY "insert_own_ai_models" ON ai_models FOR INSERT
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "update_own_ai_models" ON ai_models FOR UPDATE
  USING (owner_id = auth.uid() OR is_admin());
CREATE POLICY "delete_own_ai_models" ON ai_models FOR DELETE
  USING (owner_id = auth.uid() OR is_admin());

-- search_strategies（同 ai_models 逻辑）
DROP POLICY IF EXISTS "read_strategies" ON search_strategies;
DROP POLICY IF EXISTS "insert_own_strategies" ON search_strategies;
DROP POLICY IF EXISTS "update_own_strategies" ON search_strategies;
DROP POLICY IF EXISTS "delete_own_strategies" ON search_strategies;
CREATE POLICY "read_strategies" ON search_strategies FOR SELECT
  USING (owner_id IS NULL OR owner_id = auth.uid() OR is_admin());
CREATE POLICY "insert_own_strategies" ON search_strategies FOR INSERT
  WITH CHECK (owner_id = auth.uid());
CREATE POLICY "update_own_strategies" ON search_strategies FOR UPDATE
  USING (owner_id = auth.uid() OR is_admin());
CREATE POLICY "delete_own_strategies" ON search_strategies FOR DELETE
  USING (owner_id = auth.uid() OR is_admin());

-- patent_documents
DROP POLICY IF EXISTS "read_own_documents" ON patent_documents;
DROP POLICY IF EXISTS "insert_own_documents" ON patent_documents;
DROP POLICY IF EXISTS "update_own_documents" ON patent_documents;
DROP POLICY IF EXISTS "delete_own_documents" ON patent_documents;
CREATE POLICY "read_own_documents" ON patent_documents FOR SELECT
  USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "insert_own_documents" ON patent_documents FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "update_own_documents" ON patent_documents FOR UPDATE
  USING (user_id = auth.uid());
CREATE POLICY "delete_own_documents" ON patent_documents FOR DELETE
  USING (user_id = auth.uid());

-- search_jobs
DROP POLICY IF EXISTS "read_own_jobs" ON search_jobs;
DROP POLICY IF EXISTS "insert_own_jobs" ON search_jobs;
DROP POLICY IF EXISTS "update_own_jobs" ON search_jobs;
DROP POLICY IF EXISTS "delete_own_jobs" ON search_jobs;
CREATE POLICY "read_own_jobs" ON search_jobs FOR SELECT
  USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "insert_own_jobs" ON search_jobs FOR INSERT
  WITH CHECK (user_id = auth.uid());
CREATE POLICY "update_own_jobs" ON search_jobs FOR UPDATE
  USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "delete_own_jobs" ON search_jobs FOR DELETE
  USING (user_id = auth.uid());

-- search_tasks（通过 job 关联用户）
DROP POLICY IF EXISTS "read_own_tasks" ON search_tasks;
CREATE POLICY "read_own_tasks" ON search_tasks FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM search_jobs WHERE id = job_id AND (user_id = auth.uid() OR is_admin()))
  );

-- reports
DROP POLICY IF EXISTS "read_own_reports" ON reports;
DROP POLICY IF EXISTS "delete_own_reports" ON reports;
CREATE POLICY "read_own_reports" ON reports FOR SELECT
  USING (user_id = auth.uid() OR is_admin());
CREATE POLICY "delete_own_reports" ON reports FOR DELETE
  USING (user_id = auth.uid());

-- notifications
DROP POLICY IF EXISTS "read_own_notifications" ON notifications;
DROP POLICY IF EXISTS "update_own_notifications" ON notifications;
CREATE POLICY "read_own_notifications" ON notifications FOR SELECT
  USING (user_id = auth.uid());
CREATE POLICY "update_own_notifications" ON notifications FOR UPDATE
  USING (user_id = auth.uid());
