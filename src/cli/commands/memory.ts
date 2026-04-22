/**
 * slope memory — Cross-session memory management CLI
 *
 * Subcommands:
 *   slope memory add <text> [--category=X] [--weight=N]
 *   slope memory list [--category=X] [--limit=N]
 *   slope memory remove <id>
 *   slope memory edit <id> <text>
 *   slope memory search <query>
 *   slope memory import <file>
 *   slope memory export <file>
 */

import {
  loadMemories,
  saveMemories,
  addMemory,
  removeMemory,
  updateMemory,
  searchMemories,
  getMemoryById,
} from '../../core/memory.js';
import type { MemoryCategory } from '../../core/memory.js';

function parseFlags(args: string[]): Record<string, string> {
  const flags: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) flags[match[1]] = match[2] ?? 'true';
  }
  return flags;
}

function isValidCategory(c: string): c is MemoryCategory {
  return ['workflow', 'style', 'project', 'hazard', 'other'].includes(c);
}

export async function memoryCommand(args: string[]): Promise<void> {
  const sub = args[0];
  const rest = args.slice(1);
  const flags = parseFlags(rest);
  const cwd = process.cwd();

  switch (sub) {
    case 'add':
      addSubcommand(rest, flags, cwd);
      break;
    case 'list':
      listSubcommand(flags, cwd);
      break;
    case 'remove':
      removeSubcommand(rest, cwd);
      break;
    case 'edit':
      editSubcommand(rest, flags, cwd);
      break;
    case 'search':
      searchSubcommand(rest, flags, cwd);
      break;
    case 'import':
      importSubcommand(rest, cwd);
      break;
    case 'export':
      exportSubcommand(rest, cwd);
      break;
    default:
      console.log(`
slope memory — Cross-session memory management

Usage:
  slope memory add <text> [--category=workflow|style|project|hazard|other] [--weight=1-10]
  slope memory list [--category=X] [--limit=N]
  slope memory remove <id>
  slope memory edit <id> <new-text>
  slope memory search <query> [--category=X] [--limit=N]
  slope memory import <file.json>
  slope memory export <file.json>
`);
      if (sub) process.exit(1);
  }
}

function addSubcommand(args: string[], flags: Record<string, string>, cwd: string): void {
  const text = args.find(a => !a.startsWith('--'));
  if (!text) {
    console.error('Usage: slope memory add <text> [--category=X] [--weight=N]');
    process.exit(1);
  }

  const category = isValidCategory(flags.category ?? '') ? flags.category as MemoryCategory : 'other';
  const weight = flags.weight ? parseInt(flags.weight, 10) : 8;

  const mem = addMemory(cwd, text, { category, weight, source: 'manual' });
  console.log(`\nMemory added: ${mem.id.slice(0, 16)}…`);
  console.log(`  ${mem.text.slice(0, 80)}`);
  console.log(`  [${mem.category}] weight:${mem.weight}\n`);
}

function listSubcommand(flags: Record<string, string>, cwd: string): void {
  const results = searchMemories(cwd, {
    category: isValidCategory(flags.category ?? '') ? flags.category as MemoryCategory : undefined,
    limit: flags.limit ? parseInt(flags.limit, 10) : undefined,
  });

  if (results.length === 0) {
    console.log('\nNo memories found.\n');
    return;
  }

  console.log(`\n=== Memories (${results.length}) ===\n`);
  for (const m of results) {
    const date = new Date(m.updatedAt).toLocaleDateString();
    console.log(`  ${m.id.slice(0, 12)}  [${m.category}] w:${m.weight}  ${date}`);
    console.log(`    ${m.text.slice(0, 100)}${m.text.length > 100 ? '…' : ''}`);
  }
  console.log('');
}

function removeSubcommand(args: string[], cwd: string): void {
  const id = args.find(a => !a.startsWith('--'));
  if (!id) {
    console.error('Usage: slope memory remove <id>');
    process.exit(1);
  }

  const ok = removeMemory(cwd, id);
  if (ok) {
    console.log('\nMemory removed.\n');
  } else {
    console.log('\nMemory not found.\n');
    process.exit(1);
  }
}

function editSubcommand(args: string[], _flags: Record<string, string>, cwd: string): void {
  const id = args[0];
  const text = args.slice(1).find(a => !a.startsWith('--'));
  if (!id || !text) {
    console.error('Usage: slope memory edit <id> <new-text>');
    process.exit(1);
  }

  const mem = updateMemory(cwd, id, { text });
  if (mem) {
    console.log(`\nMemory updated: ${mem.id.slice(0, 12)}…`);
    console.log(`  ${mem.text.slice(0, 80)}\n`);
  } else {
    console.log('\nMemory not found.\n');
    process.exit(1);
  }
}

function searchSubcommand(args: string[], flags: Record<string, string>, cwd: string): void {
  const query = args.find(a => !a.startsWith('--'));
  const results = searchMemories(cwd, {
    query,
    category: isValidCategory(flags.category ?? '') ? flags.category as MemoryCategory : undefined,
    limit: flags.limit ? parseInt(flags.limit, 10) : 10,
  });

  if (results.length === 0) {
    console.log('\nNo memories found.\n');
    return;
  }

  console.log(`\n=== Search Results (${results.length}) ===\n`);
  for (const m of results) {
    console.log(`  ${m.id.slice(0, 12)}  [${m.category}] w:${m.weight}`);
    console.log(`    ${m.text.slice(0, 100)}${m.text.length > 100 ? '…' : ''}`);
  }
  console.log('');
}

function importSubcommand(args: string[], cwd: string): void {
  const file = args.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: slope memory import <file.json>');
    process.exit(1);
  }

  const { readFileSync } = require('node:fs');
  try {
    const imported = JSON.parse(readFileSync(file, 'utf8'));
    const data = loadMemories(cwd);

    if (Array.isArray(imported)) {
      for (const item of imported) {
        if (typeof item.text === 'string') {
          data.memories.push({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            text: item.text,
            category: isValidCategory(item.category ?? '') ? item.category : 'other',
            weight: typeof item.weight === 'number' ? Math.max(1, Math.min(10, item.weight)) : 5,
            source: 'manual',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
      }
    } else if (imported.memories && Array.isArray(imported.memories)) {
      data.memories.push(...imported.memories);
    }

    saveMemories(cwd, data);
    console.log(`\nImported ${imported.length ?? imported.memories?.length ?? 0} memories.\n`);
  } catch (err) {
    console.error(`Import failed: ${(err as Error).message}`);
    process.exit(1);
  }
}

function exportSubcommand(args: string[], cwd: string): void {
  const file = args.find(a => !a.startsWith('--'));
  if (!file) {
    console.error('Usage: slope memory export <file.json>');
    process.exit(1);
  }

  const { writeFileSync } = require('node:fs');
  const data = loadMemories(cwd);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nExported ${data.memories.length} memories to ${file}\n`);
}
