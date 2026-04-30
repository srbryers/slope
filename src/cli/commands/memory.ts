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

import { readFileSync, writeFileSync } from 'node:fs';
import {
  loadMemories,
  saveMemories,
  addMemory,
  removeMemory,
  updateMemory,
  searchMemories,
  validateMemory,
  detectSecret,
  SecretDetectedError,
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
  const positionals = args.filter(a => !a.startsWith('--'));
  if (positionals.length === 0) {
    console.error('Usage: slope memory add <text> [--category=X] [--weight=N] [--allow-secrets]');
    process.exit(1);
  }
  if (positionals.length > 1) {
    console.error(`Error: 'add' takes a single text argument; got ${positionals.length}. Quote the text if it contains spaces.`);
    process.exit(1);
  }
  const text = positionals[0];

  const category = isValidCategory(flags.category ?? '') ? flags.category as MemoryCategory : 'other';
  const weight = flags.weight ? parseInt(flags.weight, 10) : 8;
  const allowSecrets = flags['allow-secrets'] === 'true';

  let mem;
  try {
    mem = addMemory(cwd, text, { category, weight, source: 'manual', allowSecrets });
  } catch (err) {
    if (err instanceof SecretDetectedError) {
      console.error(`Error: ${err.message}`);
      console.error('Pass --allow-secrets if this is intentional.');
      process.exit(1);
    }
    throw err;
  }
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
  const allowSecrets = args.includes('--allow-secrets');
  if (!file) {
    console.error('Usage: slope memory import <file.json> [--allow-secrets]');
    process.exit(1);
  }

  try {
    const imported = JSON.parse(readFileSync(file, 'utf8'));
    const data = loadMemories(cwd);
    const existingIds = new Set(data.memories.map(m => m.id));
    const items: unknown[] = Array.isArray(imported)
      ? imported
      : imported && Array.isArray(imported.memories)
        ? imported.memories
        : [];

    let added = 0;
    let skipped = 0;
    let secretsBlocked = 0;
    for (const item of items) {
      let validated;
      try {
        validated = validateMemory(item);
      } catch (err) {
        skipped++;
        console.error(`  skip: ${(err as Error).message}`);
        continue;
      }
      if (!allowSecrets && detectSecret(validated.text)) {
        secretsBlocked++;
        continue;
      }
      // Regenerate id on collision so import is non-destructive
      while (existingIds.has(validated.id)) {
        validated = { ...validated, id: `${validated.id}-${Math.random().toString(36).slice(2, 6)}` };
      }
      existingIds.add(validated.id);
      data.memories.push(validated);
      added++;
    }

    saveMemories(cwd, data);
    console.log(`\nImported ${added} memories${skipped ? `, skipped ${skipped}` : ''}${secretsBlocked ? `, blocked ${secretsBlocked} suspected-secret` : ''}.\n`);
    if (secretsBlocked > 0 && !allowSecrets) {
      console.error('Re-run with --allow-secrets to include the blocked entries.');
    }
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

  const data = loadMemories(cwd);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
  console.log(`\nExported ${data.memories.length} memories to ${file}\n`);
}
