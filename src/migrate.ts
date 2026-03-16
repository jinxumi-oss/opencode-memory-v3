import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { readFileSync, readdirSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const MEMORY_DIR = join(homedir(), '.opencode/memory');
const OLD_DB = join(MEMORY_DIR, 'memory.db');
const NEW_DB = join(MEMORY_DIR, 'memory_v4.db');
const TIMELINE_DIR = join(MEMORY_DIR, 'timeline');

interface OldMemory {
  id: string;
  type: string;
  source: string;
  tags: string | null;
  content: string;
  content_hash: string | null;
  created_at: string;
}

interface TimelineEntry {
  id: string;
  timestamp: string;
  type: string;
  source: string;
  tags: string[];
  importance: number;
  content: string;
}

function hashContent(content: string): string {
  return createHash('sha256').update(content.trim()).digest('hex').slice(0, 16);
}

function parseTimelineEntry(block: string): TimelineEntry | null {
  const lines = block.trim().split('\n');
  if (lines.length < 2) return null;

  const frontMatterMatch = block.match(/^---\n([\s\S]*?)\n---/);
  if (!frontMatterMatch) return null;

  const frontMatter = frontMatterMatch[1];
  if (!frontMatter) return null;
  const contentStart = block.indexOf('---', frontMatterMatch[0].length) + 3;
  const content = block.slice(contentStart).trim();

  if (!content) return null;

  const idMatch = frontMatter.match(/^id:\s*(.+)$/m);
  const timestampMatch = frontMatter.match(/^timestamp:\s*(.+)$/m);
  const typeMatch = frontMatter.match(/^type:\s*(.+)$/m);
  const sourceMatch = frontMatter.match(/^source:\s*(.+)$/m);
  const tagsMatch = frontMatter.match(/^tags:\s*\[(.+)\]$/m);
  const importanceMatch = frontMatter.match(/^importance:\s*(\d+)/m);

  return {
    id: idMatch?.[1]?.trim() || `tl_${Date.now()}`,
    timestamp: timestampMatch?.[1]?.trim() || new Date().toISOString(),
    type: typeMatch?.[1]?.trim() || 'note',
    source: sourceMatch?.[1]?.trim() || 'migration',
    tags: tagsMatch?.[1]?.split(',').map(t => t.trim().replace(/"/g, '')).filter(Boolean) || [],
    importance: parseInt(importanceMatch?.[1] || '5', 10),
    content,
  };
}

function parseTimelineFile(filePath: string): TimelineEntry[] {
  const content = readFileSync(filePath, 'utf-8');
  const blocks = content.split(/^---\n(?=id:)/gm).filter(b => b.trim());
  
  const entries: TimelineEntry[] = [];
  for (const block of blocks) {
    const entry = parseTimelineEntry('---\n' + block);
    if (entry) {
      entries.push(entry);
    }
  }
  
  return entries;
}

function migrateTimeline(db: Database.Database): { total: number; duplicates: number; migrated: number } {
  if (!existsSync(TIMELINE_DIR)) {
    console.log('No timeline directory found');
    return { total: 0, duplicates: 0, migrated: 0 };
  }

  const files = readdirSync(TIMELINE_DIR).filter(f => f.endsWith('.md'));
  console.log(`Found ${files.length} timeline files`);

  const allEntries: TimelineEntry[] = [];
  
  for (const file of files) {
    const filePath = join(TIMELINE_DIR, file);
    const entries = parseTimelineFile(filePath);
    allEntries.push(...entries);
    console.log(`  ${file}: ${entries.length} entries`);
  }

  console.log(`\nTotal timeline entries: ${allEntries.length}`);

  const seen = new Map<string, string>();
  let duplicates = 0;
  let migrated = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO memories (id, type, source, tags, content, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const entry of allEntries) {
    const contentHash = hashContent(entry.content);
    
    if (seen.has(contentHash)) {
      duplicates++;
      continue;
    }

    seen.set(contentHash, entry.id);

    try {
      insertStmt.run(
        entry.id,
        entry.type,
        entry.source,
        entry.tags.join(','),
        entry.content,
        contentHash,
        entry.timestamp
      );
      migrated++;
    } catch (err) {
      console.log(`  Skipped duplicate: ${entry.id}`);
      duplicates++;
    }
  }

  return { total: allEntries.length, duplicates, migrated };
}

function migrateOldDatabase(newDb: Database.Database): { total: number; migrated: number } {
  if (!existsSync(OLD_DB)) {
    console.log('No old database found');
    return { total: 0, migrated: 0 };
  }

  console.log('\nMigrating old database...');
  
  const oldDb = new Database(OLD_DB, { readonly: true });
  
  let oldMemories: OldMemory[] = [];
  try {
    oldMemories = oldDb.prepare(`SELECT * FROM memories`).all() as OldMemory[];
  } catch {
    console.log('  No memories table in old database');
  }

  console.log(`  Found ${oldMemories.length} memories in old database`);

  const insertStmt = newDb.prepare(`
    INSERT OR IGNORE INTO memories (id, type, source, tags, content, content_hash, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let migrated = 0;
  const seen = new Set<string>();

  for (const mem of oldMemories) {
    const contentHash = mem.content_hash || hashContent(mem.content);
    
    if (seen.has(contentHash)) {
      continue;
    }
    seen.add(contentHash);

    try {
      insertStmt.run(
        mem.id,
        mem.type || 'note',
        mem.source || 'migration',
        mem.tags,
        mem.content,
        contentHash,
        mem.created_at
      );
      migrated++;
    } catch {
      // Skip duplicates
    }
  }

  oldDb.close();

  return { total: oldMemories.length, migrated };
}

function createNewDatabase(): Database.Database {
  const db = new Database(NEW_DB);
  
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT DEFAULT 'note',
      source TEXT DEFAULT 'user',
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

    CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
      content,
      tags,
      content='memories',
      content_rowid='rowid',
      tokenize='unicode61'
    );

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

    CREATE TABLE IF NOT EXISTS knowledge_nodes (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      memory_id TEXT,
      created_at TEXT NOT NULL,
      centrality REAL DEFAULT 0,
      connection_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS knowledge_edges (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      target_id TEXT NOT NULL,
      relation TEXT NOT NULL,
      weight REAL DEFAULT 1.0,
      created_at TEXT NOT NULL
    );

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
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tokens INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      importance REAL DEFAULT 0.5,
      is_processed INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS deleted_memories (
      id TEXT PRIMARY KEY,
      memory_id TEXT,
      content TEXT,
      deleted_at TEXT NOT NULL
    );
  `);

  return db;
}

function main(): void {
  console.log('=== OpenCode Memory Migration v4.0 ===\n');

  const db = createNewDatabase();
  console.log('Created new database:', NEW_DB);

  const timelineStats = migrateTimeline(db);
  console.log(`\nTimeline migration:`);
  console.log(`  Total entries: ${timelineStats.total}`);
  console.log(`  Duplicates skipped: ${timelineStats.duplicates}`);
  console.log(`  Migrated: ${timelineStats.migrated}`);

  const dbStats = migrateOldDatabase(db);
  console.log(`\nOld database migration:`);
  console.log(`  Total records: ${dbStats.total}`);
  console.log(`  Migrated: ${dbStats.migrated}`);

  const finalCount = db.prepare(`SELECT COUNT(*) as count FROM memories`).get() as { count: number };
  console.log(`\n✓ Final memory count: ${finalCount.count}`);

  db.exec(`INSERT INTO memories_fts(memories_fts) VALUES('rebuild')`);
  console.log('✓ FTS index rebuilt');

  db.close();

  console.log('\n=== Migration complete ===');
  console.log(`\nNew database: ${NEW_DB}`);
  console.log('\nTo use the new database, update config:');
  console.log(`  dbPath: ~/.opencode/memory/memory_v4.db`);
}

main();