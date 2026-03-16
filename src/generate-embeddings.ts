import Database from 'better-sqlite3';
import ollama from 'ollama';
import { homedir } from 'os';
import { join } from 'path';

const DB_PATH = join(homedir(), '.opencode/memory/memory_v4.db');
const BATCH_SIZE = 10;
const DELAY_MS = 100;

async function main() {
  console.log('=== 批量生成向量嵌入 ===\n');
  
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
  
  const total = db.prepare(`SELECT COUNT(*) as count FROM memories WHERE embedding IS NULL`).get() as { count: number };
  console.log(`需要处理的记忆数: ${total.count}`);
  
  if (total.count === 0) {
    console.log('所有记忆已有嵌入向量');
    db.close();
    return;
  }
  
  const rows = db.prepare(`
    SELECT id, content FROM memories 
    WHERE embedding IS NULL 
    ORDER BY created_at DESC
  `).all() as Array<{ id: string; content: string }>;
  
  let processed = 0;
  let failed = 0;
  const startTime = Date.now();
  
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;
    
    if (i % BATCH_SIZE === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
      const rate = i > 0 ? (i / parseFloat(elapsed)).toFixed(1) : '0';
      console.log(`进度: ${i}/${rows.length} (${((i/rows.length)*100).toFixed(1)}%) | 速度: ${rate}/s | 失败: ${failed}`);
    }
    
    try {
      const response = await ollama.embeddings({
        model: 'nomic-embed-text',
        prompt: row.content.slice(0, 2000),
      });
      
      const embedding = response.embedding;
      const buffer = Buffer.from(new Float32Array(embedding).buffer);
      
      db.prepare(`
        UPDATE memories 
        SET embedding = ?, embedding_model = 'nomic-embed-text' 
        WHERE id = ?
      `).run(buffer, row.id);
      
      processed++;
      
      if (processed % BATCH_SIZE === 0) {
        await new Promise(r => setTimeout(r, DELAY_MS));
      }
    } catch (err) {
      failed++;
      if (failed < 10) {
        console.log(`  失败: ${row.id} - ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
  
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const finalCount = db.prepare(`SELECT COUNT(*) as count FROM memories WHERE embedding IS NOT NULL`).get() as { count: number };
  const totalMemories = db.prepare(`SELECT COUNT(*) as count FROM memories`).get() as { count: number };
  
  console.log(`\n=== 完成 ===`);
  console.log(`处理成功: ${processed}`);
  console.log(`处理失败: ${failed}`);
  console.log(`耗时: ${elapsed}s`);
  console.log(`嵌入覆盖率: ${((finalCount.count / totalMemories.count) * 100).toFixed(1)}%`);
  
  db.close();
}

main().catch(console.error);