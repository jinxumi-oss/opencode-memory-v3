/**
 * L3 分层存储管理模块
 * 实现热/温/冷/隔离四层存储管理
 */

import { Database } from 'bun:sqlite';

const DB_PATH = process.env.HOME + '/.opencode/memory/unified.db';

export type Tier = 'hot' | 'warm' | 'cold' | 'isolated';

export interface TierConfig {
  name: Tier;
  weightThreshold: [number, number];
  accessThreshold: number;
  daysThreshold: number;
  description: string;
}

const TIER_CONFIGS: TierConfig[] = [
  {
    name: 'hot',
    weightThreshold: [0.8, 1.0],
    accessThreshold: 3,
    daysThreshold: 7,
    description: '高频核心记忆 - 7日内访问≥3次, weight≥0.8'
  },
  {
    name: 'warm',
    weightThreshold: [0.3, 0.8],
    accessThreshold: 1,
    daysThreshold: 15,
    description: '低频冷门记忆 - 15日内访问≤1次, weight 0.3-0.8'
  },
  {
    name: 'cold',
    weightThreshold: [0.05, 0.3],
    accessThreshold: 0,
    daysThreshold: 60,
    description: '休眠死亡记忆 - 60日无访问, weight 0.05-0.3'
  },
  {
    name: 'isolated',
    weightThreshold: [0, 0.05],
    accessThreshold: 0,
    daysThreshold: 180,
    description: '淘汰无效记忆 - 180日无访问+无关联, weight<0.05'
  }
];

/**
 * 计算记忆块的权重
 * @param accessCount 访问次数
 * @param lastAccessed 最后访问时间（ISO 8601字符串或null）
 * @param createdAt 创建时间（ISO 8601字符串）
 * @returns 权重值（0-1之间）
 */
export function calculateWeight(
  accessCount: number,
  lastAccessed: string | null,
  createdAt: string
): number {
  const now = Date.now();
  const created = new Date(createdAt).getTime();
  const accessed = lastAccessed ? new Date(lastAccessed).getTime() : created;

  const ageDays = (now - created) / (1000 * 60 * 60 * 24);
  const recencyDays = (now - accessed) / (1000 * 60 * 60 * 24);

  const accessScore = Math.min(accessCount / 3, 1);
  const recencyScore = Math.exp(-recencyDays / 21);
  const ageDecay = Math.exp(-ageDays / 90);

  const weight = 0.45 * accessScore + 0.35 * recencyScore + 0.2 * ageDecay;

  return Math.round(weight * 100) / 100;
}

/**
 * 根据权重确定层级
 * @param weight 权重值（0-1之间）
 * @returns 层级类型
 */
export function determineTier(weight: number): Tier {
  for (const config of TIER_CONFIGS) {
    if (weight >= config.weightThreshold[0] && weight < config.weightThreshold[1]) {
      return config.name;
    }
  }
  // 如果不匹配任何区间，返回最低层级
  return 'isolated';
}

/**
 * 更新单个记忆块的层级
 * @param id 记忆块ID
 * @returns 更新后的层级
 */
export function updateBlockTier(id: string): Tier {
  const db = new Database(DB_PATH);

  try {
    const row = db.prepare(`
      SELECT id, access_count, last_accessed, created_at FROM memories WHERE id = ?
    `).get(id) as any;

    if (!row) {
      throw new Error(`Block not found: ${id}`);
    }

    const weight = calculateWeight(
      row.access_count || 0,
      row.last_accessed || null,
      row.created_at
    );

    const tier = determineTier(weight);

    db.prepare(`
      UPDATE memories SET weight = ?, tier = ? WHERE id = ?
    `).run(weight, tier, id);

    return tier;
  } finally {
    db.close();
  }
}

/**
 * 迁移所有记忆块到合适的层级
 * @returns 各层级迁移统计
 */
export function migrateTiers(): {
  hot: number;
  warm: number;
  cold: number;
  isolated: number;
} {
  const db = new Database(DB_PATH);

  try {
    const rows = db.prepare(`
      SELECT id, access_count, last_accessed, created_at FROM memories
    `).all() as any[];

    const counts = { hot: 0, warm: 0, cold: 0, isolated: 0 };

    for (const row of rows) {
      const weight = calculateWeight(
        row.access_count || 0,
        row.last_accessed || null,
        row.created_at
      );

      const tier = determineTier(weight);
      counts[tier]++;

      db.prepare(`
        UPDATE memories SET weight = ?, tier = ? WHERE id = ?
      `).run(weight, tier, row.id);
    }

    return counts;
  } finally {
    db.close();
  }
}

/**
 * 获取指定层级的记忆块（按权重降序）
 * @param tier 层级类型
 * @param limit 返回数量限制
 * @returns 记忆块列表
 */
export function getBlocksByTier(tier: Tier, limit: number = 10): any[] {
  const db = new Database(DB_PATH);

  try {
    const rows = db.prepare(`
      SELECT * FROM memories WHERE tier = ? ORDER BY weight DESC LIMIT ?
    `).all(tier, limit) as any[];

    return rows.map(row => ({
      id: row.id,
      content_hash: row.content_hash,
      summary: row.summary,
      content: row.content,
      tier: row.tier,
      weight: row.weight,
      access_count: row.access_count,
      created_at: row.created_at,
      last_accessed: row.last_accessed,
      timeline_entry_ids: row.timeline_entry_ids,
      tags: row.tags,
      custom_metadata: row.custom_metadata
    }));
  } finally {
    db.close();
  }
}

/**
 * 获取热记忆（用于快速访问）
 * @param limit 返回数量限制
 * @returns 热记忆列表
 */
export function getHotMemories(limit: number = 20): any[] {
  return getBlocksByTier('hot', limit);
}

/**
 * 将记忆块移动到隔离层级
 * @param id 记忆块ID
 */
export function moveToIsolated(id: string): void {
  const db = new Database(DB_PATH);

  try {
    db.run(`
      UPDATE memories SET tier = 'isolated', weight = 0 WHERE id = ?
    `, [id]);
  } finally {
    db.close();
  }
}

/**
 * 清理隔离层级的旧记忆
 * @param daysOld 天数阈值（默认180天）
 * @returns 清理的记录数
 */
export function cleanupIsolated(daysOld: number = 180): number {
  const db = new Database(DB_PATH);

  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - daysOld);

    const result = db.run(`
      DELETE FROM memories
      WHERE tier = 'isolated'
      AND created_at < ?
      AND access_count = 0
    `, [cutoff.toISOString()]);

    return result.changes;
  } finally {
    db.close();
  }
}

/**
 * 获取层级统计信息
 * @returns 各层级统计
 */
export function getTierStats(): Record<Tier, number> {
  const db = new Database(DB_PATH);

  try {
    const stats: Record<Tier, number> = { hot: 0, warm: 0, cold: 0, isolated: 0 };

    const rows = db.query(`
      SELECT tier, COUNT(*) as count FROM memories GROUP BY tier
    `).all() as any[];

    for (const row of rows) {
      stats[row.tier as Tier] = row.count;
    }

    return stats;
  } finally {
    db.close();
  }
}

/**
 * 导出层级配置
 */
export { TIER_CONFIGS };