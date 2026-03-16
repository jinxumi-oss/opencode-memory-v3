import type Database from 'better-sqlite3';
import type { KnowledgeNode, KnowledgeEdge, GraphQueryOptions } from '../types/index.js';

export interface GraphPath {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  depth: number;
}

export class KnowledgeGraphService {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  createNode(node: Omit<KnowledgeNode, 'createdAt' | 'centrality' | 'connectionCount'>): KnowledgeNode {
    const id = node.id || `kn_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const createdAt = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_nodes (id, type, name, description, memory_id, created_at, centrality, connection_count)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0)
    `);
    
    stmt.run(id, node.type, node.name, node.description || null, node.memoryId || null, createdAt);
    
    return {
      id,
      type: node.type,
      name: node.name,
      description: node.description || null,
      memoryId: node.memoryId || null,
      createdAt,
      centrality: 0,
      connectionCount: 0,
    };
  }

  createEdge(edge: Omit<KnowledgeEdge, 'createdAt'>): KnowledgeEdge {
    const id = edge.id || `ke_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const createdAt = new Date().toISOString();
    
    const stmt = this.db.prepare(`
      INSERT INTO knowledge_edges (id, source_id, target_id, relation, weight, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run(id, edge.sourceId, edge.targetId, edge.relation, edge.weight || 1.0, createdAt);
    
    this.updateConnectionCount(edge.sourceId);
    this.updateConnectionCount(edge.targetId);
    
    return {
      id,
      sourceId: edge.sourceId,
      targetId: edge.targetId,
      relation: edge.relation,
      weight: edge.weight || 1.0,
      createdAt,
    };
  }

  getNode(id: string): KnowledgeNode | null {
    const row = this.db.prepare(`
      SELECT * FROM knowledge_nodes WHERE id = ?
    `).get(id);
    
    return row ? this.rowToNode(row as Record<string, unknown>) : null;
  }

  getConnectedNodes(nodeId: string, relation?: string): Array<{ node: KnowledgeNode; edge: KnowledgeEdge }> {
    let sql = `
      SELECT n.*, e.id as edge_id, e.source_id, e.target_id, e.relation, e.weight, e.created_at as edge_created_at
      FROM knowledge_nodes n
      JOIN knowledge_edges e ON (n.id = e.target_id OR n.id = e.source_id)
      WHERE (e.source_id = ? OR e.target_id = ?) AND n.id != ?
    `;
    
    const params: (string | number)[] = [nodeId, nodeId, nodeId];
    
    if (relation) {
      sql += ' AND e.relation = ?';
      params.push(relation);
    }
    
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[];
    
    return rows.map(row => ({
      node: this.rowToNode(row),
      edge: {
        id: row.edge_id as string,
        sourceId: row.source_id as string,
        targetId: row.target_id as string,
        relation: row.relation as KnowledgeEdge['relation'],
        weight: row.weight as number,
        createdAt: row.edge_created_at as string,
      },
    }));
  }

  traverse(options: GraphQueryOptions): GraphPath[] {
    const visited = new Set<string>();
    const paths: GraphPath[] = [];
    
    this.traverseDFS(
      options.startNodeId,
      visited,
      [],
      [],
      0,
      options.maxDepth,
      options.minWeight,
      options.relation,
      paths
    );
    
    return paths;
  }

  private traverseDFS(
    currentNodeId: string,
    visited: Set<string>,
    currentNodes: KnowledgeNode[],
    currentEdges: KnowledgeEdge[],
    depth: number,
    maxDepth: number,
    minWeight: number,
    relationFilter?: string,
    paths: GraphPath[] = []
  ): void {
    if (depth > maxDepth) return;
    
    const node = this.getNode(currentNodeId);
    if (!node) return;
    
    const newNodes = [...currentNodes, node];
    
    if (depth > 0) {
      paths.push({
        nodes: newNodes,
        edges: currentEdges,
        depth,
      });
    }
    
    visited.add(currentNodeId);
    
    const connected = this.getConnectedNodes(currentNodeId, relationFilter);
    
    for (const { node: nextNode, edge } of connected) {
      if (!visited.has(nextNode.id) && edge.weight >= minWeight) {
        this.traverseDFS(
          nextNode.id,
          new Set(visited),
          newNodes,
          [...currentEdges, edge],
          depth + 1,
          maxDepth,
          minWeight,
          relationFilter,
          paths
        );
      }
    }
  }

  findShortestPath(startId: string, endId: string): GraphPath | null {
    const queue: Array<{ nodeId: string; nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }> = [
      { nodeId: startId, nodes: [], edges: [] }
    ];
    const visited = new Set<string>([startId]);
    
    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.getNode(current.nodeId);
      
      if (!node) continue;
      
      const newNodes = [...current.nodes, node];
      
      if (current.nodeId === endId) {
        return {
          nodes: newNodes,
          edges: current.edges,
          depth: newNodes.length - 1,
        };
      }
      
      const connected = this.getConnectedNodes(current.nodeId);
      
      for (const { node: nextNode, edge } of connected) {
        if (!visited.has(nextNode.id)) {
          visited.add(nextNode.id);
          queue.push({
            nodeId: nextNode.id,
            nodes: newNodes,
            edges: [...current.edges, edge],
          });
        }
      }
    }
    
    return null;
  }

  findRelatedMemories(memoryId: string, maxDepth: number = 2): Array<{ memoryId: string; path: GraphPath }> {
    const node = this.db.prepare(`
      SELECT * FROM knowledge_nodes WHERE memory_id = ?
    `).get(memoryId);
    
    if (!node) return [];
    
    const nodeData = node as Record<string, unknown>;
    const paths = this.traverse({
      startNodeId: nodeData.id as string,
      maxDepth,
      minWeight: 0.5,
    });
    
    return paths
      .filter(p => p.nodes.some(n => n.memoryId && n.memoryId !== memoryId))
      .map(p => ({
        memoryId: p.nodes.find(n => n.memoryId && n.memoryId !== memoryId)!.memoryId!,
        path: p,
      }));
  }

  calculateCentrality(): void {
    const nodes = this.db.prepare(`SELECT id FROM knowledge_nodes`).all() as Array<{ id: string }>;
    
    for (const { id } of nodes) {
      const connections = this.getConnectedNodes(id);
      const centrality = connections.length / (nodes.length - 1 || 1);
      
      this.db.prepare(`
        UPDATE knowledge_nodes SET centrality = ?, connection_count = ? WHERE id = ?
      `).run(centrality, connections.length, id);
    }
  }

  private updateConnectionCount(nodeId: string): void {
    this.db.prepare(`
      UPDATE knowledge_nodes 
      SET connection_count = (
        SELECT COUNT(*) FROM knowledge_edges 
        WHERE source_id = ? OR target_id = ?
      )
      WHERE id = ?
    `).run(nodeId, nodeId, nodeId);
  }

  private rowToNode(row: Record<string, unknown>): KnowledgeNode {
    return {
      id: row.id as string,
      type: row.type as KnowledgeNode['type'],
      name: row.name as string,
      description: row.description as string | null,
      memoryId: row.memory_id as string | null,
      createdAt: row.created_at as string,
      centrality: (row.centrality as number) || 0,
      connectionCount: (row.connection_count as number) || 0,
    };
  }
}