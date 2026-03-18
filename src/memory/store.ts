import { Database } from 'bun:sqlite';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { checkSemanticDuplicate } from './embeddings';

const DB_PATH = process.env.HOME + '/.opencode/memory/unified.db';
const TIMELINE_DIR = process.env.HOME + '/.opencode/memory/timeline';

export interface TimelineEntry {
  id: string;
  timestamp: string;
  content: string;
  content_hash: string;
  entry_type: string;
  source: string;
  session_id?: string;
  importance: number;
  raw_metadata?: string;
  is_immutable: number;
  created_at: string;
}

export interface Memory {
  id: string;
  content_hash: string;
  summary?: string;
  content: string;
  memory_type: string;
  source: string;
  tier: string;
  weight: number;
  access_count: number;
  timeline_entry_ids?: string;
  tags?: string;
  custom_metadata?: string;
  created_at: string;
  last_accessed?: string;
}

export interface StoreResult {
  id: string;
  isNew: boolean;
  duplicateOf?: string;
}

function ensureDirs(): void {
  const dbDir = path.dirname(DB_PATH);
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  if (!fs.existsSync(TIMELINE_DIR)) fs.mkdirSync(TIMELINE_DIR, { recursive: true });
}

function generateId(prefix: string = ''): string {
  const ts = Date.now().toString(36);
  const rand = crypto.randomBytes(4).toString('hex');
  return prefix ? `${prefix}_${ts}_${rand}` : `${ts}_${rand}`;
}

function hashContent(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function getTodayTimelineFile(): string {
  const today = new Date().toISOString().split('T')[0];
  return path.join(TIMELINE_DIR, `${today}.md`);
}

export function getDatabase(): Database {
  ensureDirs();
  const db = new Database(DB_PATH);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  initializeSchema(db);
  return db;
}

function initializeSchema(db: Database): void {
  const schemaPath = path.join(path.dirname(DB_PATH), 'schema.sql');
  if (fs.existsSync(schemaPath)) {
    const schema = fs.readFileSync(schemaPath, 'utf-8');
    db.exec(schema);
  }
}

export function appendToTimeline(content: string, metadata: {
  type?: string;
  source?: string;
  sessionId?: string;
  importance?: number;
}): TimelineEntry {
  ensureDirs();
  
  const now = new Date();
  const entry: TimelineEntry = {
    id: generateId('tl'),
    timestamp: now.toISOString(),
    content,
    content_hash: hashContent(content),
    entry_type: metadata.type || 'note',
    source: metadata.source || 'user',
    session_id: metadata.sessionId,
    importance: metadata.importance || 0.5,
    is_immutable: 1,
    created_at: now.toISOString()
  };
  
  const filePath = getTodayTimelineFile();
  const frontmatter = [
    '---',
    `id: ${entry.id}`,
    `timestamp: ${entry.timestamp}`,
    `type: ${entry.entry_type}`,
    `source: ${entry.source}`,
    entry.importance ? `importance: ${entry.importance}` : '',
    '---',
    '',
    content,
    ''
  ].filter(Boolean).join('\n');
  
  fs.appendFileSync(filePath, frontmatter, 'utf-8');
  
  return entry;
}

export async function store(content: string, options: {
  type?: string;
  tags?: string[];
  importance?: number;
  sessionId?: string;
} = {}): Promise<StoreResult> {
  const db = getDatabase();
  const hash = hashContent(content);
  const now = new Date().toISOString();
  
  // Step 1: Hash 精确去重
  const existing = db.prepare('SELECT id FROM memories WHERE content_hash = ?').get(hash) as { id: string } | undefined;
  if (existing) {
    db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?')
      .run(now, existing.id);
    
    db.prepare(`
      INSERT OR REPLACE INTO dedup_entries (hash, primary_block_id, dedup_type, similarity, created_at)
      VALUES (?, ?, 'exact', NULL, ?)
    `).run(hash, existing.id, now);
    
    db.close();
    return { id: existing.id, isNew: false, duplicateOf: existing.id };
  }
  
  // Step 2: 语义去重 (阈值 0.95)
  const SEMANTIC_THRESHOLD = 0.95;
  const semanticDuplicate = await checkSemanticDuplicate(content, SEMANTIC_THRESHOLD);
  
  if (semanticDuplicate) {
    db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?')
      .run(now, semanticDuplicate.blockId);
    
    db.prepare(`
      INSERT OR REPLACE INTO dedup_entries (hash, primary_block_id, dedup_type, similarity, created_at)
      VALUES (?, ?, 'semantic', ?, ?)
    `).run(hash, semanticDuplicate.blockId, semanticDuplicate.similarity, now);
    
    db.close();
    return { id: semanticDuplicate.blockId, isNew: false, duplicateOf: semanticDuplicate.blockId };
  }
  
  const timelineEntry = appendToTimeline(content, {
    type: options.type,
    sessionId: options.sessionId,
    importance: options.importance
  });
  
  const memoryId = generateId('mem');
  
  db.prepare(`
    INSERT INTO memories (id, content_hash, content, memory_type, source, tier, weight, timeline_entry_ids, tags, created_at)
    VALUES (?, ?, ?, ?, ?, 'warm', ?, ?, ?, ?)
  `).run(
    memoryId,
    hash,
    content,
    options.type || 'note',
    'user',
    options.importance || 0.5,
    JSON.stringify([timelineEntry.id]),
    options.tags ? JSON.stringify(options.tags) : null,
    now
  );
  
  db.prepare(`
    INSERT INTO dedup_entries (hash, primary_block_id, dedup_type, similarity, created_at)
    VALUES (?, ?, 'exact', NULL, ?)
  `).run(hash, memoryId, now);
  
  try {
    const nerService = new (require('./ner').NERService)(db);
    nerService.process(content, memoryId);
  } catch {}
  
  db.close();
  
  return { id: memoryId, isNew: true };
}

export function recall(query: string, options: {
  limit?: number;
  tier?: string;
  type?: string;
} = {}): Memory[] {
  const db = getDatabase();
  const limit = options.limit || 10;
  
  const ftsQuery = query.split(/\s+/).map(w => `${w}*`).join(' OR ');
  
  let sql = `
    SELECT m.*, bm25(memories_fts) as score
    FROM memories m
    JOIN memories_fts fts ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ? AND m.tier != 'isolated'
  `;
  const params: (string | number)[] = [ftsQuery];
  
  if (options.tier) {
    sql += ' AND m.tier = ?';
    params.push(options.tier);
  }
  if (options.type) {
    sql += ' AND m.memory_type = ?';
    params.push(options.type);
  }
  
  sql += ' ORDER BY score ASC LIMIT ?';
  params.push(limit);
  
  const rows = db.prepare(sql).all(...params) as any[];
  
  const now = new Date().toISOString();
  for (const row of rows) {
    db.prepare('UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?')
      .run(now, row.id);
  }
  
  db.close();
  
  return rows.map(row => ({
    id: row.id,
    content_hash: row.content_hash,
    summary: row.summary,
    content: row.content,
    memory_type: row.memory_type,
    source: row.source,
    tier: row.tier,
    weight: row.weight,
    access_count: row.access_count,
    timeline_entry_ids: row.timeline_entry_ids,
    tags: row.tags,
    custom_metadata: row.custom_metadata,
    created_at: row.created_at,
    last_accessed: row.last_accessed
  }));
}

export function forget(id: string): boolean {
  const db = getDatabase();
  
  const memory = db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Memory | undefined;
  if (!memory) {
    db.close();
    return false;
  }
  
  db.prepare(`
    INSERT INTO deleted_memories (id, memory_id, content, deleted_at)
    VALUES (?, ?, ?, ?)
  `).run(generateId('del'), id, memory.content, new Date().toISOString());
  
  db.prepare('UPDATE memories SET tier = ? WHERE id = ?').run('isolated', id);
  
  db.close();
  return true;
}

export function stats(): { total: number; byType: Record<string, number>; byTier: Record<string, number> } {
  const db = getDatabase();
  
  const total = (db.prepare('SELECT COUNT(*) as count FROM memories WHERE tier != ?').get('isolated') as any)?.count || 0;
  
  const byType: Record<string, number> = {};
  const typeRows = db.prepare('SELECT memory_type, COUNT(*) as count FROM memories WHERE tier != ? GROUP BY memory_type')
    .all('isolated') as any[];
  for (const row of typeRows) byType[row.memory_type] = row.count;
  
  const byTier: Record<string, number> = {};
  const tierRows = db.prepare('SELECT tier, COUNT(*) as count FROM memories GROUP BY tier').all() as any[];
  for (const row of tierRows) byTier[row.tier] = row.count;
  
  db.close();
  
  return { total, byType, byTier };
}

export function rebuildFromTimeline(): number {
  const db = getDatabase();
  let count = 0;
  
  const files = fs.readdirSync(TIMELINE_DIR).filter(f => f.endsWith('.md')).sort();
  
  for (const file of files) {
    const content = fs.readFileSync(path.join(TIMELINE_DIR, file), 'utf-8');
    const entries = parseTimelineContent(content);
    
    for (const entry of entries) {
      const existing = db.prepare('SELECT id FROM timeline_entries WHERE id = ?').get(entry.id);
      if (existing) continue;
      
      db.prepare(`
        INSERT INTO timeline_entries (id, timestamp, content, content_hash, entry_type, source, importance, is_immutable, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        entry.id,
        entry.timestamp,
        entry.content,
        entry.content_hash,
        entry.entry_type,
        entry.source,
        entry.importance || 0.5,
        entry.timestamp
      );
      
      count++;
    }
  }
  
  db.close();
  return count;
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
      const [key, ...values] = line.split(': ');
      if (key && values.length) meta[key.trim()] = values.join(': ').trim();
    });
    
    const bodyContent = body.trim();
    entries.push({
      id: meta.id || generateId('tl'),
      timestamp: meta.timestamp || new Date().toISOString(),
      content: bodyContent,
      content_hash: hashContent(bodyContent),
      entry_type: meta.type || 'note',
      source: meta.source || 'unknown',
      importance: meta.importance ? parseFloat(meta.importance) : 0.5,
      is_immutable: 1,
      created_at: meta.timestamp || new Date().toISOString()
    });
  }
  
  return entries;
}