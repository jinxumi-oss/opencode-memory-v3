import type Database from 'better-sqlite3';
import type { MemoryType } from '../types/index.js';
import crypto from 'crypto';

interface ClassificationResult {
  type: MemoryType;
  confidence: number;
  keywords: string[];
  tags: string[];
}

export class NLPService {
  private db: Database.Database;
  private apiKey: string | null;
  private baseUrl: string;

  constructor(db: Database.Database, apiKey?: string, baseUrl?: string) {
    this.db = db;
    this.apiKey = apiKey || process.env.OPENAI_API_KEY || null;
    this.baseUrl = baseUrl || 'https://api.openai.com/v1';
  }

  async classifyWithLLM(content: string): Promise<ClassificationResult> {
    if (!this.apiKey) {
      return this.classifyWithRules(content);
    }

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: `分类记忆内容。返回 JSON: {"type": "decision|pattern|preference|note|context|learning", "confidence": 0.0-1.0, "keywords": [], "tags": []}`,
            },
            {
              role: 'user',
              content: content.slice(0, 500),
            },
          ],
          temperature: 0.3,
          max_tokens: 100,
        }),
      });

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      const result = JSON.parse(data.choices?.[0]?.message?.content || '{}');
      
      return {
        type: result.type || 'note',
        confidence: result.confidence || 0.5,
        keywords: result.keywords || [],
        tags: result.tags || [],
      };
    } catch {
      return this.classifyWithRules(content);
    }
  }

  classifyWithRules(content: string): ClassificationResult {
    const rules = [
      {
        patterns: [/决策|决定|选择|选用|采用/],
        type: 'decision' as MemoryType,
        keywords: ['决策', '决定', '选择'],
      },
      {
        patterns: [/规则|流程|规范|模式|惯例/],
        type: 'pattern' as MemoryType,
        keywords: ['规则', '流程', '规范'],
      },
      {
        patterns: [/偏好|喜欢|习惯|倾向/],
        type: 'preference' as MemoryType,
        keywords: ['偏好', '喜欢', '习惯'],
      },
      {
        patterns: [/学习|掌握|理解|总结/],
        type: 'learning' as MemoryType,
        keywords: ['学习', '掌握', '理解'],
      },
      {
        patterns: [/上下文|背景|环境|场景/],
        type: 'context' as MemoryType,
        keywords: ['上下文', '背景', '环境'],
      },
    ];

    for (const rule of rules) {
      for (const pattern of rule.patterns) {
        if (pattern.test(content)) {
          return {
            type: rule.type,
            confidence: 0.8,
            keywords: rule.keywords,
            tags: this.extractTags(content),
          };
        }
      }
    }

    return {
      type: 'note',
      confidence: 0.6,
      keywords: [],
      tags: this.extractTags(content),
    };
  }

  private extractTags(content: string): string[] {
    const tagPatterns = [
      { pattern: /#(\w+)/g, prefix: '' },
      { pattern: /\[([^\]]+)\]/g, prefix: '' },
      { pattern: /(React|Vue|Angular|TypeScript|Python|Go|Rust|Docker|Kubernetes)/gi, prefix: 'tech:' },
    ];

    const tags: Set<string> = new Set();

    for (const { pattern, prefix } of tagPatterns) {
      let match: RegExpExecArray | null;
      const regex = new RegExp(pattern.source, pattern.flags);
      
      while ((match = regex.exec(content)) !== null) {
        const tag = match[1] || match[0];
        tags.add(prefix ? `${prefix}${tag}` : tag);
      }
    }

    return Array.from(tags).slice(0, 5);
  }

  async batchClassify(limit: number = 50): Promise<{ processed: number; updated: number }> {
    const memories = this.db.prepare(`
      SELECT id, content FROM memories 
      WHERE type = 'note' AND source = 'migration'
      LIMIT ?
    `).all(limit) as Array<{ id: string; content: string }>;

    let updated = 0;

    for (const mem of memories) {
      const classification = await this.classifyWithLLM(mem.content);
      
      if (classification.type !== 'note' && classification.confidence > 0.7) {
        this.db.prepare(`
          UPDATE memories SET type = ?, tags = ? WHERE id = ?
        `).run(
          classification.type,
          classification.tags.join(','),
          mem.id
        );
        updated++;
      }
    }

    return { processed: memories.length, updated };
  }

  async summarizeContent(contents: string[]): Promise<string> {
    if (!this.apiKey || contents.length === 0) {
      return this.simpleSummarize(contents);
    }

    try {
      const combinedContent = contents.join('\n\n---\n\n').slice(0, 3000);
      
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: 'gpt-3.5-turbo',
          messages: [
            {
              role: 'system',
              content: '总结以下内容，保留关键信息，使用简洁的要点形式。中文回复。',
            },
            {
              role: 'user',
              content: combinedContent,
            },
          ],
          temperature: 0.3,
          max_tokens: 500,
        }),
      });

      const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
      return data.choices?.[0]?.message?.content || this.simpleSummarize(contents);
    } catch {
      return this.simpleSummarize(contents);
    }
  }

  private simpleSummarize(contents: string[]): string {
    const keywords = new Set<string>();
    
    for (const c of contents) {
      const words = c.match(/[\u4e00-\u9fa5]+|[a-zA-Z]+/g) || [];
      for (const word of words) {
        if (word.length >= 2 && word.length <= 10) {
          keywords.add(word);
        }
      }
    }

    const topKeywords = Array.from(keywords).slice(0, 10);
    return `关键词: ${topKeywords.join(', ')}`;
  }

  generateContentHash(content: string): string {
    return crypto.createHash('sha256').update(content.trim()).digest('hex').slice(0, 16);
  }
}