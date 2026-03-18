/**
 * Vector Index Module for Memory Blocks
 * Provides embedding generation, storage, and semantic search with fallback to keyword search
 */

const DB_PATH = process.env.HOME + '/.opencode/memory/memory_v4.db';
const OLLAMA_API = 'http://localhost:11434';

export interface MemoryBlock {
  id: string;
  hash: string;
  summary?: string;
  content: string;
  tier: string;
  weight: number;
  accessCount: number;
  createdAt: string;
  lastAccessed?: string;
  metadata: Record<string, any>;
}

export interface SearchResult {
  block: MemoryBlock;
  similarity: number;
}

export interface EmbeddingConfig {
  model: string;
  dimension: number;
  timeout: number;
}

/**
 * Embedding Service with Ollama support and fallback
 */
export class EmbeddingService {
  private config: EmbeddingConfig;
  private cache: Map<string, number[]> = new Map();

  constructor(config?: Partial<EmbeddingConfig>) {
    this.config = {
      model: 'nomic-embed-text',
      dimension: 768,
      timeout: 10000,
      ...config
    };
  }

  async isAvailable(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(`${OLLAMA_API}/api/version`, {
        signal: controller.signal
      });

      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      return false;
    }
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const cacheKey = this.hashText(text);

    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const response = await fetch(`${OLLAMA_API}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.config.model,
        prompt: text
      })
    });

    if (!response.ok) {
      throw new Error(`Embedding failed: ${response.statusText}`);
    }

    const data = await response.json() as { embedding: number[] };
    const embedding = data.embedding;

    this.cache.set(cacheKey, embedding);

    if (this.cache.size > 1000) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }

    return embedding;
  }

  async storeEmbedding(blockId: string, embedding: number[]): Promise<void> {
    const { Database } = await import('bun:sqlite');
    const db = new Database(DB_PATH);

    try {
      const embeddingBuffer = Buffer.from(new Float32Array(embedding).buffer);

      db.run(`
        INSERT OR REPLACE INTO block_embeddings (block_id, embedding, created_at)
        VALUES (?, ?, ?)
      `, [blockId, embeddingBuffer, new Date().toISOString()]);
    } finally {
      db.close();
    }
  }

  async getEmbedding(blockId: string): Promise<number[] | null> {
    const { Database } = await import('bun:sqlite');
    const db = new Database(DB_PATH);

    try {
      const row = db.query(`
        SELECT embedding FROM block_embeddings WHERE block_id = ?
      `).get(blockId) as { embedding: ArrayBuffer } | undefined;

      if (!row?.embedding) return null;

      return Array.from(new Float32Array(row.embedding.buffer || row.embedding));
    } finally {
      db.close();
    }
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) return 0;

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      const aVal = a[i] ?? 0;
      const bVal = b[i] ?? 0;
      dotProduct += aVal * bVal;
      normA += aVal * aVal;
      normB += bVal * bVal;
    }

    if (normA === 0 || normB === 0) return 0;

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  async searchSimilar(query: string, limit: number = 5): Promise<SearchResult[]> {
    const available = await this.isAvailable();

    if (!available) {
      return this.searchByKeywords(query, limit);
    }

    try {
      const queryEmbedding = await this.generateEmbedding(query);

      const { Database } = await import('bun:sqlite');
      const db = new Database(DB_PATH);

      try {
        const rows = db.query(`
          SELECT b.*, e.embedding
          FROM blocks b
          LEFT JOIN block_embeddings e ON b.id = e.block_id
          WHERE b.tier != 'isolated'
        `).all() as any[];

        const results: SearchResult[] = [];

        for (const row of rows) {
          if (!row.embedding) continue;

          const blockEmbedding = Array.from(new Float32Array(row.embedding.buffer || row.embedding));
          const similarity = this.cosineSimilarity(queryEmbedding, blockEmbedding);

          results.push({
            block: this.mapRowToBlock(row),
            similarity
          });
        }

        results.sort((a, b) => b.similarity - a.similarity);
        return results.slice(0, limit);
      } finally {
        db.close();
      }
    } catch (error) {
      console.error('Semantic search failed, falling back to keyword search:', error);
      return this.searchByKeywords(query, limit);
    }
  }

  searchByKeywords(query: string, limit: number = 5): SearchResult[] {
    const { Database } = require('bun:sqlite');
    const db = new Database(DB_PATH);

    try {
      const keywords = query.toLowerCase().split(/\s+/).filter(k => k.length > 2);
      const patterns = keywords.map(() => 'content LIKE ?').join(' OR ');
      const params = keywords.map(k => `%${k}%`);

      const rows = db.query(`
        SELECT * FROM blocks
        WHERE tier != 'isolated' AND (${patterns})
        ORDER BY weight DESC, access_count DESC
        LIMIT ?
      `).all(...params, limit) as any[];

      return rows.map(row => ({
        block: this.mapRowToBlock(row),
        similarity: 0.5
      }));
    } finally {
      db.close();
    }
  }

  async indexBlock(block: MemoryBlock): Promise<void> {
    const available = await this.isAvailable();

    if (!available) {
      console.log('Ollama not available, skipping embedding generation');
      return;
    }

    try {
      const content = `${block.summary || ''} ${block.content}`.trim();
      const embedding = await this.generateEmbedding(content);
      await this.storeEmbedding(block.id, embedding);
    } catch (error) {
      console.error(`Failed to index block ${block.id}:`, error);
    }
  }

  async indexBlocks(blocks: MemoryBlock[]): Promise<void> {
    const available = await this.isAvailable();

    if (!available) {
      console.log('Ollama not available, skipping batch embedding generation');
      return;
    }

    for (const block of blocks) {
      await this.indexBlock(block);
    }
  }

  clearCache(): void {
    this.cache.clear();
  }

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `${this.config.model}:${hash}`;
  }

  private mapRowToBlock(row: any): MemoryBlock {
    return {
      id: row.id,
      hash: row.hash,
      summary: row.summary,
      content: row.content,
      tier: row.tier,
      weight: row.weight,
      accessCount: row.access_count,
      createdAt: row.created_at,
      lastAccessed: row.last_accessed,
      metadata: row.metadata ? JSON.parse(row.metadata) : {}
    };
  }
}

export const embeddingService = new EmbeddingService();

/**
 * Check for semantic duplicates with a given threshold
 * Returns the most similar memory block if similarity > threshold
 * 
 * @param content - Content to check for duplicates
 * @param threshold - Similarity threshold (default: 0.95)
 * @param dbPath - Path to the unified database
 * @returns Promise<{ blockId: string; similarity: number } | null>
 */
export async function checkSemanticDuplicate(
  content: string,
  threshold: number = 0.95,
  dbPath?: string
): Promise<{ blockId: string; similarity: number } | null> {
  const { Database } = await import('bun:sqlite');
  const actualDbPath = dbPath || process.env.HOME + '/.opencode/memory/memory_v4.db';

  try {
    // Check if Ollama is available for embedding generation
    const available = await embeddingService.isAvailable();
    if (!available) {
      console.log('[Semantic Dedup] Ollama not available, skipping semantic dedup check');
      return null;
    }

    // Generate embedding for the content
    const embedding = await embeddingService.generateEmbedding(content);

    const db = new Database(actualDbPath);

    try {
      // Get all embeddings from the database
      const rows = db.query(`
        SELECT m.id, m.content, e.embedding
        FROM memories m
        INNER JOIN block_embeddings e ON m.id = e.block_id
        WHERE m.tier != 'isolated'
      `).all() as Array<{ id: string; content: string; embedding: ArrayBuffer }>;

      let mostSimilar: { blockId: string; similarity: number } | null = null;

      for (const row of rows) {
        const blockEmbedding = Array.from(new Float32Array(row.embedding.buffer || row.embedding));
        const similarity = embeddingService.cosineSimilarity(embedding, blockEmbedding);

        if (similarity > threshold) {
          if (!mostSimilar || similarity > mostSimilar.similarity) {
            mostSimilar = { blockId: row.id, similarity };
          }
        }
      }

      return mostSimilar;
    } finally {
      db.close();
    }
  } catch (error) {
    console.error('[Semantic Dedup] Error checking semantic duplicate:', error);
    return null;
  }
}