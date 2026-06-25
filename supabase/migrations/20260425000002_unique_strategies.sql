-- 防止内置检索策略重复：添加唯一部分索引
-- 每个内置策略名称（owner_id IS NULL）只能存在一条记录

CREATE UNIQUE INDEX IF NOT EXISTS idx_strategies_builtin_name
  ON search_strategies (name)
  WHERE is_builtin = true AND owner_id IS NULL;
