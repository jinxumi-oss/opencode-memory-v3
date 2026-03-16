import type Database from 'better-sqlite3';
import type { Session, WorkingMemory } from '../types/index.js';
import type { KnowledgeGraphService } from './knowledge-graph.js';
import crypto from 'crypto';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'fs';

export class SessionService {
  private db: Database.Database;
  private graphService: KnowledgeGraphService;
  private currentSessionId: string | null = null;
  private sessionFile: string;

  constructor(
    db: Database.Database,
    graphService: KnowledgeGraphService
  ) {
    this.db = db;
    this.graphService = graphService;
    this.sessionFile = '/tmp/opencode_session_id';
    this.loadCurrentSession();
  }

  private loadCurrentSession(): void {
    try {
      if (existsSync(this.sessionFile)) {
        this.currentSessionId = readFileSync(this.sessionFile, 'utf-8').trim();
      }
    } catch {
      this.currentSessionId = null;
    }
  }

  private saveCurrentSession(): void {
    try {
      if (this.currentSessionId) {
        writeFileSync(this.sessionFile, this.currentSessionId);
      } else {
        try {
          unlinkSync(this.sessionFile);
        } catch {
          // File doesn't exist
        }
      }
    } catch {
      // Ignore file system errors
    }
  }

  startSession(): Session {
    if (this.currentSessionId) {
      const existing = this.getSession(this.currentSessionId);
      if (existing && !existing.endedAt) {
        return existing;
      }
    }

    const id = `sess_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const startedAt = new Date().toISOString();

    this.db.prepare(`
      INSERT INTO sessions (id, started_at, memory_count)
      VALUES (?, ?, 0)
    `).run(id, startedAt);

    this.currentSessionId = id;
    this.saveCurrentSession();

    return {
      id,
      startedAt,
      endedAt: null,
      contextSummary: null,
      memoryCount: 0,
    };
  }

  endSession(): Session | null {
    if (!this.currentSessionId) {
      return null;
    }

    const session = this.getSession(this.currentSessionId);
    if (!session) {
      this.currentSessionId = null;
      this.saveCurrentSession();
      return null;
    }

    const endedAt = new Date().toISOString();
    const memoryCount = this.getWorkingMemoryCount(this.currentSessionId);

    this.db.prepare(`
      UPDATE sessions 
      SET ended_at = ?, memory_count = ?, context_summary = ?
      WHERE id = ?
    `).run(endedAt, memoryCount, `Session with ${memoryCount} interactions`, this.currentSessionId);

    this.promoteWorkingMemory(this.currentSessionId);

    const updatedSession: Session = {
      ...session,
      endedAt,
      memoryCount,
      contextSummary: `Session with ${memoryCount} interactions`,
    };

    this.currentSessionId = null;
    this.saveCurrentSession();

    return updatedSession;
  }

  getSession(id: string): Session | null {
    const row = this.db.prepare(`
      SELECT * FROM sessions WHERE id = ?
    `).get(id);

    if (!row) return null;

    return {
      id: (row as Record<string, unknown>).id as string,
      startedAt: (row as Record<string, unknown>).started_at as string,
      endedAt: (row as Record<string, unknown>).ended_at as string | null,
      contextSummary: (row as Record<string, unknown>).context_summary as string | null,
      memoryCount: (row as Record<string, unknown>).memory_count as number,
    };
  }

  getCurrentSession(): Session | null {
    if (!this.currentSessionId) return null;
    return this.getSession(this.currentSessionId);
  }

  addWorkingMemory(role: 'user' | 'assistant' | 'system', content: string, importance: number = 0.5): WorkingMemory | null {
    if (!this.currentSessionId) {
      this.startSession();
    }

    const id = `wm_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
    const createdAt = new Date().toISOString();
    const tokens = Math.ceil(content.length / 4);

    this.db.prepare(`
      INSERT INTO working_memory (id, session_id, role, content, tokens, created_at, importance, is_processed)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0)
    `).run(id, this.currentSessionId, role, content, tokens, createdAt, importance);

    this.db.prepare(`
      UPDATE sessions SET memory_count = memory_count + 1 WHERE id = ?
    `).run(this.currentSessionId);

    return {
      id,
      sessionId: this.currentSessionId!,
      role,
      content,
      tokens,
      createdAt,
      importance,
      isProcessed: false,
    };
  }

  getWorkingMemory(sessionId: string, limit: number = 20): WorkingMemory[] {
    const rows = this.db.prepare(`
      SELECT * FROM working_memory 
      WHERE session_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `).all(sessionId, limit) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      sessionId: row.session_id as string,
      role: row.role as WorkingMemory['role'],
      content: row.content as string,
      tokens: row.tokens as number,
      createdAt: row.created_at as string,
      importance: row.importance as number,
      isProcessed: Boolean(row.is_processed),
    }));
  }

  getWorkingMemoryCount(sessionId: string): number {
    const result = this.db.prepare(`
      SELECT COUNT(*) as count FROM working_memory WHERE session_id = ?
    `).get(sessionId) as { count: number };
    return result.count;
  }

  private promoteWorkingMemory(sessionId: string, threshold: number = 0.7): number {
    const importantMemories = this.db.prepare(`
      SELECT * FROM working_memory 
      WHERE session_id = ? AND importance >= ? AND is_processed = 0
      ORDER BY importance DESC
    `).all(sessionId, threshold) as Record<string, unknown>[];

    let promoted = 0;

    for (const wm of importantMemories) {
      const content = wm.content as string;
      const contentHash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);

      const existing = this.db.prepare(`
        SELECT id FROM memories WHERE content_hash = ?
      `).get(contentHash);

      if (existing) {
        this.db.prepare(`UPDATE working_memory SET is_processed = 1 WHERE id = ?`).run(wm.id);
        continue;
      }

      const type = this.classifyContent(content);
      const memoryId = `mem_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

      this.db.prepare(`
        INSERT INTO memories (id, type, source, content, content_hash, created_at, access_count)
        VALUES (?, ?, 'promoted', ?, ?, datetime('now'), 1)
      `).run(memoryId, type, content, contentHash);

      this.db.prepare(`UPDATE working_memory SET is_processed = 1 WHERE id = ?`).run(wm.id);

      this.graphService.createNode({
        id: `kn_${memoryId}`,
        type: type === 'decision' ? 'decision' : type === 'pattern' ? 'pattern' : 'concept',
        name: content.slice(0, 50),
        description: content,
        memoryId,
      });

      promoted++;
    }

    return promoted;
  }

  private classifyContent(content: string): string {
    if (/决策|决定|选择|选用/.test(content)) return 'decision';
    if (/规则|流程|规范|模式/.test(content)) return 'pattern';
    if (/偏好|喜欢|习惯/.test(content)) return 'preference';
    return 'note';
  }

  getRecentSessions(limit: number = 5): Session[] {
    const rows = this.db.prepare(`
      SELECT * FROM sessions 
      ORDER BY started_at DESC 
      LIMIT ?
    `).all(limit) as Record<string, unknown>[];

    return rows.map(row => ({
      id: row.id as string,
      startedAt: row.started_at as string,
      endedAt: row.ended_at as string | null,
      contextSummary: row.context_summary as string | null,
      memoryCount: row.memory_count as number,
    }));
  }
}