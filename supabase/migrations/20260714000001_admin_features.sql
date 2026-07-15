-- supabase/migrations/20260714000001_admin_features.sql
-- 管理员审计日志表（设计文档 §3）

-- 说明：审计日志是 append-only 的，使用 bigserial 单调递增主键即可（不必引入 uuid）。
--       顺序性有助于按写入顺序检索，比 uuid 更直观。外部业务表保持 uuid 主键不变。

-- 为 profiles 补 email 列（原 schema 未含，本迁移自包含保证 email 模糊搜索可用）
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS email text;

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id           bigserial PRIMARY KEY,
  admin_id     uuid REFERENCES profiles(id) ON DELETE SET NULL,
  action       text NOT NULL CHECK (action IN ('promote', 'demote', 'view_user')),
  target_user  uuid REFERENCES profiles(id) ON DELETE SET NULL,
  detail       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE admin_audit_log IS '管理员操作审计日志：敏感表，仅 admin 角色可读可写；service_role 客户端凭 BYPASSRLS 直写。';
COMMENT ON COLUMN admin_audit_log.action IS '操作类型枚举：promote（提升为管理员）/ demote（降级为普通用户）/ view_user（查看用户敏感信息）。';

CREATE INDEX IF NOT EXISTS admin_audit_log_admin_id_idx ON admin_audit_log(admin_id);
CREATE INDEX IF NOT EXISTS admin_audit_log_target_user_idx ON admin_audit_log(target_user);
CREATE INDEX IF NOT EXISTS admin_audit_log_created_at_idx ON admin_audit_log(created_at DESC);

-- RLS：仅 admin 能看（service_role 始终可以）
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_audit_log" ON admin_audit_log;
CREATE POLICY "admin_read_audit_log" ON admin_audit_log
  FOR SELECT USING (is_admin());

-- 关键修复：写入也必须限定为 admin（service_role 客户端走 BYPASSRLS，策略不阻断后端直写）
DROP POLICY IF EXISTS "admin_write_audit_log" ON admin_audit_log;
CREATE POLICY "admin_write_audit_log" ON admin_audit_log
  FOR INSERT WITH CHECK (is_admin());

-- 邮箱模糊搜索加速（pg_trgm 扩展；Supabase 默认已启用，扩展位于 extensions schema）
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
CREATE INDEX IF NOT EXISTS profiles_email_trgm_idx ON profiles USING gin (email extensions.gin_trgm_ops);
CREATE INDEX IF NOT EXISTS profiles_created_at_idx ON profiles(created_at DESC);