import { Database } from 'bun:sqlite';
import { EmbeddingService } from './embeddings.js';

const DB_PATH = process.env.HOME + '/.opencode/memory/unified.db';
const RRF_K = 60;

export interface SearchOptions {
  query: string;
  limit?: number;
  method?: 'bm25' | 'semantic' | 'hybrid' | 'timeline';
  tier?: string;
  type?: string;
  timeRange?: { start: string; end: string };
  weights?: { vector: number; bm25: number };
}

export interface SearchResult {
  memory: any;
  score: number;
  method: string;
  bm25Score?: number;
  vectorScore?: number;
  bm25Rank?: number;
  vectorRank?: number;
}

const embeddingService = new EmbeddingService();

function getDb(): Database {
  return new Database(DB_PATH);
}

function rowToMemory(row: any): any {
  return {
    id: row.id,
    content_hash: row.content_hash,
    summary: row.summary,
    content: row.content,
    memory_type: row.memory_type,
    source: row.source,
    tier: row.tier,
    weight: row.weight,
    access_count: row.access_count,
    timeline_entry_ids: row.timeline_entry_ids ? JSON.parse(row.timeline_entry_ids) : [],
    tags: row.tags ? JSON.parse(row.tags) : [],
    custom_metadata: row.custom_metadata ? JSON.parse(row.custom_metadata) : {},
    created_at: row.created_at,
    last_accessed: row.last_accessed
  };
}

export function bm25Search(options: SearchOptions): SearchResult[] {
  const db = getDb();
  const { query, limit = 10, tier, type } = options;
  
  const ftsQuery = query.split(/\s+/).filter(w => w.length > 1).map(w => `${w}*`).join(' OR ');
  
  let sql = `
    SELECT m.*, bm25(memories_fts) as bm25_score
    FROM memories m
    JOIN memories_fts fts ON m.rowid = fts.rowid
    WHERE memories_fts MATCH ? AND m.tier != 'isolated'
  `;
  const params: (string | number)[] = [ftsQuery];
  
  if (tier) {
    sql += ' AND m.tier = ?';
    params.push(tier);
  }
  if (type) {
    sql += ' AND m.memory_type = ?';
    params.push(type);
  }
  
  sql += ' ORDER BY bm25_score ASC LIMIT ?';
  params.push(limit * 2);
  
  const rows = db.prepare(sql).all(...params) as any[];
  db.close();
  
  return rows.map((row, index) => ({
    memory: rowToMemory(row),
    score: normalizeBm25Score(row.bm25_score),
    method: 'bm25',
    bm25Score: normalizeBm25Score(row.bm25_score),
    bm25Rank: index + 1
  })).slice(0, limit);
}

export async function semanticSearch(options: SearchOptions): Promise<SearchResult[]> {
  const db = getDb();
  const { query, limit = 10, tier, type } = options;
  
  const queryEmbedding = await (embeddingService as any).embed(query);
  if (!queryEmbedding || queryEmbedding.length === 0) {
    db.close();
    return bm25Search(options);
  }
  
  let sql = `
    SELECT m.*, be.embedding 
    FROM memories m
    LEFT JOIN block_embeddings be ON m.id = be.block_id
    WHERE m.tier != 'isolated'
  `;
  const params: (string | number)[] = [];
  
  if (tier) {
    sql += ' AND m.tier = ?';
    params.push(tier);
  }
  if (type) {
    sql += ' AND m.memory_type = ?';
    params.push(type);
  }
  
  const rows = db.prepare(sql).all(...params) as any[];
  
  const results: SearchResult[] = [];
  for (const row of rows) {
    if (!row.embedding) continue;
    
    const storedEmbedding = Array.from(new Float32Array(row.embedding));
    const similarity = embeddingService.cosineSimilarity(queryEmbedding.embedding, storedEmbedding);
    
    if (similarity > 0.1) {
      results.push({
        memory: rowToMemory(row),
        score: similarity,
        method: 'semantic',
        vectorScore: similarity
      });
    }
  }
  
  results.sort((a, b) => b.score - a.score);
  db.close();
  
  return results.slice(0, limit * 2).map((r, i) => ({ ...r, vectorRank: i + 1 })).slice(0, limit);
}

export async function hybridSearch(options: SearchOptions): Promise<SearchResult[]> {
  const { limit = 10, weights = { vector: 0.7, bm25: 0.3 } } = options;
  
  const fetchLimit = limit * 2;
  
  const bm25Results = bm25Search({ ...options, limit: fetchLimit });
  const semanticResults = await semanticSearch({ ...options, limit: fetchLimit });
  
  const rrfScores = new Map<string, { result: SearchResult; rrfScore: number }>();
  
  for (let i = 0; i < bm25Results.length; i++) {
    const result = bm25Results[i];
    if (!result) continue;
    
    const rank = i + 1;
    const rrfContribution = weights.bm25 / (RRF_K + rank);
    
    rrfScores.set(result.memory.id, {
      result: {
        ...result,
        method: 'hybrid',
        bm25Rank: rank,
        score: rrfContribution
      },
      rrfScore: rrfContribution
    });
  }
  
  for (let i = 0; i < semanticResults.length; i++) {
    const result = semanticResults[i];
    if (!result) continue;
    
    const rank = i + 1;
    const rrfContribution = weights.vector / (RRF_K + rank);
    
    const existing = rrfScores.get(result.memory.id);
    if (existing) {
      existing.rrfScore += rrfContribution;
      existing.result.vectorScore = result.vectorScore;
      existing.result.vectorRank = rank;
      existing.result.score = existing.rrfScore;
    } else {
      rrfScores.set(result.memory.id, {
        result: {
          ...result,
          method: 'hybrid',
          vectorRank: rank,
          score: rrfContribution
        },
        rrfScore: rrfContribution
      });
    }
  }
  
  const results = Array.from(rrfScores.values());
  results.sort((a, b) => b.rrfScore - a.rrfScore);
  
  return results.slice(0, limit).map(r => ({
    ...r.result,
    score: r.rrfScore
  }));
}

export function timelineSearch(options: SearchOptions): SearchResult[] {
  const db = getDb();
  const { timeRange, limit = 10, type } = options;
  
  if (!timeRange) {
    db.close();
    return [];
  }
  
  let sql = `
    SELECT m.* FROM memories m
    WHERE m.created_at BETWEEN ? AND ? AND m.tier != 'isolated'
  `;
  const params: (string | number)[] = [timeRange.start, timeRange.end];
  
  if (type) {
    sql += ' AND m.memory_type = ?';
    params.push(type);
  }
  
  sql += ' ORDER BY m.created_at DESC LIMIT ?';
  params.push(limit);
  
  const rows = db.prepare(sql).all(...params) as any[];
  db.close();
  
  return rows.map(row => ({
    memory: rowToMemory(row),
    score: 0.5,
    method: 'timeline'
  }));
}

export async function search(options: SearchOptions): Promise<SearchResult[]> {
  switch (options.method) {
    case 'bm25':
      return bm25Search(options);
    case 'semantic':
      return semanticSearch(options);
    case 'timeline':
      return timelineSearch(options);
    case 'hybrid':
    default:
      return hybridSearch(options);
  }
}

function normalizeBm25Score(score: number): number {
  return 1 / (1 + Math.exp(score / 10));
}