/**
 * Unified Memory Storage - L0 Timeline + FTS5 Integration
 * 统一存储模块 - 时序层与全文搜索整合
 * 
 * Features:
 * - L0 Timeline: Append-only storage (never tampered)
 * - SQLite Database: Structured storage with FTS5 index
 * - Sync Mechanism: Timeline → Database → FTS5
 * - Recovery Mechanism: Rebuild database from timeline files
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import Database from 'better-sqlite3';

const HOME_DIR = process.env.HOME || '/home/jin';
const TIMELINE_DIR = path.join(HOME_DIR, '.opencode/memory/timeline');
const DB_PATH = path.join(HOME_DIR, '.opencode/memory/memory_v4.db');

interface TimelineEntry {
  id: string;
  timestamp: string;
  content: string;
metadata: {
    type: 'decision' | 'learning' | 'context' | 'preference' | 'error';
    source: string;
    tags?: string[];
    importance?: number;
  }
}

function ensureTimelineDir(): void {
  if (!fs.existsSync(TIMELINE_DIR)) {
    fs.mkdirSync(TIMELINE_DIR, { recursive: true });
  }
}

function getTodayFile(): string {
  const today = new Date().toISOString().split('T')[0];
  return path.join(TIMELINE_DIR, `${today}.md`);
}

function generateId(timestamp: Date): string {
  const seq = Date.now().toString(36);
  const hash = crypto.randomBytes(4).toString('hex');
  return `${timestamp.toISOString().replace(/[:.]/g, '-')}_${seq}_${hash}`;
}

function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function formatEntry(entry: TimelineEntry): string {
  const frontmatter = [
    '---',
    `id: ${entry.id}`,
    `timestamp: ${entry.timestamp}`,
    `type: ${entry.metadata.type}`,
    `source: ${entry.metadata.source}`,
    entry.metadata.tags ? `tags: ${JSON.stringify(entry.metadata.tags)}` : '',
    entry.metadata.importance ? `importance: ${entry.metadata.importance}` : '',
    '---',
    ''
  ].filter(Boolean).join('\n');

  return `${frontmatter}${entry.content}\n\n`;
}

function parseTimelineContent(content: string): TimelineEntry[] {
  const entries: TimelineEntry[] = [];
  const parts = content.split('---\n').filter(p => p.trim());

  for (let i = 0; i < parts.length; i += 2) {
    if (i + 1 >= parts.length) break;

    const frontmatter = parts[i];
    const body = parts[i + 1];

    if (!frontmatter || !body) continue;

    const meta: Record<string, string> = {};
    frontmatter.split('\n').forEach(line => {
      const colonIndex = line.indexOf(': ');
      if (colonIndex > 0) {
        const key = line.substring(0, colonIndex).trim();
        const value = line.substring(colonIndex + 2).trim();
        if (key && value) {
          meta[key] = value;
        }
      }
    });

    const bodyContent = body.trim();
    entries.push({
      id: meta.id || '',
      timestamp: meta.timestamp || '',
      content: bodyContent,
      metadata: {
        type: (meta.type as TimelineEntry['metadata']['type']) || 'context',
        source: meta.source || 'unknown',
        tags: meta.tags ? JSON.parse(meta.tags) : undefined,
        importance: meta.importance ? parseInt(meta.importance) : undefined
      }
    });
  }

  return entries;
}

export function readTimelineFile(date: string): TimelineEntry[] {
  const filePath = path.join(TIMELINE_DIR, `${date}.md`);
  
  if (!fs.existsSync(filePath)) {
    return [];
  }

  const content = fs.readFileSync(filePath, 'utf-8');
  return parseTimelineContent(content);
}

export function readAllTimeline(): TimelineEntry[] {
  ensureTimelineDir();
  
  const files = fs.readdirSync(TIMELINE_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  const entries: TimelineEntry[] = [];
  
  for (const file of files) {
    const date = file.replace('.md', '');
    entries.push(...readTimelineFile(date));
  }

  return entries;
}

export function getTimelineStats(): {
  totalEntries: number;
  totalFiles: number;
  oldestDate: string | null;
  newestDate: string | null;
} {
  ensureTimelineDir();
  
  const files = fs.readdirSync(TIMELINE_DIR)
    .filter(f => f.endsWith('.md'))
    .sort();

  if (files.length === 0) {
    return {
      totalEntries: 0,
      totalFiles: 0,
      oldestDate: null,
      newestDate: null
    };
  }

  let totalEntries = 0;
  for (const file of files) {
    const date = file.replace('.md', '');
    totalEntries += readTimelineFile(date).length;
  }

  return {
    totalEntries,
    totalFiles: files.length,
    oldestDate: files[0]?.replace('.md', '') || null,
    newestDate: files[files.length - 1]?.replace('.md', '') || null
  };
}

function initializeSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      type TEXT DEFAULT 'note' CHECK(type IN ('decision', 'learning', 'context', 'preference', 'error', 'note')),
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
  `);
}

let _db: Database.Database | null = null;

function getDatabase(): Database.Database {
  if (!_db) {
    const dbDir = path.dirname(DB_PATH);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('synchronous = NORMAL');
    initializeSchema(_db);
  }
  return _db;
}

export function closeDatabase(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

// ============== Sync Mechanism: Timeline → Database → FTS5 ==============
export function appendToTimeline(
  content: string,
  metadata: Partial<TimelineEntry['metadata']>
): TimelineEntry {
  ensureTimelineDir();

  const now = new Date();
  const entry: TimelineEntry = {
    id: generateId(now),
    timestamp: now.toISOString(),
    content,
    metadata: {
      type: metadata.type || 'context',
      source: metadata.source || 'user',
      tags: metadata.tags,
      importance: metadata.importance
    }
  };

  // Write to timeline file (L0 - append only)
  const filePath = getTodayFile();
  const formatted = formatEntry(entry);
  fs.appendFileSync(filePath, formatted, 'utf-8');

  // Sync to database (L1 with FTS5)
  syncEntryToDatabase(entry);

  return entry;
}

function syncEntryToDatabase(entry: TimelineEntry): void {
  const db = getDatabase();
  
  const contentHash = computeHash(entry.content);
  const tagsStr = entry.metadata.tags ? JSON.stringify(entry.metadata.tags) : null;
  
  try {
    const stmt = db.prepare(`
      INSERT OR IGNORE INTO memories 
      (id, type, source, tags, content, content_hash, created_at, access_count)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `);
    
    stmt.run(
      entry.id,
      entry.metadata.type,
      entry.metadata.source,
      tagsStr,
      entry.content,
      contentHash,
      entry.timestamp
    );
  } catch (error) {
    // Entry might already exist (duplicate), skip silently
    console.warn(`[Unified] Sync skipped for entry ${entry.id}: ${(error as Error).message}`);
  }
}

export function syncTimelineToDatabase(): { synced: number; skipped: number } {
  const entries = readAllTimeline();
  const db = getDatabase();
  let synced = 0;
  let skipped = 0;

  const insertStmt = db.prepare(`
    INSERT OR IGNORE INTO memories 
    (id, type, source, tags, content, content_hash, created_at, access_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `);

  db.transaction(() => {
    for (const entry of entries) {
      const contentHash = computeHash(entry.content);
      const tagsStr = entry.metadata.tags ? JSON.stringify(entry.metadata.tags) : null;
      
      try {
        const result = insertStmt.run(
          entry.id,
          entry.metadata.type,
          entry.metadata.source,
          tagsStr,
          entry.content,
          contentHash,
          entry.timestamp
        );
        
        if (result.changes > 0) {
          synced++;
        } else {
          skipped++;
        }
      } catch (error) {
        skipped++;
        console.warn(`[Unified] Sync skipped for entry ${entry.id}: ${(error as Error).message}`);
      }
    }
  })();

  return { synced, skipped };
}

// ============== Recovery Mechanism: Timeline → Rebuild Database ==============
export function rebuildDatabaseFromTimeline(): { rebuilt: number; errors: number } {
  const entries = readAllTimeline();
  
  // Close existing connection
  closeDatabase();
  
  // Remove existing database
  if (fs.existsSync(DB_PATH)) {
    fs.unlinkSync(DB_PATH);
  }
  // Remove WAL files if they exist
  const walPath = DB_PATH + '-wal';
  const shmPath = DB_PATH + '-shm';
  if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
  if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);
  
  // Create fresh database
  const db = getDatabase();
  
  let rebuilt = 0;
  let errors = 0;

  const insertStmt = db.prepare(`
    INSERT INTO memories 
    (id, type, source, tags, content, content_hash, created_at, access_count)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0)
  `);

  db.transaction(() => {
    for (const entry of entries) {
      const contentHash = computeHash(entry.content);
      const tagsStr = entry.metadata.tags ? JSON.stringify(entry.metadata.tags) : null;
      
      try {
        insertStmt.run(
          entry.id,
          entry.metadata.type,
          entry.metadata.source,
          tagsStr,
          entry.content,
          contentHash,
          entry.timestamp
        );
        rebuilt++;
      } catch (error) {
        errors++;
        console.error(`[Unified] Rebuild error for entry ${entry.id}: ${(error as Error).message}`);
      }
    }
  })();

  return { rebuilt, errors };
}

// ============== FTS5 Search ==============
export interface SearchResult {
  id: string;
  type: string;
  source: string;
  tags: string[];
  content: string;
  created_at: string;
  score: number;
}

export function searchMemories(query: string, limit: number = 20): SearchResult[] {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT 
      m.id,
      m.type,
      m.source,
      m.tags,
      m.content,
      m.created_at,
     _bm25(memories_fts) as score
    FROM memories_fts fts
    JOIN memories m ON fts.rowid = m.rowid
    WHERE memories_fts MATCH ?
    ORDER BY score
    LIMIT ?
  `);

  const rows = stmt.all(query, limit) as any[];
  
  return rows.map(row => ({
    id: row.id,
    type: row.type,
    source: row.source,
    tags: row.tags ? JSON.parse(row.tags) : [],
    content: row.content,
    created_at: row.created_at,
    score: row.score
  }));
}

export function searchMemoriesByType(type: string, limit: number = 50): SearchResult[] {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT 
      id,
      type,
      source,
      tags,
      content,
      created_at,
      0 as score
    FROM memories
    WHERE type = ?
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(type, limit) as any[];
  
  return rows.map(row => ({
    id: row.id,
    type: row.type,
    source: row.source,
    tags: row.tags ? JSON.parse(row.tags) : [],
    content: row.content,
    created_at: row.created_at,
    score: row.score
  }));
}

export function getAllMemories(limit: number = 100): SearchResult[] {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT 
      id,
      type,
      source,
      tags,
      content,
      created_at,
      0 as score
    FROM memories
    ORDER BY created_at DESC
    LIMIT ?
  `);

  const rows = stmt.all(limit) as any[];
  
  return rows.map(row => ({
    id: row.id,
    type: row.type,
    source: row.source,
    tags: row.tags ? JSON.parse(row.tags) : [],
    content: row.content,
    created_at: row.created_at,
    score: row.score
  }));
}

export function getMemoryById(id: string): SearchResult | null {
  const db = getDatabase();
  
  const stmt = db.prepare(`
    SELECT 
      id,
      type,
      source,
      tags,
      content,
      created_at,
      0 as score
    FROM memories
    WHERE id = ?
  `);

  const row = stmt.get(id) as any;
  
  if (!row) return null;
  
  return {
    id: row.id,
    type: row.type,
    source: row.source,
    tags: row.tags ? JSON.parse(row.tags) : [],
    content: row.content,
    created_at: row.created_at,
    score: row.score
  };
}

// ============== Utilities ==============
export function getDatabaseStats(): {
  totalMemories: number;
  totalFtsEntries: number;
  ftsTokenizer: string;
} {
  const db = getDatabase();
  
  const memCount = db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
  const ftsCount = db.prepare('SELECT COUNT(*) as count FROM memories_fts').get() as { count: number };
  const tokenizer = db.prepare("SELECT 'unicode61' as tokenizer").get() as { tokenizer: string };
  
  return {
    totalMemories: memCount.count,
    totalFtsEntries: ftsCount.count,
    ftsTokenizer: tokenizer.tokenizer
  };
}

export function verifyFtsIntegrity(): { valid: boolean; issues: string[] } {
  const db = getDatabase();
  const issues: string[] = [];
  
  // Check memories count matches FTS count
  const memCount = db.prepare('SELECT COUNT(*) as count FROM memories').get() as { count: number };
  const ftsCount = db.prepare('SELECT COUNT(*) as count FROM memories_fts').get() as { count: number };
  
  if (memCount.count !== ftsCount.count) {
    issues.push(`Count mismatch: memories=${memCount.count}, fts=${ftsCount.count}`);
  }
  
  // Check for orphaned FTS entries
  const orphaned = db.prepare(`
    SELECT COUNT(*) as count FROM memories_fts fts
    WHERE NOT EXISTS (SELECT 1 FROM memories m WHERE m.rowid = fts.rowid)
  `).get() as { count: number };
  
  if (orphaned.count > 0) {
    issues.push(`Found ${orphaned.count} orphaned FTS entries`);
  }
  
  // Try FTS rebuild
  try {
    db.exec("INSERT INTO memories_fts(memories_fts) VALUES('rebuild')");
  } catch (error) {
    issues.push(`FTS rebuild failed: ${(error as Error).message}`);
  }
  
  return {
    valid: issues.length === 0,
    issues
  };
}

// ============== Export for CLI/Testing ==============
if (import.meta.main) {
  console.log('[Unified Memory] Module loaded');
  console.log('Timeline Dir:', TIMELINE_DIR);
  console.log('Database Path:', DB_PATH);
}
