import crypto from 'crypto';
import type Database from 'better-sqlite3';
import type { Memory, StoreOptions, StoreResult, MemoryStats, WorkingMemory, Session } from '../types/index.js';
import { EmbeddingService } from './embedding.js';
import { KnowledgeGraphService } from './knowledge-graph.js';

export class MemoryStore {
  private db: Database.Database;
  private embeddingService: EmbeddingService | null;
  private graphService: KnowledgeGraphService;

  constructor(
    db: Database.Database,
    embeddingService: EmbeddingService | null = null
  ) {
    this.db = db;
    this.embeddingService = embeddingService;
    this.graphService = new KnowledgeGraphService(db);
  }

  async store(options: StoreOptions): Promise<StoreResult> {
    const contentHash = this.hashContent(options.content);
    
    const existing = this.db.prepare(`
      SELECT id FROM memories WHERE content_hash = ?
    `).get(contentHash);
    
    if (existing) {
      return {
        id: (existing as { id: string }).id,
        isNew: false,
        duplicateOf: (existing as { id: string }).id,
      };
    }
    
    const id = `mem_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const createdAt = new Date().toISOString();
    const type = options.type || this.classifyContent(options.content);
    const tags = options.tags?.join(',') || null;
    
    let embedding: Buffer | null = null;
    let embeddingModel: string | null = null;
    
    if (this.embeddingService && !options.skipEmbedding) {
      try {
        const result = await this.embeddingService.embed(options.content);
        embedding = this.vectorToBuffer(result.embedding);
        embeddingModel = result.model;
      } catch {
        embedding = null;
      }
    }
    
    const stmt = this.db.prepare(`
      INSERT INTO memories (id, type, source, tags, content, content_hash, created_at, embedding, embedding_model)
      VALUES (?, ?, 'user', ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, type, tags, options.content, contentHash, createdAt, embedding, embeddingModel);
    
    if (type === 'decision' || type === 'pattern') {
      this.graphService.createNode({
        id: `kn_${id}`,
        type: type === 'decision' ? 'decision' : 'pattern',
        name: options.content.slice(0, 50),
        description: options.content,
        memoryId: id,
      });
    }
    
    return {
      id,
      isNew: true,
      duplicateOf: null,
    };
  }

  get(id: string): Memory | null {
    const row = this.db.prepare(`
      SELECT * FROM memories WHERE id = ?
    `).get(id);
    
    if (!row) return null;
    
    this.db.prepare(`
      UPDATE memories SET access_count = access_count + 1, last_accessed = ? WHERE id = ?
    `).run(new Date().toISOString(), id);
    
    return this.rowToMemory(row as Record<string, unknown>);
  }

  update(id: string, updates: Partial<Pick<Memory, 'content' | 'tags' | 'type'>>): Memory | null {
    const existing = this.get(id);
    if (!existing) return null;
    
    const versionId = `mv_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const updatedAt = new Date().toISOString();
    
    this.db.prepare(`
      INSERT INTO memory_versions (id, memory_id, version, content, updated_at, updated_by)
      SELECT ?, ?, COALESCE(MAX(version), 0) + 1, ?, ?, 'user'
      FROM memory_versions WHERE memory_id = ?
    `).run(versionId, id, existing.content, updatedAt, id);
    
    const setContent = updates.content ? 'content = ?, content_hash = ?,' : '';
    const setTags = updates.tags !== undefined ? 'tags = ?,' : '';
    const setType = updates.type ? 'type = ?,' : '';
    
    const params: (string | number | null)[] = [];
    
    if (updates.content) {
      params.push(updates.content);
      params.push(this.hashContent(updates.content));
    }
    if (updates.tags !== undefined) {
      params.push(updates.tags.join(','));
    }
    if (updates.type) {
      params.push(updates.type);
    }
    
    params.push(updatedAt, id);
    
    this.db.prepare(`
      UPDATE memories 
      SET ${setContent} ${setTags} ${setType} updated_at = ?
      WHERE id = ?
    `).run(...params);
    
    return this.get(id);
  }

  delete(id: string, soft: boolean = true): boolean {
    const memory = this.get(id);
    if (!memory) return false;
    
    if (soft) {
      const deleteId = `del_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      this.db.prepare(`
        INSERT INTO deleted_memories (id, memory_id, content, deleted_at)
        VALUES (?, ?, ?, ?)
      `).run(deleteId, id, memory.content, new Date().toISOString());
    }
    
    this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    
    return true;
  }

  restore(id: string): Memory | null {
    const deleted = this.db.prepare(`
      SELECT * FROM deleted_memories WHERE memory_id = ?
    `).get(id) as Record<string, unknown> | undefined;
    
    if (!deleted) return null;
    
    const result = this.store({
      content: deleted.content as string,
      skipEmbedding: true,
    });
    
    this.db.prepare(`DELETE FROM deleted_memories WHERE memory_id = ?`).run(id);
    
    return typeof result === 'object' && 'then' in result ? null : this.get((result as StoreResult).id);
  }

  stats(recentDays: number = 7): MemoryStats {
    const total = this.db.prepare(`SELECT COUNT(*) as count FROM memories`).get() as { count: number };
    
    const byType = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM memories GROUP BY type
    `).all() as Array<{ type: string; count: number }>;
    
    const bySource = this.db.prepare(`
      SELECT source, COUNT(*) as count FROM memories GROUP BY source
    `).all() as Array<{ source: string; count: number }>;
    
    const recentCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM memories 
      WHERE created_at >= datetime('now', ?)
    `).get(`-${recentDays} days`) as { count: number };
    
    const avgAccess = this.db.prepare(`
      SELECT AVG(access_count) as avg FROM memories
    `).get() as { avg: number | null };
    
    const oldest = this.db.prepare(`
      SELECT MIN(created_at) as oldest FROM memories
    `).get() as { oldest: string | null };
    
    const newest = this.db.prepare(`
      SELECT MAX(created_at) as newest FROM memories
    `).get() as { newest: string | null };
    
    const embeddingCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL
    `).get() as { count: number };
    
    const embeddingCoverage = total.count > 0 ? (embeddingCount.count / total.count) * 100 : 0;
    
    return {
      total: total.count,
      byType: Object.fromEntries(byType.map(r => [r.type, r.count])),
      bySource: Object.fromEntries(bySource.map(r => [r.source, r.count])),
      recentCount: recentCount.count,
      avgAccessCount: avgAccess.avg || 0,
      oldestMemory: oldest.oldest,
      newestMemory: newest.newest,
      embeddingCoverage,
    };
  }

  createSession(): Session {
    const id = `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const startedAt = new Date().toISOString();
    
    this.db.prepare(`
      INSERT INTO sessions (id, started_at, memory_count) VALUES (?, ?, 0)
    `).run(id, startedAt);
    
    return {
      id,
      startedAt,
      endedAt: null,
      contextSummary: null,
      memoryCount: 0,
    };
  }

  endSession(sessionId: string): Session | null {
    const session = this.db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `).get(sessionId) as Record<string, unknown> | undefined;
    
    if (!session) return null;
    
    const endedAt = new Date().toISOString();
    const memoryCount = this.db.prepare(`
      SELECT COUNT(*) as count FROM working_memory WHERE session_id = ?
    `).get(sessionId) as { count: number };
    
    this.db.prepare(`
      UPDATE sessions SET ended_at = ?, memory_count = ? WHERE id = ?
    `).run(endedAt, memoryCount.count, sessionId);
    
    this.promoteWorkingMemory(sessionId);
    
    return {
      id: sessionId,
      startedAt: session.started_at as string,
      endedAt,
      contextSummary: `Session with ${memoryCount.count} interactions`,
      memoryCount: memoryCount.count,
    };
  }

  storeWorkingMemory(sessionId: string, role: 'user' | 'assistant' | 'system', content: string, importance: number = 0.5): WorkingMemory {
    const id = `wm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const createdAt = new Date().toISOString();
    const tokens = Math.ceil(content.length / 4);
    
    this.db.prepare(`
      INSERT INTO working_memory (id, session_id, role, content, tokens, created_at, importance)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, sessionId, role, content, tokens, createdAt, importance);
    
    this.db.prepare(`
      UPDATE sessions SET memory_count = memory_count + 1 WHERE id = ?
    `).run(sessionId);
    
    return {
      id,
      sessionId,
      role,
      content,
      tokens,
      createdAt,
      importance,
      isProcessed: false,
    };
  }

  private promoteWorkingMemory(sessionId: string, threshold: number = 0.7): number {
    const importantMemories = this.db.prepare(`
      SELECT * FROM working_memory 
      WHERE session_id = ? AND importance >= ? AND is_processed = 0
      ORDER BY importance DESC
    `).all(sessionId, threshold) as Array<Record<string, unknown>>;
    
    let promoted = 0;
    
    for (const wm of importantMemories) {
      const content = wm.content as string;
      const type = this.classifyContent(content);
      
      this.store({
        content,
        type,
        importance: wm.importance as number,
        skipEmbedding: false,
      });
      
      this.db.prepare(`
        UPDATE working_memory SET is_processed = 1 WHERE id = ?
      `).run(wm.id);
      
      promoted++;
    }
    
    return promoted;
  }

  private hashContent(content: string): string {
    return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  }

  private classifyContent(content: string): Memory['type'] {
    const decisionPatterns = /决策|决定|选择|选用|采用|方案/;
    const patternPatterns = /规则|流程|规范|模式|惯例/;
    const preferencePatterns = /偏好|喜欢|习惯|倾向|偏好/;
    
    if (decisionPatterns.test(content)) return 'decision';
    if (patternPatterns.test(content)) return 'pattern';
    if (preferencePatterns.test(content)) return 'preference';
    return 'note';
  }

  private vectorToBuffer(vector: number[]): Buffer {
    const float32Array = new Float32Array(vector);
    return Buffer.from(float32Array.buffer);
  }

  private rowToMemory(row: Record<string, unknown>): Memory {
    return {
      id: row.id as string,
      type: row.type as Memory['type'],
      source: row.source as Memory['source'],
      tags: row.tags ? (row.tags as string).split(',').filter(Boolean) : [],
      content: row.content as string,
      contentHash: row.content_hash as string,
      createdAt: row.created_at as string,
      updatedAt: row.updated_at as string | null,
      lastAccessed: row.last_accessed as string | null,
      accessCount: row.access_count as number,
      weight: (row.weight as number) ?? 1.0,
      embedding: null,
      embeddingModel: row.embedding_model as string | null,
    };
  }
}