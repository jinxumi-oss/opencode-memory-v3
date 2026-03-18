/**
 * Unified Memory System Type Definitions (Zod Schemas)
 * 统一记忆系统类型定义
 *
 * Integrates System A (Timeline Memory) and System B (OpenCode Memory)
 * 整合系统 A (时序记忆) 和系统 B (OpenCode 记忆)
 */

import { z } from 'zod';

// ============================================================================
// Base Enum Types
// 基础枚举类型
// ============================================================================

/**
 * Memory Type - Combined from both systems
 * 记忆类型 - 合并自两个系统
 */
export const MemoryTypeSchema = z.enum([
  'decision',   // 决策
  'learning',   // 学习
  'context',    // 上下文
  'preference', // 偏好
  'error',      // 错误
  'pattern',    // 模式
  'note',       // 笔记
]);
export type MemoryType = z.infer<typeof MemoryTypeSchema>;

/**
 * Storage Tier
 * 存储层级
 */
export const TierSchema = z.enum(['hot', 'warm', 'cold', 'isolated']);
export type Tier = z.infer<typeof TierSchema>;

/**
 * Source Type
 * 来源类型
 */
export const SourceSchema = z.enum(['user', 'session', 'system', 'promoted', 'migration']);
export type Source = z.infer<typeof SourceSchema>;

/**
 * Entity/Node Type
 * 实体/节点类型
 */
export const EntityTypeSchema = z.enum(['concept', 'entity', 'decision', 'pattern']);
export type EntityType = z.infer<typeof EntityTypeSchema>;

/**
 * Relation Type
 * 关系类型
 */
export const RelationTypeSchema = z.enum([
  'relates_to',  // 相关
  'causes',      // 导致
  'enables',     // 使能
  'conflicts',   // 冲突
  'depends_on',  // 依赖
]);
export type RelationType = z.infer<typeof RelationTypeSchema>;

/**
 * Recall Method
 * 检索方法
 */
export const RecallMethodSchema = z.enum(['semantic', 'bm25', 'hybrid', 'contextual']);
export type RecallMethod = z.infer<typeof RecallMethodSchema>;

// ============================================================================
// Core Memory Types
// 核心记忆类型
// ============================================================================

/**
 * Timeline Entry - Linear storage unit (System A)
 * 时序条目 - 线性存储单元
 */
export const TimelineEntrySchema = z.object({
  id: z.string(),
  timestamp: z.string(), // ISO 8601
  content: z.string(),
  metadata: z.object({
    type: MemoryTypeSchema,
    source: SourceSchema,
    tags: z.array(z.string()).optional(),
    importance: z.number().min(1).max(10).optional(),
    blockId: z.string().optional(),
  }),
});
export type TimelineEntry = z.infer<typeof TimelineEntrySchema>;

/**
 * Memory Block - Standardized memory unit (System A)
 * 记忆块 - 标准化记忆单元
 */
export const MemoryBlockSchema = z.object({
  id: z.string(), // UUID
  hash: z.string(), // SHA-256
  summary: z.string(),
  content: z.string(),
  tier: TierSchema,
  weight: z.number().min(0).max(1),
  accessCount: z.number().default(0),
  createdAt: z.string(),
  lastAccessed: z.string().nullable(),
  metadata: z.object({
    type: MemoryTypeSchema,
    tags: z.array(z.string()),
    source: SourceSchema,
    timelineEntryIds: z.array(z.string()),
    custom: z.record(z.unknown()).optional(),
  }),
});
export type MemoryBlock = z.infer<typeof MemoryBlockSchema>;

/**
 * Entity - Knowledge graph node (System B)
 * 实体 - 知识图谱节点
 */
export const EntitySchema = z.object({
  id: z.string(),
  type: EntityTypeSchema,
  name: z.string(),
  description: z.string().optional(),
  memoryId: z.string().optional(),
  // Graph metrics
  centrality: z.number().default(0),
  connectionCount: z.number().default(0),
});
export type Entity = z.infer<typeof EntitySchema>;

/**
 * Relation - Knowledge graph edge (System B)
 * 关系 - 知识图谱边
 */
export const RelationSchema = z.object({
  id: z.string(),
  sourceId: z.string(),
  targetId: z.string(),
  relation: RelationTypeSchema,
  weight: z.number().min(0).max(1).default(1.0),
});
export type Relation = z.infer<typeof RelationSchema>;

/**
 * Search Result - Memory retrieval result
 * 检索结果 - 记忆检索结果
 */
export const SearchResultSchema = z.object({
  block: MemoryBlockSchema,
  similarity: z.number().min(0).max(1),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * Recall Result - Enhanced search result (System B)
 * 检索结果增强版
 */
export const RecallResultSchema = z.object({
  memory: MemoryBlockSchema,
  score: z.number(),
  method: RecallMethodSchema,
  bm25Score: z.number().optional(),
  vectorScore: z.number().optional(),
});
export type RecallResult = z.infer<typeof RecallResultSchema>;

// ============================================================================
// Input Validation Schemas
// 输入验证 Schema
// ============================================================================

/**
 * Store Input - Store new memory
 * 存储输入 - 存储新记忆
 */
export const StoreInputSchema = z.object({
  content: z.string(),
  type: MemoryTypeSchema.optional().default('note'),
  tags: z.array(z.string()).optional().default([]),
  importance: z.number().min(0).max(1).optional(),
  source: SourceSchema.optional().default('user'),
});
export type StoreInput = z.infer<typeof StoreInputSchema>;

/**
 * Recall Input - Retrieve memories
 * 检索输入 - 检索记忆
 */
export const RecallInputSchema = z.object({
  query: z.string(),
  limit: z.number().min(1).max(100).optional().default(10),
  tier: z.union([TierSchema, z.literal('all')]).optional().default('all'),
  tags: z.array(z.string()).optional(),
  type: MemoryTypeSchema.optional(),
  recentDays: z.number().optional(),
  method: RecallMethodSchema.optional().default('hybrid'),
  vectorWeight: z.number().min(0).max(1).optional().default(0.7),
  bm25Weight: z.number().min(0).max(1).optional().default(0.3),
});
export type RecallInput = z.infer<typeof RecallInputSchema>;

/**
 * Forget Input - Delete memory
 * 遗忘输入 - 删除记忆
 */
export const ForgetInputSchema = z.object({
  id: z.string(),
});
export type ForgetInput = z.infer<typeof ForgetInputSchema>;

// ============================================================================
// Additional Types from System B
// 系统 B 的额外类型
// ============================================================================

/**
 * Session - Working memory session
 * 会话 - 工作记忆会话
 */
export const SessionSchema = z.object({
  id: z.string(),
  startedAt: z.string(),
  endedAt: z.string().nullable(),
  contextSummary: z.string().nullable(),
  memoryCount: z.number().default(0),
});
export type Session = z.infer<typeof SessionSchema>;

/**
 * Working Memory - Session context
 * 工作记忆 - 会话上下文
 */
export const WorkingMemorySchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  tokens: z.number().default(0),
  createdAt: z.string(),
  importance: z.number().min(0).max(1).default(0.5),
  isProcessed: z.boolean().default(false),
});
export type WorkingMemory = z.infer<typeof WorkingMemorySchema>;

/**
 * Memory Version - Version history
 * 记忆版本 - 版本历史
 */
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

/**
 * Learning Rule - Pattern learning
 * 学习规则 - 模式学习
 */
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

// ============================================================================
// Output Types
// 输出类型
// ============================================================================

/**
 * Store Result
 * 存储结果
 */
export const StoreResultSchema = z.object({
  id: z.string(),
  isNew: z.boolean(),
  duplicateOf: z.string().nullable(),
});
export type StoreResult = z.infer<typeof StoreResultSchema>;

/**
 * Recall Result List
 * 检索结果列表
 */
export const RecallResultListSchema = z.object({
  results: z.array(RecallResultSchema),
  total: z.number(),
  query: z.string(),
  method: RecallMethodSchema,
});
export type RecallResultList = z.infer<typeof RecallResultListSchema>;

/**
 * Memory Statistics
 * 记忆统计
 */
export const MemoryStatsSchema = z.object({
  total: z.number(),
  byType: z.record(z.number()),
  bySource: z.record(z.number()),
  byTier: z.record(z.number()),
  recentCount: z.number(),
  avgAccessCount: z.number(),
  oldestMemory: z.string().nullable(),
  newestMemory: z.string().nullable(),
  embeddingCoverage: z.number(), // percentage
});
export type MemoryStats = z.infer<typeof MemoryStatsSchema>;

// ============================================================================
// Configuration Types
// 配置类型
// ============================================================================

/**
 * Tier Configuration
 * 层级配置
 */
export const TierConfigSchema = z.object({
  name: TierSchema,
  weightThreshold: z.tuple([z.number(), z.number()]),
  accessThreshold: z.number(),
  daysThreshold: z.number(),
  storage: z.string(),
  description: z.string(),
});
export type TierConfig = z.infer<typeof TierConfigSchema>;

/**
 * Default Tier Configurations
 * 默认层级配置
 */
export const DEFAULT_TIER_CONFIGS: TierConfig[] = [
  {
    name: 'hot',
    weightThreshold: [0.8, 1.0],
    accessThreshold: 3,
    daysThreshold: 7,
    storage: 'cache',
    description: '高频核心记忆 - 7日内调用≥3次',
  },
  {
    name: 'warm',
    weightThreshold: [0.3, 0.8],
    accessThreshold: 1,
    daysThreshold: 15,
    storage: 'persistent',
    description: '低频冷门记忆 - 15日内调用≤1次',
  },
  {
    name: 'cold',
    weightThreshold: [0.05, 0.3],
    accessThreshold: 0,
    daysThreshold: 60,
    storage: 'archive',
    description: '休眠死亡记忆 - 60日无调用',
  },
  {
    name: 'isolated',
    weightThreshold: [0, 0.05],
    accessThreshold: 0,
    daysThreshold: 180,
    storage: 'quarantine',
    description: '淘汰无效记忆 - 180日无调用+无关联',
  },
];

/**
 * Memory System Configuration
 * 记忆系统配置
 */
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
  tierConfigs: z.array(TierConfigSchema).default(DEFAULT_TIER_CONFIGS),
});
export type MemoryConfig = z.infer<typeof MemoryConfigSchema>;

// ============================================================================
// Utility Types
// 工具类型
// ============================================================================

/**
 * Embedding Function
 * 嵌入生成函数
 */
export type EmbeddingFunction = (text: string) => Promise<number[]>;

/**
 * Batch Embedding Function
 * 批量嵌入生成函数
 */
export type BatchEmbeddingFunction = (texts: string[]) => Promise<number[][]>;

/**
 * Hash Function
 * 哈希生成函数
 */
export type HashFunction = (content: string) => string;

/**
 * Summary Function
 * 摘要生成函数
 */
export type SummaryFunction = (content: string) => Promise<string>;

// ============================================================================
// Export all schemas for validation
// 导出所有 Schema 用于验证
// ============================================================================

export const schemas = {
  // Core types
  timelineEntry: TimelineEntrySchema,
  memoryBlock: MemoryBlockSchema,
  entity: EntitySchema,
  relation: RelationSchema,
  searchResult: SearchResultSchema,
  recallResult: RecallResultSchema,

  // Input validation
  storeInput: StoreInputSchema,
  recallInput: RecallInputSchema,
  forgetInput: ForgetInputSchema,

  // Additional types
  session: SessionSchema,
  workingMemory: WorkingMemorySchema,
  memoryVersion: MemoryVersionSchema,
  learningRule: LearningRuleSchema,

  // Output types
  storeResult: StoreResultSchema,
  recallResultList: RecallResultListSchema,
  memoryStats: MemoryStatsSchema,

  // Configuration
  tierConfig: TierConfigSchema,
  memoryConfig: MemoryConfigSchema,

  // Base enums
  memoryType: MemoryTypeSchema,
  tier: TierSchema,
  source: SourceSchema,
  entityType: EntityTypeSchema,
  relationType: RelationTypeSchema,
  recallMethod: RecallMethodSchema,
} as const;



// ============================================================================
// Type Guards
// 类型守卫
// ============================================================================

export function isMemoryType(value: unknown): value is MemoryType {
  return MemoryTypeSchema.safeParse(value).success;
}

export function isTier(value: unknown): value is Tier {
  return TierSchema.safeParse(value).success;
}

export function isEntityType(value: unknown): value is EntityType {
  return EntityTypeSchema.safeParse(value).success;
}

export function isRelationType(value: unknown): value is RelationType {
  return RelationTypeSchema.safeParse(value).success;
}

export function isRecallMethod(value: unknown): value is RecallMethod {
  return RecallMethodSchema.safeParse(value).success;
}

// ============================================================================
// Validation Helpers
// 验证辅助函数
// ============================================================================

export function validateStoreInput(input: unknown): StoreInput {
  return StoreInputSchema.parse(input);
}

export function validateRecallInput(input: unknown): RecallInput {
  return RecallInputSchema.parse(input);
}

export function validateForgetInput(input: unknown): ForgetInput {
  return ForgetInputSchema.parse(input);
}

export function validateMemoryBlock(input: unknown): MemoryBlock {
  return MemoryBlockSchema.parse(input);
}

export function validateTimelineEntry(input: unknown): TimelineEntry {
  return TimelineEntrySchema.parse(input);
}

export function validateEntity(input: unknown): Entity {
  return EntitySchema.parse(input);
}

export function validateRelation(input: unknown): Relation {
  return RelationSchema.parse(input);
}

export function validateSearchResult(input: unknown): SearchResult {
  return SearchResultSchema.parse(input);
}

// ============================================================================
// Safe Validation (returns Result)
// 安全验证 (返回 Result)
// ============================================================================

export function safeValidateStoreInput(input: unknown) {
  return StoreInputSchema.safeParse(input);
}

export function safeValidateRecallInput(input: unknown) {
  return RecallInputSchema.safeParse(input);
}

export function safeValidateForgetInput(input: unknown) {
  return ForgetInputSchema.safeParse(input);
}

export function safeValidateMemoryBlock(input: unknown) {
  return MemoryBlockSchema.safeParse(input);
}

export function safeValidateTimelineEntry(input: unknown) {
  return TimelineEntrySchema.safeParse(input);
}

export function safeValidateEntity(input: unknown) {
  return EntitySchema.safeParse(input);
}

export function safeValidateRelation(input: unknown) {
  return RelationSchema.safeParse(input);
}

export function safeValidateSearchResult(input: unknown) {
  return SearchResultSchema.safeParse(input);
}