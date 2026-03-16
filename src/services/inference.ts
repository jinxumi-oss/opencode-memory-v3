import type Database from 'better-sqlite3';
import type { KnowledgeRelation } from '../types/index.js';
import type { KnowledgeGraphService } from './knowledge-graph.js';

interface InferenceResult {
  sourceId: string;
  targetId: string;
  relation: KnowledgeRelation;
  confidence: number;
  reason: string;
}

interface Recommendation {
  nodeId: string;
  nodeName: string;
  score: number;
  reason: string;
}

interface GraphStats {
  nodes: number;
  edges: number;
  avgConnectivity: number;
  topEntities: Array<{ name: string; count: number }>;
}

export class InferenceService {
  private db: Database.Database;
  private graphService: KnowledgeGraphService;

  constructor(db: Database.Database, graphService: KnowledgeGraphService) {
    this.db = db;
    this.graphService = graphService;
  }

  inferRelations(): InferenceResult[] {
    const inferences: InferenceResult[] = [];
    
    const transitiveInferences = this.inferTransitiveRelations();
    inferences.push(...transitiveInferences);

    const semanticInferences = this.inferSemanticRelations();
    inferences.push(...semanticInferences);

    return inferences;
  }

  private inferTransitiveRelations(): InferenceResult[] {
    const inferences: InferenceResult[] = [];

    const chains = this.db.prepare(`
      SELECT 
        e1.source_id as a,
        e1.target_id as b,
        e2.target_id as c,
        e1.relation as r1,
        e2.relation as r2
      FROM knowledge_edges e1
      JOIN knowledge_edges e2 ON e1.target_id = e2.source_id
      WHERE e1.source_id != e2.target_id
    `).all() as Array<{
      a: string;
      b: string;
      c: string;
      r1: string;
      r2: string;
    }>;

    const transitivityRules: Array<{
      condition: [string, string];
      result: KnowledgeRelation;
      confidence: number;
    }> = [
      { condition: ['causes', 'causes'], result: 'causes', confidence: 0.7 },
      { condition: ['enables', 'enables'], result: 'enables', confidence: 0.7 },
      { condition: ['depends_on', 'depends_on'], result: 'depends_on', confidence: 0.6 },
      { condition: ['depends_on', 'enables'], result: 'relates_to', confidence: 0.5 },
      { condition: ['causes', 'enables'], result: 'relates_to', confidence: 0.5 },
    ];

    for (const chain of chains) {
      for (const rule of transitivityRules) {
        if (chain.r1 === rule.condition[0] && chain.r2 === rule.condition[1]) {
          const existing = this.db.prepare(`
            SELECT id FROM knowledge_edges 
            WHERE source_id = ? AND target_id = ? AND relation = ?
          `).get(chain.a, chain.c, rule.result);

          if (!existing) {
            inferences.push({
              sourceId: chain.a,
              targetId: chain.c,
              relation: rule.result,
              confidence: rule.confidence,
              reason: `传递推理: ${chain.r1} → ${chain.r2}`,
            });
          }
        }
      }
    }

    return inferences;
  }

  private inferSemanticRelations(): InferenceResult[] {
    const inferences: InferenceResult[] = [];

    const nodes = this.db.prepare(`
      SELECT id, name, type FROM knowledge_nodes
    `).all() as Array<{ id: string; name: string; type: string }>;

    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const nodeA = nodes[i];
        const nodeB = nodes[j];
        
        if (!nodeA || !nodeB) continue;

        const existingRelation = this.db.prepare(`
          SELECT id FROM knowledge_edges 
          WHERE (source_id = ? AND target_id = ?) OR (source_id = ? AND target_id = ?)
        `).get(nodeA.id, nodeB.id, nodeB.id, nodeA.id);

        if (!existingRelation) {
          const inference = this.inferByNameSimilarity(nodeA, nodeB);
          if (inference) {
            inferences.push(inference);
          }
        }
      }
    }

    return inferences;
  }

  private inferByNameSimilarity(
    nodeA: { id: string; name: string; type: string },
    nodeB: { id: string; name: string; type: string }
  ): InferenceResult | null {
    const nameA = nodeA.name.toLowerCase();
    const nameB = nodeB.name.toLowerCase();

    if (nameA.includes(nameB) || nameB.includes(nameA)) {
      return {
        sourceId: nodeA.id,
        targetId: nodeB.id,
        relation: 'relates_to',
        confidence: 0.5,
        reason: `名称相似: "${nodeA.name}" 和 "${nodeB.name}"`,
      };
    }

    const techStacks: Record<string, string[]> = {
      frontend: ['react', 'vue', 'angular', 'next', 'svelte', 'typescript', 'javascript'],
      backend: ['node', 'python', 'go', 'rust', 'java', 'kotlin'],
      database: ['postgresql', 'mongodb', 'redis', 'mysql', 'sqlite'],
      devops: ['docker', 'kubernetes', 'nginx', 'aws', 'azure', 'gcp'],
    };

    for (const [, members] of Object.entries(techStacks)) {
      if (members.some(m => nameA.includes(m)) && members.some(m => nameB.includes(m))) {
        return {
          sourceId: nodeA.id,
          targetId: nodeB.id,
          relation: 'relates_to',
          confidence: 0.6,
          reason: `同领域技术栈`,
        };
      }
    }

    return null;
  }

  applyInferences(inferences: InferenceResult[]): number {
    let applied = 0;

    for (const inf of inferences) {
      try {
        this.graphService.createEdge({
          id: `ke_inf_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          sourceId: inf.sourceId,
          targetId: inf.targetId,
          relation: inf.relation,
          weight: inf.confidence,
        });
        applied++;
      } catch {
        // Skip if edge already exists
      }
    }

    return applied;
  }

  getRecommendations(nodeId: string, limit: number = 5): Recommendation[] {
    const recommendations: Recommendation[] = [];

    const directConnections = this.db.prepare(`
      SELECT target_id FROM knowledge_edges WHERE source_id = ?
      UNION
      SELECT source_id FROM knowledge_edges WHERE target_id = ?
    `).all(nodeId, nodeId) as Array<{ target_id: string }>;

    const directSet = new Set(directConnections.map(d => d.target_id));
    directSet.add(nodeId);

    const secondDegree = this.db.prepare(`
      SELECT DISTINCT
        e2.target_id as node_id,
        n.name as node_name,
        COUNT(*) as path_count
      FROM knowledge_edges e1
      JOIN knowledge_edges e2 ON e1.target_id = e2.source_id
      JOIN knowledge_nodes n ON e2.target_id = n.id
      WHERE e1.source_id = ? AND e2.target_id != ?
      GROUP BY e2.target_id
      ORDER BY path_count DESC
      LIMIT ?
    `).all(nodeId, nodeId, limit * 2) as Array<{
      node_id: string;
      node_name: string;
      path_count: number;
    }>;

    for (const conn of secondDegree) {
      if (!directSet.has(conn.node_id)) {
        recommendations.push({
          nodeId: conn.node_id,
          nodeName: conn.node_name,
          score: Math.min(0.8, 0.3 + conn.path_count * 0.1),
          reason: `通过 ${conn.path_count} 条路径关联`,
        });
      }
    }

    const byType = this.db.prepare(`
      SELECT n.id, n.name, n.type, COUNT(*) as shared_count
      FROM knowledge_nodes n
      JOIN knowledge_edges e ON n.id = e.target_id OR n.id = e.source_id
      WHERE n.type = (SELECT type FROM knowledge_nodes WHERE id = ?)
        AND n.id != ?
        AND n.id NOT IN (
          SELECT target_id FROM knowledge_edges WHERE source_id = ?
          UNION
          SELECT source_id FROM knowledge_edges WHERE target_id = ?
        )
      GROUP BY n.id
      ORDER BY shared_count DESC
      LIMIT ?
    `).all(nodeId, nodeId, nodeId, nodeId, limit) as Array<{
      id: string;
      name: string;
      type: string;
      shared_count: number;
    }>;

    for (const node of byType) {
      if (!recommendations.find(r => r.nodeId === node.id)) {
        recommendations.push({
          nodeId: node.id,
          nodeName: node.name,
          score: 0.4,
          reason: `同类型节点`,
        });
      }
    }

    return recommendations
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  getRelatedMemories(memoryId: string, limit: number = 5): Array<{ memoryId: string; content: string; score: number }> {
    const node = this.db.prepare(`
      SELECT id FROM knowledge_nodes WHERE memory_id = ?
    `).get(memoryId) as { id: string } | undefined;

    if (!node) return [];

    const recommendations = this.getRecommendations(node.id, limit);

    const relatedMemories: Array<{ memoryId: string; content: string; score: number }> = [];

    for (const rec of recommendations) {
      const mem = this.db.prepare(`
        SELECT id, substr(content, 1, 200) as content
        FROM memories
        WHERE id = (SELECT memory_id FROM knowledge_nodes WHERE id = ?)
      `).get(rec.nodeId) as { id: string; content: string } | undefined;

      if (mem) {
        relatedMemories.push({
          memoryId: mem.id,
          content: mem.content,
          score: rec.score,
        });
      }
    }

    return relatedMemories;
  }

  getStats(): GraphStats {
    const nodes = this.db.prepare(`SELECT COUNT(*) as count FROM knowledge_nodes`).get() as { count: number };
    const edges = this.db.prepare(`SELECT COUNT(*) as count FROM knowledge_edges`).get() as { count: number };

    const avgConn = this.db.prepare(`
      SELECT AVG(connection_count) as avg FROM knowledge_nodes
    `).get() as { avg: number };

    const topEntities = this.db.prepare(`
      SELECT name, connection_count as count
      FROM knowledge_nodes
      ORDER BY connection_count DESC
      LIMIT 10
    `).all() as Array<{ name: string; count: number }>;

    return {
      nodes: nodes.count,
      edges: edges.count,
      avgConnectivity: avgConn.avg || 0,
      topEntities,
    };
  }
}