// Skill registry — index repo-local Agent Skills metadata without executing skills.

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { SlopeConfig } from './config.js';

export const DEFAULT_SKILLS_PATH = '.slope/skills.json';
export const DEFAULT_SKILL_ROOTS = [
  '.agents/skills',
  '.claude/skills',
  '.pi/skills',
  '.codex/plugins',
  'skills',
] as const;

export type SkillMetadataSource = 'SKILL.md' | 'agents/openai.yaml';

export interface SkillSource {
  path: string;
  directory: string;
  root: string;
  metadata_sources: SkillMetadataSource[];
  openai_metadata_path?: string;
}

export interface SkillDefinition {
  id: string;
  name: string;
  description: string;
  path: string;
  directory: string;
  root: string;
  sources: SkillSource[];
  triggers: string[];
  context_files?: string[];
  version?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  openai?: Record<string, unknown>;
}

export interface SkillRegistryFile {
  version: '1';
  generated_at: string;
  roots: string[];
  skills: SkillDefinition[];
  warnings?: string[];
}

export interface SkillScanResult {
  registry: SkillRegistryFile;
  warnings: string[];
}

export interface SkillRegistryValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

export interface ParsedSkillMarkdown {
  metadata: Record<string, unknown>;
  body: string;
  warnings: string[];
}

const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'coverage']);
const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function resolveSkillRoots(config: SlopeConfig, cwd: string = process.cwd()): string[] {
  const roots = config.skillRoots && config.skillRoots.length > 0
    ? config.skillRoots
    : [...DEFAULT_SKILL_ROOTS];
  return roots.map(root => isAbsolute(root) ? root : join(cwd, root));
}

export function parseSkillMarkdown(content: string): ParsedSkillMarkdown {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    return {
      metadata: {},
      body: content,
      warnings: ['SKILL.md has no YAML frontmatter'],
    };
  }

  try {
    const parsed = parseYaml(match[1]) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return {
        metadata: parsed as Record<string, unknown>,
        body: content.slice(match[0].length),
        warnings: [],
      };
    }
    return {
      metadata: {},
      body: content.slice(match[0].length),
      warnings: ['SKILL.md frontmatter is not an object'],
    };
  } catch (err) {
    return {
      metadata: {},
      body: content.slice(match[0].length),
      warnings: [`Failed to parse SKILL.md frontmatter: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

export function scanSkills(opts: {
  cwd?: string;
  roots?: string[];
  generatedAt?: string;
} = {}): SkillScanResult {
  const cwd = opts.cwd ?? process.cwd();
  const roots = opts.roots ?? [...DEFAULT_SKILL_ROOTS];
  const warnings: string[] = [];
  const byId = new Map<string, SkillDefinition>();

  for (const configuredRoot of roots) {
    const absoluteRoot = isAbsolute(configuredRoot) ? configuredRoot : join(cwd, configuredRoot);
    if (!existsSync(absoluteRoot)) continue;

    for (const skillPath of findSkillMarkdownFiles(absoluteRoot)) {
      const scanned = readSkill(skillPath, absoluteRoot, cwd);
      warnings.push(...scanned.warnings);
      if (!scanned.skill) continue;

      const existing = byId.get(scanned.skill.id);
      if (!existing) {
        byId.set(scanned.skill.id, scanned.skill);
        continue;
      }

      mergeSkill(existing, scanned.skill);
      warnings.push(`Merged duplicate skill id "${scanned.skill.id}" from ${scanned.skill.path}`);
    }
  }

  const skills = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id));
  const registry: SkillRegistryFile = {
    version: '1',
    generated_at: opts.generatedAt ?? new Date().toISOString(),
    roots,
    skills,
    ...(warnings.length > 0 ? { warnings } : {}),
  };

  return { registry, warnings };
}

export function validateSkillRegistry(registry: SkillRegistryFile, cwd: string = process.cwd()): SkillRegistryValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (registry.version !== '1') {
    errors.push(`Unsupported skills registry version: ${registry.version}`);
  }
  if (!Array.isArray(registry.skills)) {
    errors.push('skills registry must contain a skills array');
    return { valid: false, errors, warnings };
  }

  const seen = new Set<string>();
  for (const skill of registry.skills) {
    if (!skill.id || typeof skill.id !== 'string') {
      errors.push('Skill entry is missing a string id');
      continue;
    }
    if (seen.has(skill.id)) {
      errors.push(`Duplicate skill id: "${skill.id}"`);
    }
    seen.add(skill.id);

    if (!skill.name || typeof skill.name !== 'string') {
      errors.push(`Skill "${skill.id}" is missing a string name`);
    }
    if (!skill.description || typeof skill.description !== 'string') {
      warnings.push(`Skill "${skill.id}" has no description`);
    }
    if (!Array.isArray(skill.triggers)) {
      errors.push(`Skill "${skill.id}" triggers must be an array`);
    } else if (skill.triggers.length === 0) {
      warnings.push(`Skill "${skill.id}" has no triggers`);
    } else if (skill.triggers.some(trigger => typeof trigger !== 'string')) {
      errors.push(`Skill "${skill.id}" triggers must be strings`);
    }

    const paths = new Set<string>([skill.path, ...(skill.sources ?? []).map(source => source.path)]);
    for (const path of paths) {
      if (!path || typeof path !== 'string') {
        errors.push(`Skill "${skill.id}" has an invalid source path`);
        continue;
      }
      if (!existsSync(join(cwd, path))) {
        errors.push(`Skill "${skill.id}" source not found: ${path}`);
      }
    }
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function loadSkillRegistry(registryPath: string): SkillRegistryFile | null {
  if (!existsSync(registryPath)) return null;
  try {
    const raw = JSON.parse(readFileSync(registryPath, 'utf8')) as unknown;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const candidate = raw as Partial<SkillRegistryFile>;
    if (candidate.version !== '1' || !Array.isArray(candidate.roots) || !Array.isArray(candidate.skills)) {
      return null;
    }
    return raw as SkillRegistryFile;
  } catch {
    return null;
  }
}

export function saveSkillRegistry(registry: SkillRegistryFile, registryPath: string): string {
  const dir = dirname(registryPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(registryPath, JSON.stringify(registry, null, 2) + '\n');
  return registryPath;
}

export function skillIds(registry: SkillRegistryFile | null): Set<string> {
  const skills = Array.isArray(registry?.skills) ? registry.skills : [];
  return new Set(skills.map(skill => skill.id));
}

function readSkill(skillPath: string, absoluteRoot: string, cwd: string): { skill: SkillDefinition | null; warnings: string[] } {
  const warnings: string[] = [];
  const relativePath = toRelativePath(cwd, skillPath);
  const directory = toRelativePath(cwd, dirname(skillPath));
  const root = toRelativePath(cwd, absoluteRoot);
  const content = readFileSync(skillPath, 'utf8');
  const parsed = parseSkillMarkdown(content);
  warnings.push(...parsed.warnings.map(warning => `${relativePath}: ${warning}`));

  const openai = readOpenAiMetadata(dirname(skillPath), cwd);
  warnings.push(...openai.warnings.map(warning => `${relativePath}: ${warning}`));

  const name = firstString(parsed.metadata.name, parsed.metadata.title, openai.metadata?.name, openai.metadata?.title)
    ?? basename(dirname(skillPath));
  const id = normalizeSkillId(firstString(parsed.metadata.id, openai.metadata?.id, name) ?? basename(dirname(skillPath)));
  const description = firstString(parsed.metadata.description, openai.metadata?.description, firstMarkdownParagraph(parsed.body)) ?? '';
  const triggers = uniqueStrings([
    ...toStringArray(parsed.metadata.triggers),
    ...toStringArray(openai.metadata?.triggers),
  ]);
  const contextFiles = uniqueStrings(toStringArray(parsed.metadata.context_files));
  const tags = uniqueStrings([...toStringArray(parsed.metadata.tags), ...toStringArray(openai.metadata?.tags)]);
  const version = firstString(parsed.metadata.version, openai.metadata?.version);
  const sources: SkillSource[] = [{
    path: relativePath,
    directory,
    root,
    metadata_sources: openai.metadata ? ['SKILL.md', 'agents/openai.yaml'] : ['SKILL.md'],
    ...(openai.path ? { openai_metadata_path: openai.path } : {}),
  }];

  return {
    skill: {
      id,
      name,
      description,
      path: relativePath,
      directory,
      root,
      sources,
      triggers,
      ...(contextFiles.length > 0 ? { context_files: contextFiles } : {}),
      ...(version ? { version } : {}),
      ...(tags.length > 0 ? { tags } : {}),
      ...(Object.keys(parsed.metadata).length > 0 ? { metadata: parsed.metadata } : {}),
      ...(openai.metadata ? { openai: openai.metadata } : {}),
    },
    warnings,
  };
}

function readOpenAiMetadata(skillDir: string, cwd: string): { metadata?: Record<string, unknown>; path?: string; warnings: string[] } {
  const openaiPath = join(skillDir, 'agents', 'openai.yaml');
  if (!existsSync(openaiPath)) return { warnings: [] };

  try {
    const parsed = parseYaml(readFileSync(openaiPath, 'utf8')) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { metadata: parsed as Record<string, unknown>, path: toRelativePath(cwd, openaiPath), warnings: [] };
    }
    return { path: toRelativePath(cwd, openaiPath), warnings: ['agents/openai.yaml metadata is not an object'] };
  } catch (err) {
    return {
      path: toRelativePath(cwd, openaiPath),
      warnings: [`Failed to parse agents/openai.yaml: ${err instanceof Error ? err.message : String(err)}`],
    };
  }
}

function findSkillMarkdownFiles(root: string): string[] {
  const found: string[] = [];
  const visit = (dir: string): void => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }

    for (const entry of entries.sort()) {
      if (SKIP_DIRS.has(entry)) continue;
      const fullPath = join(dir, entry);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.isDirectory()) {
        visit(fullPath);
      } else if (entry === 'SKILL.md') {
        found.push(fullPath);
      }
    }
  };
  visit(root);
  return found.sort();
}

function mergeSkill(target: SkillDefinition, source: SkillDefinition): void {
  target.sources.push(...source.sources);
  target.triggers = uniqueStrings([...target.triggers, ...source.triggers]);
  if (!target.description && source.description) target.description = source.description;
  if (!target.version && source.version) target.version = source.version;
  if (source.context_files) {
    target.context_files = uniqueStrings([...(target.context_files ?? []), ...source.context_files]);
  }
  if (source.tags) {
    target.tags = uniqueStrings([...(target.tags ?? []), ...source.tags]);
  }
}

function normalizeSkillId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'skill';
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim().length > 0) return value.trim();
  }
  return undefined;
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map(item => item.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function firstMarkdownParagraph(body: string): string | undefined {
  for (const line of body.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('```')) continue;
    return trimmed.replace(/^[-*]\s+/, '');
  }
  return undefined;
}

function toRelativePath(cwd: string, path: string): string {
  const rel = relative(cwd, path);
  return rel === '' ? '.' : rel.split('\\').join('/');
}
