import type Database from 'better-sqlite3';
import type { KnowledgeNodeType, KnowledgeRelation } from '../types/index.js';
import type { KnowledgeGraphService } from './knowledge-graph.js';

interface Entity {
  text: string;
  type: KnowledgeNodeType;
  start: number;
  end: number;
  confidence: number;
}

interface Relation {
  source: string;
  target: string;
  relation: KnowledgeRelation;
  confidence: number;
}

interface ExtractionResult {
  entities: Entity[];
  relations: Relation[];
}

const ENTITY_PATTERNS: Array<{
  type: KnowledgeNodeType;
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
      /\b(架构|设计模式|微服务|单体|分布式)\b/g,
      /\b(测试|CI\/CD|部署|监控|日志)\b/g,
      /\b(性能|优化|缓存|负载均衡)\b/g,
      /\b(安全|认证|授权|加密)\b/g,
      /\b(记忆|向量|嵌入|检索|BM25)\b/g,
    ],
    keywords: [],
  },
  {
    type: 'decision',
    patterns: [
      /决策[：:]\s*(.+)/g,
      /决定(采用|使用|选择)[：:]?\s*(.+)/g,
      /选用\s+(.+)/g,
      /最终选择\s+(.+)/g,
    ],
    keywords: ['决策', '决定', '选择', '选用', '采用'],
  },
  {
    type: 'pattern',
    patterns: [
      /规则[：:]\s*(.+)/g,
      /流程[：:]\s*(.+)/g,
      /规范[：:]\s*(.+)/g,
      /模式[：:]\s*(.+)/g,
    ],
    keywords: ['规则', '流程', '规范', '模式', '惯例'],
  },
];

const RELATION_PATTERNS: Array<{
  relation: KnowledgeRelation;
  patterns: RegExp[];
}> = [
  {
    relation: 'causes',
    patterns: [
      /(.+?)\s*(导致|引起|产生|触发)\s*(.+)/g,
      /因为\s*(.+?)\s*所以\s*(.+)/g,
    ],
  },
  {
    relation: 'enables',
    patterns: [
      /(.+?)\s*(支持|允许|使能|赋能)\s*(.+)/g,
      /(.+?)\s*可以\s*(.+)/g,
    ],
  },
  {
    relation: 'depends_on',
    patterns: [
      /(.+?)\s*(依赖|需要|基于)\s*(.+)/g,
      /(.+?)\s*基于\s*(.+)/g,
    ],
  },
  {
    relation: 'conflicts',
    patterns: [
      /(.+?)\s*(冲突|矛盾|排斥|不兼容)\s*(.+)/g,
      /(.+?)\s*与\s*(.+?)\s*(冲突|不兼容)/g,
    ],
  },
  {
    relation: 'relates_to',
    patterns: [
      /(.+?)\s*(相关|关联|有关)\s*(.+)/g,
      /(.+?)\s*与\s*(.+?)\s*(相关|类似)/g,
    ],
  },
];

export class NERService {
  private db: Database.Database;
  private graphService: KnowledgeGraphService;

  constructor(db: Database.Database, graphService: KnowledgeGraphService) {
    this.db = db;
    this.graphService = graphService;
  }

  extractEntities(text: string): Entity[] {
    const entities: Entity[] = [];
    const seen = new Set<string>();

    for (const { type, patterns, keywords } of ENTITY_PATTERNS) {
      for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        const regex = new RegExp(pattern.source, pattern.flags);
        
        while ((match = regex.exec(text)) !== null) {
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
        
        while ((match = keywordPattern.exec(text)) !== null) {
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

  extractRelations(text: string, entities: Entity[]): Relation[] {
    const relations: Relation[] = [];
    const entityMap = new Map<string, Entity>();
    
    for (const entity of entities) {
      entityMap.set(entity.text.toLowerCase(), entity);
    }

    for (const { relation, patterns } of RELATION_PATTERNS) {
      for (const pattern of patterns) {
        let match: RegExpExecArray | null;
        const regex = new RegExp(pattern.source, pattern.flags);
        
        while ((match = regex.exec(text)) !== null) {
          const sourceText = match[1]?.trim();
          const targetText = match[match.length - 1]?.trim();
          
          if (sourceText && targetText && sourceText !== targetText) {
            relations.push({
              source: sourceText,
              target: targetText,
              relation,
              confidence: 0.7,
            });
          }
        }
      }
    }

    return this.linkEntitiesToRelations(relations, entities);
  }

  private linkEntitiesToRelations(relations: Relation[], entities: Entity[]): Relation[] {
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
          relation: rel.relation,
          confidence: Math.min(rel.confidence, sourceEntity.confidence, targetEntity.confidence),
        });
      }
    }

    return linkedRelations;
  }

  extract(text: string): ExtractionResult {
    const entities = this.extractEntities(text);
    const relations = this.extractRelations(text, entities);
    
    return { entities, relations };
  }

  processAndStore(text: string, memoryId: string): { entitiesCreated: number; relationsCreated: number } {
    const { entities, relations } = this.extract(text);
    
    const entityIdMap = new Map<string, string>();
    let entitiesCreated = 0;

    for (const entity of entities) {
      const existingNode = this.db.prepare(`
        SELECT id FROM knowledge_nodes WHERE name = ? AND type = ?
      `).get(entity.text, entity.type);

      if (existingNode) {
        entityIdMap.set(entity.text, (existingNode as { id: string }).id);
        this.db.prepare(`
          UPDATE knowledge_nodes SET connection_count = connection_count + 1 WHERE id = ?
        `).run((existingNode as { id: string }).id);
      } else {
        const nodeId = this.graphService.createNode({
          id: `kn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          type: entity.type,
          name: entity.text,
          description: `从记忆 ${memoryId} 中提取`,
          memoryId,
        });
        entityIdMap.set(entity.text, nodeId.id);
        entitiesCreated++;
      }
    }

    let relationsCreated = 0;

    for (const rel of relations) {
      const sourceId = entityIdMap.get(rel.source);
      const targetId = entityIdMap.get(rel.target);

      if (sourceId && targetId) {
        const existingEdge = this.db.prepare(`
          SELECT id FROM knowledge_edges 
          WHERE source_id = ? AND target_id = ? AND relation = ?
        `).get(sourceId, targetId, rel.relation);

        if (!existingEdge) {
          this.graphService.createEdge({
            id: `ke_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
            sourceId,
            targetId,
            relation: rel.relation,
            weight: rel.confidence,
          });
          relationsCreated++;
        }
      }
    }

    return { entitiesCreated, relationsCreated };
  }

  batchProcess(memoryLimit: number = 100): { processed: number; entities: number; relations: number } {
    const memories = this.db.prepare(`
      SELECT id, content FROM memories 
      WHERE id NOT IN (SELECT DISTINCT memory_id FROM knowledge_nodes WHERE memory_id IS NOT NULL)
      LIMIT ?
    `).all(memoryLimit) as Array<{ id: string; content: string }>;

    let totalEntities = 0;
    let totalRelations = 0;

    for (const mem of memories) {
      const result = this.processAndStore(mem.content, mem.id);
      totalEntities += result.entitiesCreated;
      totalRelations += result.relationsCreated;
    }

    return {
      processed: memories.length,
      entities: totalEntities,
      relations: totalRelations,
    };
  }

  getStats(): { totalEntities: number; totalRelations: number; byType: Record<string, number> } {
    const entities = this.db.prepare(`SELECT COUNT(*) as count FROM knowledge_nodes`).get() as { count: number };
    const relations = this.db.prepare(`SELECT COUNT(*) as count FROM knowledge_edges`).get() as { count: number };
    
    const byType = this.db.prepare(`
      SELECT type, COUNT(*) as count FROM knowledge_nodes GROUP BY type
    `).all() as Array<{ type: string; count: number }>;

    return {
      totalEntities: entities.count,
      totalRelations: relations.count,
      byType: Object.fromEntries(byType.map(r => [r.type, r.count])),
    };
  }
}