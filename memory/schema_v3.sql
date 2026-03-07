-- OpenCode 记忆系统 v3.0 - 三层架构
-- L0: 状态层 (Working Memory)
-- L1: 知识层 (Long-term Memory)
-- L2: 学习层 (Learning Memory)

-- ============================================
-- L0: 状态层 - 工作记忆
-- ============================================

-- 会话表
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  context_summary TEXT,
  memory_count INTEGER DEFAULT 0
);

-- 工作记忆表（当前会话）
CREATE TABLE IF NOT EXISTS working_memory (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,              -- user/assistant/system
  content TEXT NOT NULL,
  tokens INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  importance REAL DEFAULT 0.5,     -- 重要性评分 0-1
  is_processed INTEGER DEFAULT 0,  -- 是否已处理到L1
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

-- 上下文索引
CREATE INDEX IF NOT EXISTS idx_working_session ON working_memory(session_id);
CREATE INDEX IF NOT EXISTS idx_working_created ON working_memory(created_at);

-- ============================================
-- L1: 知识层 - 长期记忆（已有memories表增强）
-- ============================================

-- 记忆版本表
CREATE TABLE IF NOT EXISTS memory_versions (
  id TEXT PRIMARY KEY,
  memory_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  content TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  updated_by TEXT,                 -- user/system/auto
  change_reason TEXT,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- 知识图谱节点
CREATE TABLE IF NOT EXISTS knowledge_nodes (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,              -- concept/entity/decision/pattern
  name TEXT NOT NULL,
  description TEXT,
  memory_id TEXT,                  -- 关联的记忆
  created_at TEXT NOT NULL,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE SET NULL
);

-- 知识图谱边
CREATE TABLE IF NOT EXISTS knowledge_edges (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL,
  target_id TEXT NOT NULL,
  relation TEXT NOT NULL,          -- relates_to/causes/enables/conflicts
  weight REAL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
  FOREIGN KEY (target_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_memory_versions ON memory_versions(memory_id, version);
CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_type ON knowledge_nodes(type);
CREATE INDEX IF NOT EXISTS idx_knowledge_edges_source ON knowledge_edges(source_id);

-- ============================================
-- L2: 学习层 - 自动学习
-- ============================================

-- 学习规则表
CREATE TABLE IF NOT EXISTS learning_rules (
  id TEXT PRIMARY KEY,
  rule_type TEXT NOT NULL,         -- pattern/preference/workflow
  pattern TEXT NOT NULL,           -- 识别的模式
  action TEXT NOT NULL,            -- 触发的动作
  confidence REAL DEFAULT 0.5,     -- 置信度
  occurrence_count INTEGER DEFAULT 1,
  last_triggered TEXT,
  created_at TEXT NOT NULL,
  is_active INTEGER DEFAULT 1
);

-- 用户画像表（增强版）
CREATE TABLE IF NOT EXISTS user_profile (
  key TEXT PRIMARY KEY,
  value TEXT,
  confidence REAL DEFAULT 1.0,
  source TEXT,                     -- explicit/inferred/learned
  updated_at TEXT NOT NULL
);

-- 学习事件表
CREATE TABLE IF NOT EXISTS learning_events (
  id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,        -- pattern_detected/preference_updated/rule_created
  details TEXT,                    -- JSON格式
  created_at TEXT NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_learning_rules_type ON learning_rules(rule_type);
CREATE INDEX IF NOT EXISTS idx_learning_events_type ON learning_events(event_type);

-- ============================================
-- 主动召回机制
-- ============================================

-- 召回队列
CREATE TABLE IF NOT EXISTS recall_queue (
  id TEXT PRIMARY KEY,
  trigger_type TEXT NOT NULL,      -- keyword/context/time/user_action
  trigger_data TEXT,               -- JSON格式触发条件
  target_memories TEXT,            -- JSON数组，应该召回的记忆ID列表
  priority INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  executed_at TEXT,
  is_executed INTEGER DEFAULT 0
);

-- 召回历史
CREATE TABLE IF NOT EXISTS recall_history (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  query TEXT,
  recalled_ids TEXT,               -- JSON数组
  recall_method TEXT,              -- semantic/bm25/hybrid/contextual
  score REAL,
  created_at TEXT NOT NULL
);

-- ============================================
-- 混合搜索支持
-- ============================================

-- 搜索索引（BM25模拟）
CREATE TABLE IF NOT EXISTS search_index (
  memory_id TEXT PRIMARY KEY,
  content_text TEXT,               -- 用于全文搜索
  keywords TEXT,                   -- 提取的关键词
  bm25_score REAL DEFAULT 0,
  last_indexed TEXT,
  FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);

-- 向量嵌入（已有，重命名）
-- CREATE TABLE IF NOT EXISTS embeddings (...)

-- ============================================
-- 心跳机制
-- ============================================

-- 心跳记录
CREATE TABLE IF NOT EXISTS heartbeats (
  id TEXT PRIMARY KEY,
  component TEXT NOT NULL,         -- L0/L1/L2
  status TEXT NOT NULL,            -- active/idle/error
  metrics TEXT,                    -- JSON格式的性能指标
  timestamp TEXT NOT NULL
);

-- ============================================
-- 元数据
-- ============================================

INSERT OR IGNORE INTO metadata (key, value, updated_at) VALUES
  ('schema_version', '3.0.0', datetime('now')),
  ('architecture', 'three_layer', datetime('now')),
  ('last_heartbeat', datetime('now'));