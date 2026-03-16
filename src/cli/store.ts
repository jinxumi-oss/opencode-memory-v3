#!/usr/bin/env node
import { Command } from 'commander';
import { MemorySystem } from '../index.js';

const program = new Command();

program
  .name('memory-store')
  .description('Store a memory')
  .argument('<content>', 'Memory content')
  .option('-t, --type <type>', 'Memory type')
  .option('--tags <tags>', 'Comma-separated tags')
  .action(async (content: string, options: { type?: string; tags?: string }) => {
    const memory = new MemorySystem();
    const tags = options.tags?.split(',').map(t => t.trim()).filter(Boolean);
    const result = await memory.store(content, { type: options.type ?? undefined, tags: tags ?? undefined });
    console.log(result);
    memory.close();
  });

program.parse();