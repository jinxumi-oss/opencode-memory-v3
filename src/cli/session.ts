#!/usr/bin/env node
import { Command } from 'commander';
import { MemorySystem } from '../index.js';

const program = new Command();

program
  .name('memory-session')
  .description('Manage sessions')
  .argument('[action]', 'start | end | status')
  .action((action: string | undefined) => {
    const memory = new MemorySystem();
    
    if (action === 'start') {
      const session = memory.memoryStore.createSession();
      console.log(session.id);
    } else if (action === 'end') {
      console.log('No active session');
    } else {
      console.log('Usage: memory-session start|end');
    }
    
    memory.close();
  });

program.parse();