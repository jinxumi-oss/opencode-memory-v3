/**
 * OpenCode Memory System - Type Definitions
 * 
 * Three-layer architecture:
 * - L0: Working Memory (session context)
 * - L1: Long-term Memory (knowledge storage)
 * - L2: Learning Layer (pattern extraction)
 */

import { z } from 'zod';

// ============================================================================
// Base Types
// ============================================================================

export const MemoryTypeSchema = z.enum(['decision', 'pattern', 'preference', 'note', 'context', 'learning']);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

export const RoleSchema = z.enum(['user', 'assistant', 'system']);
export type Role = z.infer<typeof RoleSchema>;

export const SourceSchema = z.enum(['user', 'promoted', 'system', 'migration']);
export type Source = z.infer<typeof SourceSchema>;

export const KnowledgeNodeTypeSchema = z.enum(['concept', 'entity', 'decision', 'pattern']);
export type KnowledgeNodeType = z.infer<typeof KnowledgeNodeTypeSchema>;

export const KnowledgeRelationSchema = z.enum(['relates_to', 'causes', 'enables', 'conflicts', 'depends_on']);
export type KnowledgeRelation = z.infer<typeof KnowledgeRelationSchema>;

export const RecallMethodSchema = z.enum(['semantic', 'bm25', 'hybrid', 'contextual']);
export type RecallMethod = z.infer<typeof RecallMethodSchema>;

// ============================================================================
// L0: Working Memory / Session
// ============================================================================

export const SessionSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  contextSummary: z.string().nullable(),
  memoryCount: z.number().default(0),
});
export type Session = z.infer<typeof SessionSchema>;

export const WorkingMemorySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: RoleSchema,
  content: z.string(),
  tokens: z.number().default(0),
  createdAt: z.string(),
  importance: z.number().min(0).max(1).default(0.5),
  isProcessed: z.boolean().default(false),
});
export type WorkingMemory = z.infer<typeof WorkingMemorySchema>;

// ============================================================================
// L1: Long-term Memory
// ============================================================================

export const MemorySchema = z.object({
  id: z.string(),
  type: MemoryTypeSchema.default('note'),
  source: SourceSchema.default('user'),
  tags: z.array(z.string()).default([]),
  content: z.string(),
  contentHash: z.string(),
  createdAt: z.string(),
  updatedAt: z.string().nullable(),
  lastAccessed: z.string().nullable(),
  accessCount: z.number().default(0),
  weight: z.number().default(1.0),
  embedding: z.array(z.number()).nullable(),
  embeddingModel: z.string().nullable(),
});
export type Memory = z.infer<typeof MemorySchema>;

export const MemoryVersionSchema = z.object({
  id: z.string(),
  memoryId: z.string(),
  version: z.number(),
  content: z.string(),
  updatedAt: z.string(),
  updatedBy: z.enum(['user', 'system', 'auto']).nullable(),
  changeReason: z.string().nullable(),
});
export type MemoryVersion = z.infer<typeof MemoryVersionSchema>;

// ============================================================================
// Knowledge Graph
// ============================================================================

export const KnowledgeNodeSchema = z.object({
  id: z.string(),
  type: KnowledgeNodeTypeSchema,
  name: z.string(),
  description: z.string().nullable(),
  memoryId: z.string().nullable(),
  createdAt: z.string(),
  
  // Graph metrics
  centrality: z.number().default(0),
  connectionCount: z.number().default(0),
});
export type KnowledgeNode = z.infer<typeof KnowledgeNodeSchema>;

export const KnowledgeEdgeSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  relation: KnowledgeRelationSchema,
  weight: z.number().default(1.0),
  createdAt: z.string(),
});
export type KnowledgeEdge = z.infer<typeof KnowledgeEdgeSchema>;

// ============================================================================
// L2: Learning Layer
// ============================================================================

export const LearningRuleSchema = z.object({
  id: z.string(),
  ruleType: z.enum(['pattern', 'preference', 'workflow']),
  pattern: z.string(),
  action: z.string(),
  confidence: z.number().min(0).max(1).default(0.5),
  occurrenceCount: z.number().default(1),
  lastTriggered: z.string().nullable(),
  createdAt: z.string(),
  isActive: z.boolean().default(true),
});
export type LearningRule = z.infer<typeof LearningRuleSchema>;

export const UserProfileSchema = z.object({
  key: z.string(),
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1).default(1.0),
  source: z.enum(['explicit', 'inferred', 'learned']).nullable(),
  updatedAt: z.string(),
});
export type UserProfile = z.infer<typeof UserProfileSchema>;

export const LearningEventSchema = z.object({
  id: z.string(),
  eventType: z.enum(['pattern_detected', 'preference_updated', 'rule_created', 'memory_promoted']),
  details: z.record(z.unknown()).nullable(),
  createdAt: z.string(),
});
export type LearningEvent = z.infer<typeof LearningEventSchema>;

// ============================================================================
// Recall System
// ============================================================================

export const RecallResultSchema = z.object({
  memory: MemorySchema,
  score: z.number(),
  method: RecallMethodSchema,
  bm25Score: z.number().optional(),
  vectorScore: z.number().optional(),
});
export type RecallResult = z.infer<typeof RecallResultSchema>;

export const SearchOptionsSchema = z.object({
  query: z.string(),
  type: MemoryTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  recentDays: z.number().optional(),
  limit: z.number().default(10),
  method: RecallMethodSchema.default('hybrid'),
  vectorWeight: z.number().min(0).max(1).default(0.7),
  bm25Weight: z.number().min(0).max(1).default(0.3),
});
export type SearchOptions = z.infer<typeof SearchOptionsSchema>;

export const GraphQueryOptionsSchema = z.object({
  startNodeId: z.string(),
  relation: KnowledgeRelationSchema.optional(),
  maxDepth: z.number().default(3),
  minWeight: z.number().default(0.5),
});
export type GraphQueryOptions = z.infer<typeof GraphQueryOptionsSchema>;

// ============================================================================
// Storage Operations
// ============================================================================

export const StoreOptionsSchema = z.object({
  content: z.string(),
  type: MemoryTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  importance: z.number().min(0).max(1).optional(),
  skipEmbedding: z.boolean().optional(),
});
export type StoreOptions = z.infer<typeof StoreOptionsSchema>;

export const StoreResultSchema = z.object({
  id: z.string(),
  isNew: z.boolean(),
  duplicateOf: z.string().nullable(),
});
export type StoreResult = z.infer<typeof StoreResultSchema>;

// ============================================================================
// Statistics
// ============================================================================

export const MemoryStatsSchema = z.object({
  total: z.number(),
  byType: z.record(z.number()),
  bySource: z.record(z.number()),
  recentCount: z.number(),
  avgAccessCount: z.number(),
  oldestMemory: z.string().nullable(),
  newestMemory: z.string().nullable(),
  embeddingCoverage: z.number(), // percentage
});
export type MemoryStats = z.infer<typeof MemoryStatsSchema>;

// ============================================================================
// Configuration
// ============================================================================

export const MemoryConfigSchema = z.object({
  dbPath: z.string().default('~/.opencode/memory/memory_v4.db'),
  ollamaUrl: z.string().default('http://localhost:11434'),
  embeddingModel: z.string().default('nomic-embed-text'),
  embeddingDimension: z.number().default(768),
  autoPromoteThreshold: z.number().default(0.7),
  hybridSearchWeights: z.object({
    vector: z.number().default(0.7),
    bm25: z.number().default(0.3),
  }).default({ vector: 0.7, bm25: 0.3 }),
  ftsTokenizer: z.enum(['unicode61', 'porter', 'simple']).default('unicode61'),
});
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

// ============================================================================
// Export all schemas for validation
// ============================================================================

export const schemas = {
  memory: MemorySchema,
  session: SessionSchema,
  workingMemory: WorkingMemorySchema,
  knowledgeNode: KnowledgeNodeSchema,
  knowledgeEdge: KnowledgeEdgeSchema,
  learningRule: LearningRuleSchema,
  searchOptions: SearchOptionsSchema,
  storeOptions: StoreOptionsSchema,
  memoryConfig: MemoryConfigSchema,
} as const;