#!/usr/bin/env node
import { Command } from 'commander';
import { MemorySystem } from '../index.js';

const program = new Command();

program
  .name('memory-recall')
  .description('Search memories')
  .argument('<query>', 'Search query')
  .option('-l, --limit <number>', 'Limit', '10')
  .option('-t, --type <type>', 'Filter by type')
  .action(async (query: string, options: { limit: string; type?: string }) => {
    const memory = new MemorySystem();
    const limit = parseInt(options.limit, 10);
    
    const results = await memory.recall(query, limit);
    
    for (const r of results) {
      console.log(`${r.memory.id}\t${r.memory.type}\t${r.score.toFixed(3)}\t${r.memory.content.slice(0, 60)}`);
    }
    
    memory.close();
  });

program.parse();