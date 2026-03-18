import type Database from 'better-sqlite3';
import type { Memory, RecallResult, SearchOptions } from '../types/index.js';
import { EmbeddingService } from './embedding.js';
import { randomUUID } from 'crypto';

export class SearchService {
  private db: Database.Database;
  private embeddingService: EmbeddingService | null;

  constructor(db: Database.Database, embeddingService: EmbeddingService | null = null) {
    this.db = db;
    this.embeddingService = embeddingService;
  }

  private recordRecallHistory(query: string, method: string, results: RecallResult[], sessionId?: string): void {
    try {
      const id = `rh_${Date.now()}_${randomUUID().slice(0, 8)}`;
      const recalledIds = results.map(r => r.memory.id).join(',');
      const avgScore = results.length > 0 
        ? results.reduce((sum, r) => sum + r.score, 0) / results.length 
        : 0;
      
      this.db.prepare(`
        INSERT INTO recall_history (id, session_id, query, recalled_ids, recall_method, score, created_at)
        VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
      `).run(id, sessionId || null, query, recalledIds, method, avgScore);
    } catch {
      // Ignore errors in history recording
    }
  }

  search(options: SearchOptions): RecallResult[] {
    let results: RecallResult[];
    switch (options.method) {
      case 'bm25':
        results = this.bm25Search(options);
        break;
      case 'semantic':
        results = this.semanticSearch(options);
        break;
      case 'hybrid':
        results = this.hybridSearch(options);
        break;
      case 'contextual':
        results = this.contextualSearch(options);
        break;
      default:
        results = this.hybridSearch(options);
    }
    this.recordRecallHistory(options.query, options.method || 'hybrid', results);
    return results;
  }

  bm25Search(options: SearchOptions): RecallResult[] {
    const { query, limit, type, tags, recentDays } = options;
    
    const ftsQuery = this.buildFtsQuery(query);
    
    let sql = `
      SELECT 
        m.*,
        bm25(memories_fts) as bm25_score
      FROM memories m
      JOIN memories_fts fts ON m.rowid = fts.rowid
      WHERE memories_fts MATCH ?
    `;
    
    const params: (string | number)[] = [ftsQuery];
    
    if (type) {
      sql += ' AND m.type = ?';
      params.push(type);
    }
    
    if (tags && tags.length > 0) {
      sql += ` AND (${tags.map(() => 'm.tags LIKE ?').join(' OR ')})`;
      params.push(...tags.map(t => `%${t}%`));
    }
    
    if (recentDays) {
      sql += " AND m.created_at >= datetime('now', ?)";
      params.push(`-${recentDays} days`);
    }
    
    sql += ' ORDER BY bm25_score ASC LIMIT ?';
    params.push(limit);
    
    const rows = this.db.prepare(sql).all(...params) as Array<Memory & { bm25_score: number }>;
    
    return rows.map(row => ({
      memory: this.rowToMemory(row),
      score: this.normalizeBm25Score(row.bm25_score),
      method: 'bm25' as const,
      bm25Score: this.normalizeBm25Score(row.bm25_score),
    }));
  }

  async semanticSearchAsync(options: SearchOptions): Promise<RecallResult[]> {
    if (!this.embeddingService) {
      return this.bm25Search(options);
    }

    const { query, limit, type, tags, recentDays } = options;
    
    const queryEmbedding = await this.embeddingService.embed(query);
    
    let sql = `
      SELECT m.*, m.embedding
      FROM memories m
      WHERE m.embedding IS NOT NULL
    `;
    
    const params: (string | number)[] = [];
    
    if (type) {
      sql += ' AND m.type = ?';
      params.push(type);
    }
    
    if (tags && tags.length > 0) {
      sql += ` AND (${tags.map(() => 'm.tags LIKE ?').join(' OR ')})`;
      params.push(...tags.map(t => `%${t}%`));
    }
    
    if (recentDays) {
      sql += " AND m.created_at >= datetime('now', ?)";
      params.push(`-${recentDays} days`);
    }
    
    const rows = this.db.prepare(sql).all(...params) as Array<Memory & { embedding: Buffer }>;
    
    const results: RecallResult[] = [];
    
    for (const row of rows) {
      const storedEmbedding = this.bufferToVector(row.embedding);
      if (storedEmbedding) {
        const similarity = this.embeddingService.cosineSimilarity(
          queryEmbedding.embedding,
          storedEmbedding
        );
        
        results.push({
          memory: this.rowToMemory(row),
          score: similarity,
          method: 'semantic',
          vectorScore: similarity,
        });
      }
    }
    
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  semanticSearch(options: SearchOptions): RecallResult[] {
    return this.bm25Search(options);
  }

  hybridSearch(options: SearchOptions): RecallResult[] {
    const bm25Results = this.bm25Search({ ...options, limit: options.limit * 2 });
    
    const resultsMap = new Map<string, RecallResult>();
    
    const vectorWeight = options.vectorWeight;
    const bm25Weight = options.bm25Weight;
    
    for (const result of bm25Results) {
      const hybridScore = result.bm25Score! * bm25Weight + (result.vectorScore || 0) * vectorWeight;
      resultsMap.set(result.memory.id, {
        ...result,
        score: hybridScore,
        method: 'hybrid',
      });
    }
    
    const results = Array.from(resultsMap.values());
    results.sort((a, b) => b.score - a.score);
    
    return results.slice(0, options.limit);
  }

  async hybridSearchAsync(options: SearchOptions): Promise<RecallResult[]> {
    const bm25Results = this.bm25Search({ ...options, limit: options.limit * 2 });
    
    let semanticResults: RecallResult[] = [];
    if (this.embeddingService) {
      try {
        semanticResults = await this.semanticSearchAsync({ ...options, limit: options.limit * 2 });
      } catch {
        semanticResults = [];
      }
    }
    
    const resultsMap = new Map<string, RecallResult>();
    
    const vectorWeight = options.vectorWeight;
    const bm25Weight = options.bm25Weight;
    
    for (const result of bm25Results) {
      resultsMap.set(result.memory.id, {
        ...result,
        score: result.bm25Score! * bm25Weight,
        method: 'hybrid',
      });
    }
    
    for (const result of semanticResults) {
      const existing = resultsMap.get(result.memory.id);
      if (existing) {
        existing.score = existing.bm25Score! * bm25Weight + result.vectorScore! * vectorWeight;
        existing.vectorScore = result.vectorScore;
      } else {
        resultsMap.set(result.memory.id, {
          ...result,
          score: result.vectorScore! * vectorWeight,
          method: 'hybrid',
        });
      }
    }
    
    const results = Array.from(resultsMap.values());
    results.sort((a, b) => b.score - a.score);
    
    const finalResults = results.slice(0, options.limit);
    this.recordRecallHistory(options.query, 'hybrid', finalResults);
    return finalResults;
  }

  contextualSearch(options: SearchOptions): RecallResult[] {
    return this.hybridSearch(options);
  }

  private buildFtsQuery(query: string): string {
    const terms = query.split(/\s+/).filter(t => t.length > 0);
    return terms.map(t => `${t}*`).join(' OR ');
  }

  private normalizeBm25Score(score: number): number {
    return 1 / (1 + Math.exp(score / 10));
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

  private bufferToVector(buffer: Buffer | null): number[] | null {
    if (!buffer) return null;
    
    const float32Array = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
    return Array.from(float32Array);
  }
}