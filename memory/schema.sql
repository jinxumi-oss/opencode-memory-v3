-- Timeline Memory System Schema
-- L0: 线性存储用 Markdown 文件
-- L1-L4: 元数据用 SQLite

-- blocks 表：记忆块
CREATE TABLE IF NOT EXISTS blocks (
  id TEXT PRIMARY KEY,
  hash TEXT NOT NULL UNIQUE,
  summary TEXT,
  content TEXT NOT NULL,
  tier TEXT DEFAULT 'active',
  weight REAL DEFAULT 0.5,
  access_count INTEGER DEFAULT 0,
  created_at TEXT NOT NULL,
  last_accessed TEXT,
  metadata TEXT
);

-- anchors 表：分块锚点
CREATE TABLE IF NOT EXISTS anchors (
  id TEXT PRIMARY KEY,
  block_id TEXT NOT NULL,
  chunk_index INTEGER,
  start_offset INTEGER,
  end_offset INTEGER,
  created_at TEXT NOT NULL,
  FOREIGN KEY (block_id) REFERENCES blocks(id) ON DELETE CASCADE
);

-- dedup 表：去重映射
CREATE TABLE IF NOT EXISTS dedup (
  hash TEXT PRIMARY KEY,
  primary_block_id TEXT NOT NULL,
  duplicate_block_ids TEXT,
  dedup_type TEXT CHECK(dedup_type IN ('exact', 'semantic')),
  similarity REAL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (primary_block_id) REFERENCES blocks(id) ON DELETE CASCADE
);

-- metadata 表：系统元数据
CREATE TABLE IF NOT EXISTS metadata (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT NOT NULL
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_blocks_hash ON blocks(hash);
CREATE INDEX IF NOT EXISTS idx_blocks_tier ON blocks(tier);
CREATE INDEX IF NOT EXISTS idx_blocks_created_at ON blocks(created_at);
CREATE INDEX IF NOT EXISTS idx_anchors_block_id ON anchors(block_id);

-- 初始元数据
INSERT OR IGNORE INTO metadata (key, value, updated_at) VALUES
  ('schema_version', '2.0.0', datetime('now')),
  ('created_at', datetime('now'), datetime('now'));