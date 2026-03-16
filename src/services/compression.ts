import type Database from 'better-sqlite3';

interface CompressionResult {
  originalCount: number;
  compressedCount: number;
  summary: string;
  keyPoints: string[];
  preservedIds: string[];
}

interface SessionSummary {
  sessionId: string;
  summary: string;
  keyDecisions: string[];
  keyPatterns: string[];
  entities: string[];
}

export class CompressionService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  compressSession(sessionId: string, threshold: number = 20): CompressionResult {
    const workingMemory = this.db.prepare(`
      SELECT id, role, content, importance, created_at
      FROM working_memory
      WHERE session_id = ?
      ORDER BY created_at ASC
    `).all(sessionId) as Array<{
      id: string;
      role: string;
      content: string;
      importance: number;
      created_at: string;
    }>;

    if (workingMemory.length < threshold) {
      return {
        originalCount: workingMemory.length,
        compressedCount: workingMemory.length,
        summary: '',
        keyPoints: [],
        preservedIds: workingMemory.map(m => m.id),
      };
    }

    const highImportance = workingMemory.filter(m => m.importance >= 0.7);
    
    const recentCount = Math.ceil(threshold / 2);
    const recent = workingMemory.slice(-recentCount);

    const toArchive = workingMemory.filter(
      m => !highImportance.find(h => h.id === m.id) && !recent.find(r => r.id === m.id)
    );

    const summary = this.generateSummary(toArchive);
    const keyPoints = this.extractKeyPoints(toArchive);

    for (const mem of toArchive) {
      this.db.prepare(`
        UPDATE working_memory SET is_processed = 1 WHERE id = ?
      `).run(mem.id);
    }

    const preservedIds = [...highImportance, ...recent].map(m => m.id);

    return {
      originalCount: workingMemory.length,
      compressedCount: preservedIds.length,
      summary,
      keyPoints,
      preservedIds,
    };
  }

  private generateSummary(memories: Array<{ role: string; content: string }>): string {
    const userMessages = memories.filter(m => m.role === 'user').map(m => m.content);
    const assistantMessages = memories.filter(m => m.role === 'assistant').map(m => m.content);

    const userKeywords = this.extractKeywords(userMessages.join(' '));
    const assistantKeywords = this.extractKeywords(assistantMessages.join(' '));

    return `用户关注: ${userKeywords.slice(0, 5).join(', ')}; 助手响应: ${assistantKeywords.slice(0, 5).join(', ')}`;
  }

  private extractKeyPoints(memories: Array<{ role: string; content: string; importance: number }>): string[] {
    const keyPoints: string[] = [];

    for (const mem of memories) {
      const decisions = mem.content.match(/决策[：:]\s*(.+)/g);
      if (decisions) {
        keyPoints.push(...decisions.map(d => d.slice(0, 50)));
      }

      const patterns = mem.content.match(/规则[：:]\s*(.+)/g);
      if (patterns) {
        keyPoints.push(...patterns.map(p => p.slice(0, 50)));
      }
    }

    return [...new Set(keyPoints)].slice(0, 5);
  }

  private extractKeywords(text: string): string[] {
    const words = text.match(/[\u4e00-\u9fa5]{2,10}|[a-zA-Z]{3,}/g) || [];
    const freq: Record<string, number> = {};

    for (const word of words) {
      freq[word] = (freq[word] || 0) + 1;
    }

    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([word]) => word);
  }

  createSessionSummary(sessionId: string): SessionSummary | null {
    const session = this.db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `).get(sessionId) as Record<string, unknown> | undefined;

    if (!session) return null;

    const workingMemory = this.db.prepare(`
      SELECT role, content FROM working_memory WHERE session_id = ?
    `).all(sessionId) as Array<{ role: string; content: string }>;

    const allContent = workingMemory.map(m => m.content).join(' ');

    const keyDecisions: string[] = [];
    const decisionMatches = allContent.match(/决策[：:]\s*[^\n]+/g) || [];
    keyDecisions.push(...decisionMatches.map(d => d.slice(0, 50)));

    const keyPatterns: string[] = [];
    const patternMatches = allContent.match(/规则[：:]\s*[^\n]+/g) || [];
    keyPatterns.push(...patternMatches.map(p => p.slice(0, 50)));

    const entities: string[] = [];
    const techMatches = allContent.match(/(React|Vue|TypeScript|Python|Docker|Kubernetes)/gi) || [];
    entities.push(...[...new Set(techMatches)]);

    const summary = this.generateSummary(workingMemory);

    this.db.prepare(`
      UPDATE sessions SET context_summary = ? WHERE id = ?
    `).run(summary, sessionId);

    return {
      sessionId,
      summary,
      keyDecisions,
      keyPatterns,
      entities,
    };
  }

  getCompressionStats(): { totalSessions: number; compressedSessions: number; avgCompressionRatio: number } {
    const sessions = this.db.prepare(`
      SELECT id FROM sessions WHERE ended_at IS NOT NULL
    `).all() as Array<{ id: string }>;

    let compressedCount = 0;
    let totalOriginal = 0;
    let totalCompressed = 0;

    for (const session of sessions) {
      const count = this.db.prepare(`
        SELECT COUNT(*) as count FROM working_memory WHERE session_id = ?
      `).get(session.id) as { count: number };

      const processed = this.db.prepare(`
        SELECT COUNT(*) as count FROM working_memory WHERE session_id = ? AND is_processed = 1
      `).get(session.id) as { count: number };

      totalOriginal += count.count;
      totalCompressed += count.count - processed.count;

      if (processed.count > 0) {
        compressedCount++;
      }
    }

    return {
      totalSessions: sessions.length,
      compressedSessions: compressedCount,
      avgCompressionRatio: totalOriginal > 0 ? totalCompressed / totalOriginal : 0,
    };
  }
}