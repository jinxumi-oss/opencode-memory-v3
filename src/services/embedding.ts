import ollama from 'ollama';
import type { MemoryConfig } from '../types/index.js';

export interface EmbeddingResult {
  embedding: number[];
  model: string;
  dimension: number;
}

export class EmbeddingService {
  private config: MemoryConfig;
  private cache: Map<string, number[]> = new Map();

  constructor(config: MemoryConfig) {
    this.config = config;
  }

  async embed(text: string): Promise<EmbeddingResult> {
    const cacheKey = this.hashText(text);
    
    if (this.cache.has(cacheKey)) {
      return {
        embedding: this.cache.get(cacheKey)!,
        model: this.config.embeddingModel,
        dimension: this.config.embeddingDimension,
      };
    }

    try {
      const response = await ollama.embeddings({
        model: this.config.embeddingModel,
        prompt: text,
      });

      const embedding = response.embedding;
      
      this.cache.set(cacheKey, embedding);
      
      if (this.cache.size > 1000) {
        const firstKey = this.cache.keys().next().value;
        if (firstKey) this.cache.delete(firstKey);
      }

      return {
        embedding,
        model: this.config.embeddingModel,
        dimension: embedding.length,
      };
    } catch (error) {
      throw new Error(`Embedding failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async embedBatch(texts: string[]): Promise<EmbeddingResult[]> {
    return Promise.all(texts.map(text => this.embed(text)));
  }

  cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same dimension');
    }

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

  private hashText(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return `${this.config.embeddingModel}:${hash}`;
  }

  clearCache(): void {
    this.cache.clear();
  }
}