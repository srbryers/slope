// SLOPE — Workflow Loader
// Loads workflow definitions from project and built-in locations.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseWorkflow } from './workflow.js';
import type { WorkflowDefinition } from './workflow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Summary of an available workflow */
export interface WorkflowSummary {
  name: string;
  description?: string;
  version: string;
  source: 'project' | 'built-in';
  path: string;
}

/** Resolve the built-in workflows directory (handles both src/ and dist/) */
function builtinDir(): string {
  // In src/core/ → ../core/workflows
  // In dist/core/ → ../../src/core/workflows
  const srcPath = join(__dirname, 'workflows');
  if (existsSync(srcPath)) return srcPath;

  // If running from dist/, walk up to find src/
  const fromDist = join(__dirname, '..', '..', 'src', 'core', 'workflows');
  if (existsSync(fromDist)) return fromDist;

  return srcPath; // fallback
}

/** Resolve the project workflows directory */
function projectDir(cwd: string): string {
  return join(cwd, '.slope', 'workflows');
}

/**
 * Load a workflow by name.
 * Search order: project `.slope/workflows/<name>.yaml` → built-in defaults.
 * Throws if not found.
 */
export function loadWorkflow(name: string, cwd: string): WorkflowDefinition {
  // Normalize: strip .yaml if provided
  const baseName = name.replace(/\.yaml$/, '');
  const fileName = `${baseName}.yaml`;

  // 1. Project directory
  const projectPath = join(projectDir(cwd), fileName);
  if (existsSync(projectPath)) {
    return parseYamlFile(projectPath);
  }

  // 2. Built-in defaults
  const builtinPath = join(builtinDir(), fileName);
  if (existsSync(builtinPath)) {
    return parseYamlFile(builtinPath);
  }

  throw new Error(
    `Workflow "${baseName}" not found. Searched:\n` +
    `  - ${projectPath}\n` +
    `  - ${builtinPath}\n` +
    `Use "slope workflow list" to see available workflows.`,
  );
}

/**
 * List all available workflows (project + built-in).
 * Project workflows override built-in ones with the same name.
 */
export function listWorkflows(cwd: string): WorkflowSummary[] {
  const summaries = new Map<string, WorkflowSummary>();

  // Built-in workflows (loaded first, can be overridden)
  const builtIn = builtinDir();
  if (existsSync(builtIn)) {
    for (const file of listYamlFiles(builtIn)) {
      const name = basename(file, '.yaml');
      try {
        const def = parseYamlFile(join(builtIn, file));
        summaries.set(name, {
          name: def.name,
          description: def.description,
          version: def.version,
          source: 'built-in',
          path: join(builtIn, file),
        });
      } catch {
        // Skip invalid built-in files
      }
    }
  }

  // Project workflows (override built-in)
  const project = projectDir(cwd);
  if (existsSync(project)) {
    for (const file of listYamlFiles(project)) {
      const name = basename(file, '.yaml');
      try {
        const def = parseYamlFile(join(project, file));
        summaries.set(name, {
          name: def.name,
          description: def.description,
          version: def.version,
          source: 'project',
          path: join(project, file),
        });
      } catch {
        // Skip invalid project files
      }
    }
  }

  return [...summaries.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// --- Helpers ---

function parseYamlFile(filePath: string): WorkflowDefinition {
  const content = readFileSync(filePath, 'utf8');
  return parseWorkflow(content);
}

function listYamlFiles(dir: string): string[] {
  try {
    return readdirSync(dir).filter(f => f.endsWith('.yaml'));
  } catch {
    return [];
  }
}
