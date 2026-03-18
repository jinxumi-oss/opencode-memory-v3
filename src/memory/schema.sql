-- Unified Memory System Schema
-- 统一记忆系统数据库架构

-- L0: 时序底座
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  context_summary TEXT,
  memory_count INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS timeline_entries (
  id TEXT PRIMARY KEY,
  timestamp TEXT NOT NULL,
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  entry_type TEXT NOT NULL DEFAULT 'note',
  source TEXT NOT NULL DEFAULT 'user',
  session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  importance REAL DEFAULT 0.5 CHECK(importance >= 0 AND importance <= 1),
  raw_metadata TEXT,
  is_immutable INTEGER DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_timeline_timestamp ON timeline_entries(timestamp);
CREATE INDEX IF NOT EXISTS idx_timeline_session ON timeline_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_timeline_type ON timeline_entries(entry_type);
CREATE INDEX IF NOT EXISTS idx_timeline_hash ON timeline_entries(content_hash);

-- L1: 记忆块
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY,
  content_hash TEXT NOT NULL UNIQUE,
  summary TEXT,
  content TEXT NOT NULL,
  memory_type TEXT DEFAULT 'note',
  source TEXT DEFAULT 'user',
  tier TEXT DEFAULT 'warm' CHECK(tier IN ('hot', 'warm', 'cold', 'isolated')),
  weight REAL DEFAULT 0.5 CHECK(weight >= 0 AND weight <= 1),
  access_count INTEGER DEFAULT 0,
  timeline_entry_ids TEXT,
  tags TEXT,
  custom_metadata TEXT,
  created_at TEXT NOT NULL,
  last_accessed TEXT
);

CREATE INDEX IF NOT EXISTS idx_memories_hash ON memories(content_hash);
CREATE INDEX IF NOT EXISTS idx_memories_tier ON memories(tier);
CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at);
CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(memory_type);
CREATE INDEX IF NOT EXISTS idx_memories_weight ON memories(weight);

-- L2: 向量索引
CREATE TABLE IF NOT EXISTS block_embeddings (
  block_id TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
  embedding BLOB NOT NULL,
  embedding_model TEXT NOT NULL DEFAULT 'nomic-embed-text',
  embedding_dim INTEGER NOT NULL DEFAULT 768,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- L2: FTS5 全文索引
CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
  content,
  tags,
  summary,
  content='memories',
  content_rowid='rowid',
  tokenize='unicode61'
);

-- FTS5 自动同步触发器
CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
  INSERT INTO memories_fts(rowid, content, tags, summary) 
  VALUES (NEW.rowid, NEW.content, COALESCE(NEW.tags, ''), COALESCE(NEW.summary, ''));
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
  UPDATE memories_fts SET 
    content = NEW.content, 
    tags = COALESCE(NEW.tags, ''),
    summary = COALESCE(NEW.summary, '')
  WHERE rowid = NEW.rowid;
END;

CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
  INSERT INTO memories_fts(memories_fts, rowid, content, tags, summary) 
  VALUES('delete', OLD.rowid, OLD.content, COALESCE(OLD.tags, ''), COALESCE(OLD.summary, ''));
END;

-- L3: 去重表
CREATE TABLE IF NOT EXISTS dedup_entries (
  hash TEXT PRIMARY KEY,
  primary_block_id TEXT NOT NULL REFERENCES memories(id) ON DELETE CASCADE,
  duplicate_ids TEXT,
  dedup_type TEXT NOT NULL CHECK(dedup_type IN ('exact', 'semantic')),
  similarity REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_dedup_primary ON dedup_entries(primary_block_id);
CREATE INDEX IF NOT EXISTS idx_dedup_type ON dedup_entries(dedup_type);

-- L3: 知识图谱
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK(entity_type IN ('concept', 'entity', 'decision', 'pattern')),
  description TEXT,
  memory_id TEXT REFERENCES memories(id) ON DELETE SET NULL,
  centrality REAL DEFAULT 0,
  connection_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS relations (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  target_id TEXT NOT NULL REFERENCES entities(id) ON DELETE CASCADE,
  relation_type TEXT NOT NULL CHECK(relation_type IN ('relates_to', 'causes', 'enables', 'conflicts', 'depends_on')),
  weight REAL DEFAULT 1.0,
  created_at TEXT NOT NULL,
  UNIQUE(source_id, target_id, relation_type)
);

CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_relations_source ON relations(source_id);
CREATE INDEX IF NOT EXISTS idx_relations_target ON relations(target_id);

-- 辅助表
CREATE TABLE IF NOT EXISTS deleted_memories (
  id TEXT PRIMARY KEY,
  memory_id TEXT,
  content TEXT,
  deleted_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS recall_history (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  query TEXT,
  recalled_ids TEXT,
  bm25_scores TEXT,
  vector_scores TEXT,
  final_scores TEXT,
  recall_method TEXT CHECK(recall_method IN ('semantic', 'bm25', 'hybrid', 'contextual')),
  created_at TEXT NOT NULL
);