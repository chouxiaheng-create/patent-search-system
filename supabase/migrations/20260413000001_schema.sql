-- supabase/migrations/20260413000001_schema.sql

-- 1. profiles（用户档案）
CREATE TABLE profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 注册时自动创建 profile 记录
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO profiles (id, display_name)
  VALUES (
    new.id,
    new.raw_user_meta_data->>'display_name'
  );
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- 2. ai_models（AI 模型库）
CREATE TABLE ai_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  api_base_url text NOT NULL,
  api_key_encrypted text NOT NULL DEFAULT '',
  model_id text NOT NULL,
  is_builtin boolean NOT NULL DEFAULT false,
  usage_types text[] NOT NULL DEFAULT '{}',
  capabilities jsonb NOT NULL DEFAULT '{"deep_reasoning": false, "web_search": false}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. search_strategies（检索策略）
CREATE TABLE search_strategies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL,
  prompt_template text NOT NULL,
  is_builtin boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 4. patent_documents（专利文献）
CREATE TABLE patent_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  file_url text NOT NULL,
  file_type text NOT NULL CHECK (file_type IN ('pdf', 'docx', 'xlsx', 'txt')),
  parse_status text NOT NULL DEFAULT 'pending'
    CHECK (parse_status IN ('pending', 'parsing', 'done', 'needs_review', 'failed')),
  parsed_data jsonb,
  quality_warning boolean NOT NULL DEFAULT false,
  user_notes text,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 5. search_jobs（检索任务主表）
CREATE TABLE search_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  document_id uuid NOT NULL REFERENCES patent_documents(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled')),
  scheduled_at timestamptz,
  config jsonb NOT NULL DEFAULT '{}',
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 6. search_tasks（子任务明细）
CREATE TABLE search_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES search_jobs(id) ON DELETE CASCADE,
  model_id uuid NOT NULL REFERENCES ai_models(id),
  strategy_id uuid NOT NULL REFERENCES search_strategies(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'retrying', 'done', 'abandoned')),
  retry_count integer NOT NULL DEFAULT 0,
  results jsonb,
  error_msg text,
  started_at timestamptz,
  completed_at timestamptz
);

-- 7. reports（检索报告）
CREATE TABLE reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES search_jobs(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  html_content text NOT NULL DEFAULT '',
  selected_docs jsonb NOT NULL DEFAULT '[]',
  doc_count integer NOT NULL DEFAULT 0,
  path_summary jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 8. notifications（站内通知）
CREATE TABLE notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  job_id uuid REFERENCES search_jobs(id) ON DELETE SET NULL,
  type text NOT NULL
    CHECK (type IN ('job_completed', 'job_failed', 'job_cancelled', 'parse_done', 'parse_failed')),
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 开启所有表的 Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE search_jobs;
ALTER PUBLICATION supabase_realtime ADD TABLE search_tasks;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE patent_documents;
