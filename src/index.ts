import Database from 'better-sqlite3';
import { MemoryConfigSchema, type MemoryConfig, type SearchOptions } from './types/index.js';
import { createDatabase, rebuildFtsIndex } from './db/database.js';
import { EmbeddingService } from './services/embedding.js';
import { SearchService } from './services/search.js';
import { MemoryStore } from './services/store.js';
import { KnowledgeGraphService } from './services/knowledge-graph.js';
import { LearningService } from './services/learning.js';
import { SessionService } from './services/session.js';
import { DecayService } from './services/decay.js';
import { NERService } from './services/ner.js';
import { InferenceService } from './services/inference.js';
import { NLPService } from './services/nlp.js';
import { CompressionService } from './services/compression.js';

export class MemorySystem {
  public db: Database.Database;
  public memoryStore: MemoryStore;
  public search: SearchService;
  public graph: KnowledgeGraphService;
  public learning: LearningService;
  public session: SessionService;
  public decay: DecayService;
  public ner: NERService;
  public inference: InferenceService;
  public nlp: NLPService;
  public compression: CompressionService;
  public embedding: EmbeddingService | null;
  public config: MemoryConfig;

  constructor(config: Partial<MemoryConfig> = {}) {
    this.config = MemoryConfigSchema.parse(config);
    
    this.db = createDatabase(this.config);
    
    this.embedding = null;
    try {
      this.embedding = new EmbeddingService(this.config);
    } catch {
      this.embedding = null;
    }
    
    this.memoryStore = new MemoryStore(this.db, this.embedding);
    this.search = new SearchService(this.db, this.embedding);
    this.graph = new KnowledgeGraphService(this.db);
    this.learning = new LearningService(this.db);
    this.session = new SessionService(this.db, this.graph);
    this.decay = new DecayService(this.db);
    this.ner = new NERService(this.db, this.graph);
    this.inference = new InferenceService(this.db, this.graph);
    this.nlp = new NLPService(this.db);
    this.compression = new CompressionService(this.db);
  }

  async store(content: string, options: { type?: string; tags?: string[] } = {}): Promise<string> {
    const result = await this.memoryStore.store({
      content,
      type: options.type as 'decision' | 'pattern' | 'preference' | 'note' | 'context' | 'learning' | undefined,
      tags: options.tags,
    });

    if (result.isNew) {
      const matchedRules = this.learning.matchRules(content);
      if (matchedRules.length > 0) {
        console.log(`匹配到 ${matchedRules.length} 条学习规则`);
      }

      this.ner.processAndStore(content, result.id);
    }

    return result.id;
  }

  async recall(query: string, limit: number = 10) {
    const searchOptions: SearchOptions = {
      query,
      limit,
      method: 'hybrid',
      vectorWeight: this.config.hybridSearchWeights.vector,
      bm25Weight: this.config.hybridSearchWeights.bm25,
    };

    const results = await this.search.hybridSearchAsync(searchOptions);
    
    for (const result of results) {
      this.db.prepare(`
        UPDATE memories SET access_count = access_count + 1, last_accessed = datetime('now')
        WHERE id = ?
      `).run(result.memory.id);
    }

    return results;
  }

  forget(id: string, permanent: boolean = false): boolean {
    const memory = this.memoryStore.get(id);
    if (!memory) return false;

    if (!permanent) {
      this.db.prepare(`
        INSERT INTO deleted_memories (id, memory_id, content, deleted_at)
        VALUES (?, ?, ?, datetime('now'))
      `).run(`del_${id}`, id, memory.content);
    }

    this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    return true;
  }

  async restore(id: string): Promise<string | null> {
    const deleted = this.db.prepare(`
      SELECT * FROM deleted_memories WHERE memory_id = ?
    `).get(id) as Record<string, unknown> | undefined;

    if (!deleted) return null;

    const result = await this.memoryStore.store({
      content: deleted.content as string,
      skipEmbedding: true,
    });

    this.db.prepare(`DELETE FROM deleted_memories WHERE memory_id = ?`).run(id);

    return result.id;
  }

  analyze(): { rulesCreated: number; patternsFound: number } {
    return this.learning.analyzeAndLearn();
  }

  runDecay(): { processed: number; avgWeight: number; lowWeightCount: number } {
    const result = this.decay.calculateDecay();
    return {
      processed: result.totalProcessed,
      avgWeight: result.avgWeight,
      lowWeightCount: result.lowWeightCount,
    };
  }

  extractEntities(memoryId: string): { entities: number; relations: number } {
    const memory = this.memoryStore.get(memoryId);
    if (!memory) return { entities: 0, relations: 0 };
    const result = this.ner.processAndStore(memory.content, memoryId);
    return {
      entities: result.entitiesCreated,
      relations: result.relationsCreated,
    };
  }

  batchExtractEntities(limit: number = 100): { processed: number; entities: number; relations: number } {
    return this.ner.batchProcess(limit);
  }

  inferRelations(): number {
    const inferences = this.inference.inferRelations();
    return this.inference.applyInferences(inferences);
  }

  getRecommendations(memoryId: string): Array<{ memoryId: string; content: string; score: number }> {
    return this.inference.getRelatedMemories(memoryId);
  }

  async classifyMemories(limit: number = 50): Promise<{ processed: number; updated: number }> {
    return this.nlp.batchClassify(limit);
  }

  compressSession(sessionId: string): { original: number; compressed: number; summary: string } {
    const result = this.compression.compressSession(sessionId);
    return {
      original: result.originalCount,
      compressed: result.compressedCount,
      summary: result.summary,
    };
  }

  rebuildIndex(): void {
    rebuildFtsIndex(this.db);
    this.graph.calculateCentrality();
    this.decay.calculateDecay();
  }

  close(): void {
    this.db.close();
  }
}

export { createDatabase } from './db/database.js';
export { EmbeddingService } from './services/embedding.js';
export { SearchService } from './services/search.js';
export { MemoryStore } from './services/store.js';
export { KnowledgeGraphService } from './services/knowledge-graph.js';
export { LearningService } from './services/learning.js';
export { SessionService } from './services/session.js';
export { DecayService } from './services/decay.js';
export { NERService } from './services/ner.js';
export { InferenceService } from './services/inference.js';
export { NLPService } from './services/nlp.js';
export { CompressionService } from './services/compression.js';
export * from './types/index.js';