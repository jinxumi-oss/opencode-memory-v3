import type Database from 'better-sqlite3';

interface DecayConfig {
  halfLifeDays: number;
  minWeight: number;
  archiveThreshold: number;
  typeWeights: Record<string, number>;
}

interface DecayResult {
  totalProcessed: number;
  archived: number;
  avgWeight: number;
  lowWeightCount: number;
}

const DEFAULT_CONFIG: DecayConfig = {
  halfLifeDays: 30,
  minWeight: 0.1,
  archiveThreshold: 0.3,
  typeWeights: {
    decision: 1.5,
    pattern: 1.3,
    preference: 1.2,
    note: 1.0,
    context: 0.8,
    learning: 0.9,
    methodology: 1.0,
    principle: 1.4,
  },
};

export class DecayService {
  private db: Database.Database;
  private config: DecayConfig;

  constructor(db: Database.Database, config: Partial<DecayConfig> = {}) {
    this.db = db;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  calculateDecay(): DecayResult {
    const memories = this.db.prepare(`
      SELECT id, type, access_count, last_accessed, created_at, weight
      FROM memories
    `).all() as Array<{
      id: string;
      type: string;
      access_count: number;
      last_accessed: string | null;
      created_at: string;
      weight: number | null;
    }>;

    let archived = 0;
    let totalWeight = 0;
    let lowWeightCount = 0;

    const updateStmt = this.db.prepare(`
      UPDATE memories SET weight = ? WHERE id = ?
    `);

    for (const mem of memories) {
      const newWeight = this.computeWeight(mem);
      totalWeight += newWeight;

      if (newWeight < this.config.archiveThreshold) {
        lowWeightCount++;
      }

      updateStmt.run(newWeight, mem.id);
    }

    return {
      totalProcessed: memories.length,
      archived,
      avgWeight: memories.length > 0 ? totalWeight / memories.length : 0,
      lowWeightCount,
    };
  }

  private computeWeight(mem: {
    type: string;
    access_count: number;
    last_accessed: string | null;
    created_at: string;
  }): number {
    const typeWeight = this.config.typeWeights[mem.type] ?? 1.0;

    const daysSinceAccess = this.daysSince(mem.last_accessed || mem.created_at);

    const decayFactor = Math.pow(0.5, daysSinceAccess / this.config.halfLifeDays);

    const accessBoost = 1 + Math.log10(1 + mem.access_count) * 0.2;

    let weight = typeWeight * decayFactor * accessBoost;

    weight = Math.max(this.config.minWeight, Math.min(2.0, weight));

    return weight;
  }

  private daysSince(dateStr: string): number {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    return Math.max(0, diffMs / (1000 * 60 * 60 * 24));
  }

  getLowWeightMemories(limit: number = 20): Array<{ id: string; type: string; weight: number; content: string }> {
    return this.db.prepare(`
      SELECT id, type, weight, substr(content, 1, 100) as content
      FROM memories
      WHERE weight < ?
      ORDER BY weight ASC
      LIMIT ?
    `).all(this.config.archiveThreshold, limit) as Array<{
      id: string;
      type: string;
      weight: number;
      content: string;
    }>;
  }

  getWeightDistribution(): Record<string, number> {
    const ranges = [
      { label: '0.0-0.3 (low)', min: 0, max: 0.3 },
      { label: '0.3-0.6', min: 0.3, max: 0.6 },
      { label: '0.6-0.9', min: 0.6, max: 0.9 },
      { label: '0.9-1.2', min: 0.9, max: 1.2 },
      { label: '1.2+ (high)', min: 1.2, max: 2.0 },
    ];

    const distribution: Record<string, number> = {};

    for (const range of ranges) {
      const result = this.db.prepare(`
        SELECT COUNT(*) as count FROM memories WHERE weight >= ? AND weight < ?
      `).get(range.min, range.max) as { count: number };
      distribution[range.label] = result.count;
    }

    return distribution;
  }

  getStats(): {
    avgWeight: number;
    minWeight: number;
    maxWeight: number;
    lowWeightCount: number;
    highWeightCount: number;
  } {
    const stats = this.db.prepare(`
      SELECT 
        AVG(weight) as avg_weight,
        MIN(weight) as min_weight,
        MAX(weight) as max_weight,
        SUM(CASE WHEN weight < ? THEN 1 ELSE 0 END) as low_count,
        SUM(CASE WHEN weight > 1.2 THEN 1 ELSE 0 END) as high_count
      FROM memories
    `).get(this.config.archiveThreshold) as {
      avg_weight: number;
      min_weight: number;
      max_weight: number;
      low_count: number;
      high_count: number;
    };

    return {
      avgWeight: stats.avg_weight ?? 0,
      minWeight: stats.min_weight ?? 0,
      maxWeight: stats.max_weight ?? 0,
      lowWeightCount: stats.low_count ?? 0,
      highWeightCount: stats.high_count ?? 0,
    };
  }

  archiveLowWeight(dryRun: boolean = true): number {
    const lowWeightIds = this.db.prepare(`
      SELECT id FROM memories WHERE weight < ?
    `).all(this.config.archiveThreshold) as Array<{ id: string }>;

    if (dryRun) {
      return lowWeightIds.length;
    }

    for (const { id } of lowWeightIds) {
      this.db.prepare(`
        INSERT INTO deleted_memories (id, memory_id, content, deleted_at)
        SELECT 'del_' || id, id, content, datetime('now')
        FROM memories WHERE id = ?
      `).run(id);

      this.db.prepare(`DELETE FROM memories WHERE id = ?`).run(id);
    }

    return lowWeightIds.length;
  }
}