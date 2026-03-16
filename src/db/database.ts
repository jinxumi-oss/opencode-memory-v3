import Database from 'better-sqlite3';
import { expandPath } from '../utils/path.js';
import type { MemoryConfig } from '../types/index.js';

export function createDatabase(config: MemoryConfig): Database.Database {
  const dbPath = expandPath(config.dbPath);
  const db = new Database(dbPath);
  
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');
  
  initializeSchema(db, config.ftsTokenizer);
  
  return db;
}

function initializeSchema(db: Database.Database, tokenizer: string): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      context_summary TEXT,
      memory_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS working_memory (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
      content TEXT NOT NULL,
      tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      importance REAL DEFAULT 0.5 CHECK(importance >= 0 AND importance <= 1),
      is_processed INTEGER DEFAULT 0,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_working_session ON working_memory(session_id);
    CREATE INDEX IF NOT EXISTS idx_working_created ON working_memory(created_at);
    CREATE INDEX IF NOT EXISTS idx_working_importance ON working_memory(importance);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT DEFAULT 'note' CHECK(type IN ('decision', 'pattern', 'preference', 'note', 'context', 'learning')),
      source TEXT DEFAULT 'user' CHECK(source IN ('user', 'promoted', 'system', 'migration')),
      tags TEXT,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT,
      last_accessed TEXT,
      access_count INTEGER DEFAULT 0,
      embedding BLOB,
      embedding_model TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_memories_type ON memories(type);
    CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories(created_at);
    CREATE INDEX IF NOT EXISTS idx_memories_content_hash ON memories(content_hash);
    CREATE INDEX IF NOT EXISTS idx_memories_source ON memories(source);

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      tags,
      content='memories',
      content_rowid='rowid',
      tokenize='${tokenizer}'
    );

    CREATE TABLE IF NOT EXISTS memory_versions (
      id TEXT PRIMARY KEY,
      memory_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      updated_by TEXT CHECK(updated_by IN ('user', 'system', 'auto')),
      change_reason TEXT,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_memory_versions ON memory_versions(memory_id, version);

    CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('concept', 'entity', 'decision', 'pattern')),
      name TEXT NOT NULL,
      description TEXT,
      memory_id TEXT,
      created_at TEXT NOT NULL,
      centrality REAL DEFAULT 0,
      connection_count INTEGER DEFAULT 0,
      FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE SET NULL
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_type ON knowledge_nodes(type);
    CREATE INDEX IF NOT EXISTS idx_knowledge_nodes_name ON knowledge_nodes(name);

    CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL CHECK(relation IN ('relates_to', 'causes', 'enables', 'conflicts', 'depends_on')),
      weight REAL DEFAULT 1.0,
      created_at TEXT NOT NULL,
      FOREIGN KEY (source_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE,
      FOREIGN KEY (target_id) REFERENCES knowledge_nodes(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_knowledge_edges_source ON knowledge_edges(source_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_edges_target ON knowledge_edges(target_id);
    CREATE INDEX IF NOT EXISTS idx_knowledge_edges_relation ON knowledge_edges(relation);

    CREATE TABLE IF NOT EXISTS learning_rules (
      id TEXT PRIMARY KEY,
      rule_type TEXT NOT NULL CHECK(rule_type IN ('pattern', 'preference', 'workflow')),
      pattern TEXT NOT NULL,
      action TEXT NOT NULL,
      confidence REAL DEFAULT 0.5 CHECK(confidence >= 0 AND confidence <= 1),
      occurrence_count INTEGER DEFAULT 1,
      last_triggered TEXT,
      created_at TEXT NOT NULL,
      is_active INTEGER DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_learning_rules_type ON learning_rules(rule_type);

    CREATE TABLE IF NOT EXISTS user_profile (
      key TEXT PRIMARY KEY,
      value TEXT,
      confidence REAL DEFAULT 1.0 CHECK(confidence >= 0 AND confidence <= 1),
      source TEXT CHECK(source IN ('explicit', 'inferred', 'learned')),
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS learning_events (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL CHECK(event_type IN ('pattern_detected', 'preference_updated', 'rule_created', 'memory_promoted')),
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_learning_events_type ON learning_events(event_type);

    CREATE TABLE IF NOT EXISTS recall_history (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      query TEXT,
      recalled_ids TEXT,
      recall_method TEXT CHECK(recall_method IN ('semantic', 'bm25', 'hybrid', 'contextual')),
      score REAL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS deleted_memories (
      id TEXT PRIMARY KEY,
      memory_id TEXT,
      content TEXT,
      deleted_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS heartbeats (
      id TEXT PRIMARY KEY,
      component TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('active', 'idle', 'error')),
      metrics TEXT,
      timestamp TEXT NOT NULL
    );
  `);

  setupFtsTriggers(db);
}

function setupFtsTriggers(db: Database.Database): void {
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS memories_fts_insert AFTER INSERT ON memories BEGIN
      INSERT INTO memories_fts(rowid, content, tags) 
      VALUES (NEW.rowid, NEW.content, COALESCE(NEW.tags, ''));
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_update AFTER UPDATE ON memories BEGIN
      UPDATE memories_fts SET content = NEW.content, tags = COALESCE(NEW.tags, '') 
      WHERE rowid = NEW.rowid;
    END;

    CREATE TRIGGER IF NOT EXISTS memories_fts_delete AFTER DELETE ON memories BEGIN
      INSERT INTO memories_fts(memories_fts, rowid, content, tags) 
      VALUES('delete', OLD.rowid, OLD.content, COALESCE(OLD.tags, ''));
    END;
  `);
}

export function rebuildFtsIndex(db: Database.Database): void {
  db.exec(`
    INSERT INTO memories_fts(memories_fts) VALUES('rebuild');
  `);
}

export { Database };