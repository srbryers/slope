// slope skills — scan and validate repo-local skill metadata.

import { isAbsolute, join } from 'node:path';
import {
  DEFAULT_SKILLS_PATH,
  DEFAULT_SKILL_ROOTS,
  loadSkillRegistry,
  saveSkillRegistry,
  scanSkills,
  validateSkillRegistry,
} from '../../core/index.js';
import type { SlopeConfig } from '../../core/index.js';
import { loadConfig } from '../config.js';

function parseFlag(args: string[], flag: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) return args[i + 1];
    if (args[i].startsWith(`${flag}=`)) return args[i].slice(flag.length + 1);
  }
  return undefined;
}

function parseRepeatable(args: string[], flag: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && i + 1 < args.length) {
      values.push(args[++i]);
    } else if (args[i].startsWith(`${flag}=`)) {
      values.push(args[i].slice(flag.length + 1));
    }
  }
  return values.flatMap(value => value.split(',')).map(value => value.trim()).filter(Boolean);
}

function registryPath(cwd: string, config: SlopeConfig, args: string[]): string {
  const output = parseFlag(args, '--output') ?? config.skillsPath ?? DEFAULT_SKILLS_PATH;
  return isAbsolute(output) ? output : join(cwd, output);
}

function rootsFor(config: SlopeConfig, args: string[]): string[] {
  const roots = parseRepeatable(args, '--root');
  if (roots.length > 0) return roots;
  return config.skillRoots && config.skillRoots.length > 0 ? config.skillRoots : [...DEFAULT_SKILL_ROOTS];
}

function printSkillsHelp(): void {
  console.log(`
slope skills — Repo-local Agent Skills registry

Usage:
  slope skills scan [--root=<path>] [--output=<path>]  Scan skill roots into .slope/skills.json
  slope skills list [--json] [--output=<path>]         List registered skills
  slope skills validate [--output=<path>]              Validate registry metadata and source paths

SLOPE indexes, recommends, and validates skill metadata. It does not execute skills.
`);
}

function skillsScan(args: string[], cwd: string, config: SlopeConfig): void {
  const roots = rootsFor(config, args);
  const output = registryPath(cwd, config, args);
  const { registry, warnings } = scanSkills({ cwd, roots });
  saveSkillRegistry(registry, output);

  console.log(`Scanned ${roots.length} root(s); wrote ${registry.skills.length} skill(s) to ${output}`);
  for (const warning of warnings) {
    console.log(`  [WARN] ${warning}`);
  }
  console.log('');
}

function skillsList(args: string[], cwd: string, config: SlopeConfig): void {
  const output = registryPath(cwd, config, args);
  const registry = loadSkillRegistry(output);
  if (!registry) {
    console.log('No valid skill registry found. Run `slope skills scan` to create .slope/skills.json.\n');
    return;
  }

  if (args.includes('--json')) {
    console.log(JSON.stringify(registry.skills, null, 2));
    return;
  }

  if (registry.skills.length === 0) {
    console.log('Skill registry exists but contains no skills.\n');
    return;
  }

  console.log('\nRegistered Skills\n');
  console.log('| ID | Description | Triggers | Sources |');
  console.log('|----|-------------|----------|---------|');
  for (const skill of registry.skills) {
    const description = skill.description || '—';
    const triggers = skill.triggers.length > 0 ? skill.triggers.join(', ') : '—';
    console.log(`| ${skill.id} | ${description} | ${triggers} | ${skill.sources.length} |`);
  }
  console.log(`\n${registry.skills.length} skill(s) registered.\n`);
}

function skillsValidate(args: string[], cwd: string, config: SlopeConfig): void {
  const output = registryPath(cwd, config, args);
  const registry = loadSkillRegistry(output);
  if (!registry) {
    console.error('No valid skill registry found. Run `slope skills scan` first.');
    process.exit(1);
  }

  const result = validateSkillRegistry(registry, cwd);
  console.log('\nSLOPE Skill Registry Validation\n');
  for (const error of result.errors) {
    console.log(`  \x1b[31m[ERROR]\x1b[0m ${error}`);
  }
  for (const warning of result.warnings) {
    console.log(`  \x1b[33m[WARN]\x1b[0m ${warning}`);
  }

  if (!result.valid) {
    console.log(`\n\x1b[31m${result.errors.length} error(s), ${result.warnings.length} warning(s)\x1b[0m\n`);
    process.exit(1);
  }

  console.log(`\x1b[32mAll ${registry.skills.length} skill(s) valid.\x1b[0m\n`);
}

export async function skillsCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const config = loadConfig(cwd);
  const sub = args[0];
  const rest = args.slice(1);

  if (sub === '--help' || sub === '-h') {
    printSkillsHelp();
    return;
  }

  switch (sub) {
    case 'scan':
      skillsScan(rest, cwd, config);
      break;
    case 'list':
      skillsList(rest, cwd, config);
      break;
    case 'validate':
      skillsValidate(rest, cwd, config);
      break;
    default:
      printSkillsHelp();
      if (sub) process.exit(1);
      break;
  }
}
