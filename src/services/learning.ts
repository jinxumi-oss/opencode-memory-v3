import type Database from 'better-sqlite3';
import type { LearningRule, LearningEvent } from '../types/index.js';

interface PatternMatch {
  pattern: string;
  count: number;
  examples: string[];
  type: 'preference' | 'workflow' | 'pattern';
}

export class LearningService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  analyzeAndLearn(): { rulesCreated: number; patternsFound: number } {
    const memories = this.db.prepare(`
      SELECT id, type, content, tags FROM memories 
      WHERE type IN ('decision', 'pattern', 'preference')
      ORDER BY created_at DESC
    `).all() as Array<{ id: string; type: string; content: string; tags: string | null }>;

    const patterns = this.extractPatterns(memories);
    
    let rulesCreated = 0;
    
    for (const pattern of patterns) {
      if (pattern.count >= 2) {
        const created = this.createLearningRule(pattern);
        if (created) rulesCreated++;
      }
    }

    this.updateUserProfile();

    return {
      rulesCreated,
      patternsFound: patterns.length,
    };
  }

  private extractPatterns(memories: Array<{ id: string; type: string; content: string; tags: string | null }>): PatternMatch[] {
    const patterns: Map<string, PatternMatch> = new Map();

    const preferencePatterns = [
      { regex: /偏好|喜欢|习惯|倾向/g, type: 'preference' as const },
      { regex: /使用|采用|选择|选用/g, type: 'workflow' as const },
      { regex: /禁止|不要|避免/g, type: 'pattern' as const },
    ];

    for (const mem of memories) {
      for (const { regex, type } of preferencePatterns) {
        const matches = mem.content.match(regex);
        if (matches) {
          const key = `${type}:${matches[0]}`;
          const existing = patterns.get(key);
          if (existing) {
            existing.count++;
            if (existing.examples.length < 5) {
              existing.examples.push(mem.content.slice(0, 100));
            }
          } else {
            patterns.set(key, {
              pattern: matches[0],
              count: 1,
              examples: [mem.content.slice(0, 100)],
              type,
            });
          }
        }
      }

      if (mem.type === 'decision') {
        const key = `workflow:决策`;
        const existing = patterns.get(key);
        if (existing) {
          existing.count++;
          if (existing.examples.length < 5) {
            existing.examples.push(mem.content.slice(0, 100));
          }
        } else {
          patterns.set(key, {
            pattern: '决策',
            count: 1,
            examples: [mem.content.slice(0, 100)],
            type: 'workflow',
          });
        }
      }

      if (mem.type === 'pattern') {
        const key = `workflow:模式`;
        const existing = patterns.get(key);
        if (existing) {
          existing.count++;
          if (existing.examples.length < 5) {
            existing.examples.push(mem.content.slice(0, 100));
          }
        } else {
          patterns.set(key, {
            pattern: '模式',
            count: 1,
            examples: [mem.content.slice(0, 100)],
            type: 'workflow',
          });
        }
      }
    }

    return Array.from(patterns.values());
  }

  private createLearningRule(pattern: PatternMatch): boolean {
    const existingRule = this.db.prepare(`
      SELECT id FROM learning_rules WHERE pattern = ?
    `).get(pattern.pattern);

    if (existingRule) {
      this.db.prepare(`
        UPDATE learning_rules 
        SET occurrence_count = occurrence_count + 1, 
            confidence = MIN(1.0, confidence + 0.1)
        WHERE pattern = ?
      `).run(pattern.pattern);
      return false;
    }

    const id = `lr_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const action = this.inferAction(pattern);
    const confidence = Math.min(0.5 + pattern.count * 0.1, 1.0);

    this.db.prepare(`
      INSERT INTO learning_rules (id, rule_type, pattern, action, confidence, occurrence_count, created_at, is_active)
      VALUES (?, ?, ?, ?, ?, 1, datetime('now'), 1)
    `).run(id, pattern.type, pattern.pattern, action, confidence);

    this.recordLearningEvent('rule_created', {
      ruleId: id,
      pattern: pattern.pattern,
      type: pattern.type,
      examples: pattern.examples.slice(0, 3),
    });

    return true;
  }

  private inferAction(pattern: PatternMatch): string {
    switch (pattern.type) {
      case 'preference':
        return `记住用户偏好: ${pattern.pattern}`;
      case 'workflow':
        return `遵循工作流程: ${pattern.pattern}`;
      case 'pattern':
        return `注意行为模式: ${pattern.pattern}`;
      default:
        return `记录模式: ${pattern.pattern}`;
    }
  }

  private recordLearningEvent(eventType: LearningEvent['eventType'], details: Record<string, unknown>): void {
    const id = `le_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    this.db.prepare(`
      INSERT INTO learning_events (id, event_type, details, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `).run(id, eventType, JSON.stringify(details));
  }

  private updateUserProfile(): void {
    const stats = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM memories GROUP BY type
    `).all() as Array<{ type: string; count: number }>;

    for (const stat of stats) {
      this.db.prepare(`
        INSERT INTO user_profile (key, value, confidence, source, updated_at)
        VALUES ('memory_type_' || ?, ?, 1.0, 'inferred', datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(stat.type, stat.count.toString());
    }

    const tags = this.db.prepare(`
      SELECT tags, COUNT(*) as count 
      FROM memories 
      WHERE tags IS NOT NULL AND tags != ''
      GROUP BY tags 
      ORDER BY count DESC 
      LIMIT 5
    `).all() as Array<{ tags: string; count: number }>;

    if (tags.length > 0) {
      const topTags = tags.map(t => t.tags).join(', ');
      this.db.prepare(`
        INSERT INTO user_profile (key, value, confidence, source, updated_at)
        VALUES ('top_tags', ?, 0.8, 'inferred', datetime('now'))
        ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(topTags);
    }
  }

  getActiveRules(): LearningRule[] {
    const rows = this.db.prepare(`
      SELECT * FROM learning_rules WHERE is_active = 1 ORDER BY confidence DESC
    `).all() as Record<string, unknown>[];

    return rows.map(row => this.rowToRule(row));
  }

  matchRules(content: string): LearningRule[] {
    const allRules = this.getActiveRules();
    const matched: LearningRule[] = [];

    for (const rule of allRules) {
      if (content.includes(rule.pattern)) {
        matched.push(rule);
        
        this.db.prepare(`
          UPDATE learning_rules 
          SET last_triggered = datetime('now'), occurrence_count = occurrence_count + 1
          WHERE id = ?
        `).run(rule.id);
      }
    }

    if (matched.length > 0) {
      this.recordLearningEvent('pattern_detected', {
        matchedRules: matched.map(r => r.id),
        contentSnippet: content.slice(0, 100),
      });
    }

    return matched;
  }

  getStats(): { totalRules: number; activeRules: number; avgConfidence: number; byType: Record<string, number> } {
    const total = this.db.prepare(`SELECT COUNT(*) as count FROM learning_rules`).get() as { count: number };
    const active = this.db.prepare(`SELECT COUNT(*) as count FROM learning_rules WHERE is_active = 1`).get() as { count: number };
    const avgConf = this.db.prepare(`SELECT AVG(confidence) as avg FROM learning_rules`).get() as { avg: number | null };

    const byType = this.db.prepare(`
      SELECT rule_type, COUNT(*) as count FROM learning_rules GROUP BY rule_type
    `).all() as Array<{ rule_type: string; count: number }>;

    return {
      totalRules: total.count,
      activeRules: active.count,
      avgConfidence: avgConf.avg || 0,
      byType: Object.fromEntries(byType.map(r => [r.rule_type, r.count])),
    };
  }

  private rowToRule(row: Record<string, unknown>): LearningRule {
    return {
      id: row.id as string,
      ruleType: row.rule_type as LearningRule['ruleType'],
      pattern: row.pattern as string,
      action: row.action as string,
      confidence: row.confidence as number,
      occurrenceCount: row.occurrence_count as number,
      lastTriggered: row.last_triggered as string | null,
      createdAt: row.created_at as string,
      isActive: Boolean(row.is_active),
    };
  }
}