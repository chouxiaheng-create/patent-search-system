-- supabase/migrations/20260714000002_add_profiles_fk.sql
-- 给 3 张 user-scoped 表补 FK 到 profiles.id，让 admin 列表能用 PostgREST 嵌套 count。
-- profiles.id = auth.users.id（profiles.id 本身 FK 到 auth.users.id），
-- 所以 user_id 同时指向两边是合法的，且 ON DELETE CASCADE 链不会破。

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'patent_documents_user_id_profiles_fkey'
  ) THEN
    ALTER TABLE patent_documents
      ADD CONSTRAINT patent_documents_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'search_jobs_user_id_profiles_fkey'
  ) THEN
    ALTER TABLE search_jobs
      ADD CONSTRAINT search_jobs_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'reports_user_id_profiles_fkey'
  ) THEN
    ALTER TABLE reports
      ADD CONSTRAINT reports_user_id_profiles_fkey
      FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
  END IF;
END $$;

-- 嵌套 count 的 join 靠这些索引加速
CREATE INDEX IF NOT EXISTS patent_documents_user_id_idx ON patent_documents(user_id);
CREATE INDEX IF NOT EXISTS search_jobs_user_id_idx ON search_jobs(user_id);
CREATE INDEX IF NOT EXISTS reports_user_id_idx ON reports(user_id);
