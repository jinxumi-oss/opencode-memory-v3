import type Database from 'better-sqlite3';

export type EntityType = 'entity' | 'concept' | 'decision' | 'pattern';

export interface Entity {
  id?: string;
  text: string;
  type: EntityType;
  start?: number;
  end?: number;
  confidence: number;
  metadata?: Record<string, unknown>;
}

export interface Relation {
  source: string;
  target: string;
  type: RelationType;
  confidence: number;
}

export type RelationType = 'causes' | 'enables' | 'depends_on' | 'conflicts' | 'relates_to';

const ENTITY_PATTERNS: Array<{
  type: EntityType;
  patterns: RegExp[];
  keywords: string[];
}> = [
  {
    type: 'entity',
    patterns: [
      /\b(React|Vue|Angular|Next\.js|Nuxt|Svelte|Solid)\b/gi,
      /\b(TypeScript|JavaScript|Python|Go|Rust|Java|Kotlin|Swift)\b/gi,
      /\b(Docker|Kubernetes|nginx|Redis|PostgreSQL|MongoDB)\b/gi,
      /\b(GitHub|GitLab|Bitbucket|VSCode|IntelliJ)\b/gi,
      /\b(OpenAI|Anthropic|Claude|GPT|LLM)\b/gi,
      /\b(AWS|Azure|GCP|Vercel|Netlify)\b/gi,
    ],
    keywords: ['框架', '语言', '工具', '平台', 'API', 'SDK'],
  },
  {
    type: 'concept',
    patterns: [
      /\b(架构 | 设计模式 | 微服务 | 单体 | 分布式)\b/g,
      /\b(测试|CI\/CD|部署 | 监控 | 日志)\b/g,
      /\b(性能 | 优化 | 缓存 | 负载均衡)\b/g,
      /\b(安全 | 认证 | 授权 | 加密)\b/g,
      /\b(记忆 | 向量 | 嵌入 | 检索|BM25)\b/g,
    ],
    keywords: [],
  },
  {
    type: 'decision',
    patterns: [
      /决策 [：:]\s*(.+)/g,
      /决定 (采用 | 使用 | 选择)[：:]?\s*(.+)/g,
      /选用\s+(.+)/g,
      /最终选择\s+(.+)/g,
    ],
    keywords: ['决策', '决定', '选择', '选用', '采用'],
  },
  {
    type: 'pattern',
    patterns: [
      /规则 [：:]\s*(.+)/g,
      /流程 [：:]\s*(.+)/g,
      /规范 [：:]\s*(.+)/g,
      /模式 [：:]\s*(.+)/g,
    ],
    keywords: ['规则', '流程', '规范', '模式', '惯例'],
  },
];

const RELATION_PATTERNS: Array<{
  type: RelationType;
  patterns: RegExp[];
}> = [
  {
    type: 'causes',
    patterns: [
      /(.+?)\s*(导致 | 引起 | 产生 | 触发)\s*(.+)/g,
      /因为\s*(.+?)\s*所以\s*(.+)/g,
    ],
  },
  {
    type: 'enables',
    patterns: [
      /(.+?)\s*(支持 | 允许 | 使能 | 赋能)\s*(.+)/g,
      /(.+?)\s*可以\s*(.+)/g,
    ],
  },
  {
    type: 'depends_on',
    patterns: [
      /(.+?)\s*(依赖 | 需要 | 基于)\s*(.+)/g,
      /(.+?)\s*基于\s*(.+)/g,
    ],
  },
  {
    type: 'conflicts',
    patterns: [
      /(.+?)\s*(冲突 | 矛盾 | 排斥 | 不兼容)\s*(.+)/g,
      /(.+?)\s*与\s*(.+?)\s*(冲突 | 不兼容)/g,
    ],
  },
  {
    type: 'relates_to',
    patterns: [
      /(.+?)\s*(相关 | 关联 | 有关)\s*(.+)/g,
      /(.+?)\s*与\s*(.+?)\s*(相关 | 类似)/g,
    ],
  },
];

export function extractEntities(content: string): Entity[] {
  const entities: Entity[] = [];
  const seen = new Set<string>();

  for (const { type, patterns, keywords } of ENTITY_PATTERNS) {
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      const regex = new RegExp(pattern.source, pattern.flags);

      while ((match = regex.exec(content)) !== null) {
        const entityText = match[0];
        const key = `${type}:${entityText.toLowerCase()}`;

        if (!seen.has(key) && entityText.length > 1) {
          seen.add(key);
          entities.push({
            text: entityText,
            type,
            start: match.index,
            end: match.index + entityText.length,
            confidence: 0.8,
          });
        }
      }
    }

    for (const keyword of keywords) {
      const keywordPattern = new RegExp(keyword, 'g');
      let match: RegExpExecArray | null;

      while ((match = keywordPattern.exec(content)) !== null) {
        const key = `${type}:${keyword}`;

        if (!seen.has(key)) {
          seen.add(key);
          entities.push({
            text: keyword,
            type: 'concept',
            start: match.index,
            end: match.index + keyword.length,
            confidence: 0.6,
          });
        }
      }
    }
  }

  return entities;
}

export function extractRelations(content: string, entities: Entity[]): Relation[] {
  const relations: Relation[] = [];
  const entityMap = new Map<string, Entity>();

  for (const entity of entities) {
    entityMap.set(entity.text.toLowerCase(), entity);
  }

  for (const { type, patterns } of RELATION_PATTERNS) {
    for (const pattern of patterns) {
      let match: RegExpExecArray | null;
      const regex = new RegExp(pattern.source, pattern.flags);

      while ((match = regex.exec(content)) !== null) {
        const sourceText = match[1]?.trim();
        const targetText = match[match.length - 1]?.trim();

        if (sourceText && targetText && sourceText !== targetText) {
          relations.push({
            source: sourceText,
            target: targetText,
            type,
            confidence: 0.7,
          });
        }
      }
    }
  }

  return linkEntitiesToRelations(relations, entities);
}

function linkEntitiesToRelations(relations: Relation[], entities: Entity[]): Relation[] {
  const linkedRelations: Relation[] = [];

  for (const rel of relations) {
    const sourceEntity = entities.find(
      e => e.text.toLowerCase().includes(rel.source.toLowerCase()) ||
           rel.source.toLowerCase().includes(e.text.toLowerCase())
    );

    const targetEntity = entities.find(
      e => e.text.toLowerCase().includes(rel.target.toLowerCase()) ||
           rel.target.toLowerCase().includes(e.text.toLowerCase())
    );

    if (sourceEntity && targetEntity && sourceEntity.text !== targetEntity.text) {
      linkedRelations.push({
        source: sourceEntity.text,
        target: targetEntity.text,
        type: rel.type,
        confidence: Math.min(rel.confidence, sourceEntity.confidence, targetEntity.confidence),
      });
    }
  }

  return linkedRelations;
}

export function extractAll(content: string): { entities: Entity[]; relations: Relation[] } {
  const entities = extractEntities(content);
  const relations = extractRelations(content, entities);

  return { entities, relations };
}

export class NERService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  process(content: string, memoryId?: string): { entities: Entity[]; relations: Relation[] } {
    const { entities, relations } = extractAll(content);

    if (memoryId) {
      this.storeEntities(entities, memoryId);
      this.storeRelations(relations, entities);
    }

    return { entities, relations };
  }

  private storeEntities(entities: Entity[], memoryId: string): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO entities (id, name, entity_type, memory_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();

    for (const entity of entities) {
      const id = `ent_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      stmt.run(id, entity.text, entity.type, memoryId, now);
    }
  }

  private storeRelations(relations: Relation[], entities: Entity[]): void {
    const entityTextMap = new Map<string, string>();

    for (const entity of entities) {
      const row = this.db.prepare('SELECT id FROM entities WHERE name = ? AND entity_type = ?')
        .get(entity.text, entity.type) as { id: string } | undefined;
      if (row) {
        entityTextMap.set(entity.text.toLowerCase(), row.id);
      }
    }

    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO relations (id, source_id, target_id, relation_type, weight, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const now = new Date().toISOString();

    for (const rel of relations) {
      const sourceId = entityTextMap.get(rel.source.toLowerCase());
      const targetId = entityTextMap.get(rel.target.toLowerCase());

      if (sourceId && targetId) {
        const id = `rel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        stmt.run(id, sourceId, targetId, rel.type, rel.confidence, now);
      }
    }
  }

  getStats(): { totalEntities: number; totalRelations: number; byType: Record<string, number> } {
    const entities = this.db.prepare('SELECT COUNT(*) as count FROM entities').get() as { count: number };
    const relations = this.db.prepare('SELECT COUNT(*) as count FROM relations').get() as { count: number };

    const byType = this.db.prepare(`
      SELECT entity_type, COUNT(*) as count FROM entities GROUP BY entity_type
    `).all() as Array<{ entity_type: string; count: number }>;

    return {
      totalEntities: entities.count,
      totalRelations: relations.count,
      byType: Object.fromEntries(byType.map(r => [r.entity_type, r.count])),
    };
  }
}
