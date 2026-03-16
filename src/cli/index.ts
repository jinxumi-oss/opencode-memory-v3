#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import { MemorySystem } from '../index.js';

const program = new Command();

program
  .name('memory')
  .description('OpenCode Memory System v4.0 - BM25 + Vector Search + Learning')
  .version('4.0.0');

program
  .command('store <content>')
  .description('Store a new memory')
  .option('-t, --type <type>', 'Memory type (decision/pattern/preference/note)')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (content: string, options: { type?: string; tags?: string }) => {
    const memory = new MemorySystem();
    
    const tags = options.tags?.split(',').map(t => t.trim()).filter(Boolean);
    
    const result = await memory.store(content, { type: options.type ?? undefined, tags: tags ?? undefined });
    
    if (result) {
      console.log(chalk.green('✓ Memory stored'));
      console.log(chalk.gray(`  ID: ${result}`));
    }
    
    memory.close();
  });

program
  .command('recall <query>')
  .description('Search memories with hybrid search')
  .option('-t, --type <type>', 'Filter by type')
  .option('--tags <tags>', 'Filter by tags')
  .option('-l, --limit <number>', 'Limit results', '10')
  .action(async (query: string, options: { type?: string; tags?: string; limit: string }) => {
    const memory = new MemorySystem();
    
    const limit = parseInt(options.limit, 10);
    
    const results = await memory.recall(query, limit);
    
    if (results.length === 0) {
      console.log(chalk.yellow('No memories found'));
      memory.close();
      return;
    }
    
    console.log(chalk.bold(`\nFound ${results.length} memories:\n`));
    
    for (const result of results) {
      console.log(chalk.blue(`[${result.memory.type}]`) + ' ' + chalk.gray(`(${result.score.toFixed(3)})`));
      console.log(chalk.white(result.memory.content.slice(0, 100) + (result.memory.content.length > 100 ? '...' : '')));
      console.log(chalk.gray(`  ID: ${result.memory.id} | ${result.memory.createdAt.slice(0, 10)}`));
      console.log();
    }
    
    memory.close();
  });

program
  .command('forget <id>')
  .description('Delete a memory (soft delete by default)')
  .option('-p, --permanent', 'Permanently delete without recovery')
  .action((id: string, options: { permanent?: boolean }) => {
    const memory = new MemorySystem();
    
    const success = memory.forget(id, options.permanent ?? false);
    
    if (success) {
      if (options.permanent) {
        console.log(chalk.red('✓ Memory permanently deleted'));
      } else {
        console.log(chalk.yellow('✓ Memory deleted (can be restored)'));
        console.log(chalk.gray(`  Restore with: memory restore ${id}`));
      }
    } else {
      console.log(chalk.red('✗ Memory not found'));
    }
    
    memory.close();
  });

program
  .command('restore <id>')
  .description('Restore a deleted memory')
  .action(async (id: string) => {
    const memory = new MemorySystem();
    
    const newId = await memory.restore(id);
    
    if (newId) {
      console.log(chalk.green('✓ Memory restored'));
      console.log(chalk.gray(`  New ID: ${newId}`));
    } else {
      console.log(chalk.red('✗ Memory not found in deleted items'));
    }
    
    memory.close();
  });

program
  .command('learn')
  .description('Analyze memories and extract learning rules')
  .action(() => {
    const memory = new MemorySystem();
    
    console.log(chalk.bold('\n🧠 Learning Analysis\n'));
    
    const result = memory.analyze();
    
    console.log(chalk.white(`Patterns found: ${result.patternsFound}`));
    console.log(chalk.white(`Rules created: ${result.rulesCreated}`));
    
    const stats = memory.learning.getStats();
    console.log(chalk.white(`Total learning rules: ${stats.totalRules}`));
    console.log(chalk.white(`Active rules: ${stats.activeRules}`));
    console.log(chalk.white(`Average confidence: ${stats.avgConfidence.toFixed(2)}`));
    
    if (Object.keys(stats.byType).length > 0) {
      console.log(chalk.bold('\nBy Type:'));
      for (const [type, count] of Object.entries(stats.byType)) {
        console.log(chalk.gray(`  ${type}: ${count}`));
      }
    }
    
    memory.close();
  });

program
  .command('stats')
  .description('Show memory statistics')
  .option('-r, --recent <days>', 'Recent days threshold', '7')
  .action((options: { recent: string }) => {
    const memory = new MemorySystem();
    const recentDays = parseInt(options.recent, 10);
    const stats = memory.memoryStore.stats(recentDays);
    
    console.log(chalk.bold('\n📊 Memory Statistics\n'));
    console.log(chalk.white(`Total memories: ${stats.total}`));
    console.log(chalk.white(`Recent (${recentDays}d): ${stats.recentCount}`));
    console.log(chalk.white(`Avg access count: ${stats.avgAccessCount.toFixed(2)}`));
    console.log(chalk.white(`Embedding coverage: ${stats.embeddingCoverage.toFixed(1)}%`));
    
    console.log(chalk.bold('\nBy Type:'));
    for (const [type, count] of Object.entries(stats.byType)) {
      console.log(chalk.gray(`  ${type}: ${count}`));
    }
    
    console.log(chalk.bold('\nBy Source:'));
    for (const [source, count] of Object.entries(stats.bySource)) {
      console.log(chalk.gray(`  ${source}: ${count}`));
    }

    const learningStats = memory.learning.getStats();
    console.log(chalk.bold('\nLearning:'));
    console.log(chalk.gray(`  Rules: ${learningStats.totalRules} (${learningStats.activeRules} active)`));
    
    const decayStats = memory.decay.getStats();
    console.log(chalk.bold('\nDecay:'));
    console.log(chalk.gray(`  Avg weight: ${decayStats.avgWeight.toFixed(3)}`));
    console.log(chalk.gray(`  Low weight: ${decayStats.lowWeightCount}`));
    console.log(chalk.gray(`  High weight: ${decayStats.highWeightCount}`));
    
    memory.close();
  });

program
  .command('session <action>')
  .description('Manage sessions: start, end, status, context')
  .action((action: string) => {
    const memory = new MemorySystem();
    
    if (action === 'start') {
      const session = memory.session.startSession();
      console.log(chalk.green('✓ Session started'));
      console.log(chalk.gray(`  ID: ${session.id}`));
      console.log(chalk.gray(`  Started: ${session.startedAt}`));
    } else if (action === 'end') {
      const session = memory.session.endSession();
      if (session) {
        console.log(chalk.green('✓ Session ended'));
        console.log(chalk.gray(`  ID: ${session.id}`));
        console.log(chalk.gray(`  Duration: ${session.memoryCount} interactions`));
      } else {
        console.log(chalk.yellow('No active session'));
      }
    } else if (action === 'status') {
      const session = memory.session.getCurrentSession();
      if (session) {
        console.log(chalk.bold('\n📋 Current Session\n'));
        console.log(chalk.white(`ID: ${session.id}`));
        console.log(chalk.white(`Started: ${session.startedAt}`));
        console.log(chalk.white(`Interactions: ${session.memoryCount}`));
        if (session.endedAt) {
          console.log(chalk.white(`Ended: ${session.endedAt}`));
        } else {
          console.log(chalk.green('Status: Active'));
        }
      } else {
        console.log(chalk.yellow('No active session'));
        console.log(chalk.gray('Start a new session with: memory session start'));
      }
    } else if (action === 'context') {
      const session = memory.session.getCurrentSession();
      if (session) {
        const workingMemory = memory.session.getWorkingMemory(session.id, 20);
        console.log(chalk.bold(`\n📝 Session Context (${workingMemory.length} items)\n`));
        for (const wm of workingMemory) {
          const roleColor = wm.role === 'user' ? chalk.cyan : wm.role === 'assistant' ? chalk.magenta : chalk.gray;
          console.log(roleColor(`[${wm.role}]`) + ' ' + chalk.gray(`(${wm.importance.toFixed(1)})`));
          console.log(chalk.white('  ' + wm.content.slice(0, 80)));
        }
      } else {
        console.log(chalk.yellow('No active session'));
      }
    } else {
      console.log(chalk.gray('Usage: memory session <start|end|status|context>'));
    }
    
    memory.close();
  });

program
  .command('rebuild')
  .description('Rebuild FTS index and graph metrics')
  .action(() => {
    const memory = new MemorySystem();
    memory.rebuildIndex();
    console.log(chalk.green('✓ Index rebuilt'));
    memory.close();
  });

program
  .command('get <id>')
  .description('Get a specific memory by ID')
  .action((id: string) => {
    const memory = new MemorySystem();
    const mem = memory.memoryStore.get(id);
    
    if (mem) {
      console.log(chalk.bold('\n📄 Memory\n'));
      console.log(chalk.white(`ID: ${mem.id}`));
      console.log(chalk.white(`Type: ${mem.type}`));
      console.log(chalk.white(`Source: ${mem.source}`));
      console.log(chalk.white(`Created: ${mem.createdAt}`));
      console.log(chalk.white(`Access count: ${mem.accessCount}`));
      console.log(chalk.white(`Weight: ${mem.weight.toFixed(3)}`));
      console.log(chalk.white(`Tags: ${mem.tags.join(', ') || 'none'}`));
      console.log(chalk.bold('\nContent:'));
      console.log(chalk.white(mem.content));
    } else {
      console.log(chalk.red('✗ Memory not found'));
    }
    
    memory.close();
  });

program
  .command('decay')
  .description('Run memory decay analysis and calculate weights')
  .option('--archive', 'Archive low-weight memories')
  .option('--dry-run', 'Show what would be archived without doing it')
  .action((options: { archive?: boolean; dryRun?: boolean }) => {
    const memory = new MemorySystem();
    
    console.log(chalk.bold('\n⏳ Memory Decay Analysis\n'));
    
    const result = memory.runDecay();
    
    console.log(chalk.white(`Processed: ${result.processed} memories`));
    console.log(chalk.white(`Average weight: ${result.avgWeight.toFixed(3)}`));
    console.log(chalk.white(`Low weight (< 0.3): ${result.lowWeightCount}`));
    
    const stats = memory.decay.getStats();
    console.log(chalk.white(`Min weight: ${stats.minWeight.toFixed(3)}`));
    console.log(chalk.white(`Max weight: ${stats.maxWeight.toFixed(3)}`));
    
    const distribution = memory.decay.getWeightDistribution();
    console.log(chalk.bold('\nWeight Distribution:'));
    for (const [range, count] of Object.entries(distribution)) {
      console.log(chalk.gray(`  ${range}: ${count}`));
    }
    
    if (options.dryRun || options.archive) {
      const lowWeight = memory.decay.getLowWeightMemories(20);
      console.log(chalk.bold(`\nLow Weight Memories (${lowWeight.length}):`));
      for (const mem of lowWeight.slice(0, 10)) {
        console.log(chalk.gray(`  ${mem.id.slice(0, 20)}... [${mem.type}] weight=${mem.weight.toFixed(2)}`));
        console.log(chalk.gray(`    ${mem.content.slice(0, 60)}...`));
      }
      
      if (options.archive) {
        const archived = memory.decay.archiveLowWeight(false);
        console.log(chalk.yellow(`\n✓ Archived ${archived} low-weight memories`));
      }
    }
    
    memory.close();
  });

program
  .command('extract')
  .description('Extract entities and relations from memories')
  .option('-l, --limit <number>', 'Limit memories to process', '50')
  .action((options: { limit: string }) => {
    const memory = new MemorySystem();
    const limit = parseInt(options.limit, 10);
    
    console.log(chalk.bold('\n🔍 Entity Extraction\n'));
    
    const result = memory.batchExtractEntities(limit);
    
    console.log(chalk.white(`Processed: ${result.processed} memories`));
    console.log(chalk.white(`Entities created: ${result.entities}`));
    console.log(chalk.white(`Relations created: ${result.relations}`));
    
    const stats = memory.ner.getStats();
    console.log(chalk.white(`Total entities: ${stats.totalEntities}`));
    console.log(chalk.white(`Total relations: ${stats.totalRelations}`));
    
    console.log(chalk.bold('\nBy Type:'));
    for (const [type, count] of Object.entries(stats.byType)) {
      console.log(chalk.gray(`  ${type}: ${count}`));
    }
    
    memory.close();
  });

program
  .command('infer')
  .description('Run inference on knowledge graph')
  .action(() => {
    const memory = new MemorySystem();
    
    console.log(chalk.bold('\n🔮 Relation Inference\n'));
    
    const applied = memory.inferRelations();
    
    console.log(chalk.white(`Inferred relations applied: ${applied}`));
    
    const stats = memory.inference.getStats();
    console.log(chalk.white(`Total nodes: ${stats.nodes}`));
    console.log(chalk.white(`Total edges: ${stats.edges}`));
    console.log(chalk.white(`Avg connectivity: ${stats.avgConnectivity.toFixed(2)}`));
    
    console.log(chalk.bold('\nTop Entities:'));
    for (const entity of stats.topEntities.slice(0, 5)) {
      console.log(chalk.gray(`  ${entity.name}: ${entity.count} connections`));
    }
    
    memory.close();
  });

program
  .command('classify')
  .description('Classify memories with NLP')
  .option('-l, --limit <number>', 'Limit memories to classify', '50')
  .action(async (options: { limit: string }) => {
    const memory = new MemorySystem();
    const limit = parseInt(options.limit, 10);
    
    console.log(chalk.bold('\n🏷️ Memory Classification\n'));
    
    const result = await memory.classifyMemories(limit);
    
    console.log(chalk.white(`Processed: ${result.processed}`));
    console.log(chalk.white(`Updated: ${result.updated}`));
    
    memory.close();
  });

program
  .command('recommend <memoryId>')
  .description('Get related memory recommendations')
  .action((memoryId: string) => {
    const memory = new MemorySystem();
    
    const recommendations = memory.getRecommendations(memoryId);
    
    if (recommendations.length === 0) {
      console.log(chalk.yellow('No recommendations found'));
    } else {
      console.log(chalk.bold(`\n💡 Recommendations for ${memoryId}:\n`));
      
      for (const rec of recommendations) {
        console.log(chalk.white(`[${rec.score.toFixed(2)}] ${rec.memoryId}`));
        console.log(chalk.gray(`  ${rec.content.slice(0, 80)}...`));
      }
    }
    
    memory.close();
  });

program.parse();