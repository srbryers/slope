// Flow tracking — map user-facing workflows to code paths.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { execSync } from 'node:child_process';

/** A single step in a user flow */
export interface FlowStep {
  name: string;
  description: string;
  file_paths: string[];
  notes?: string;
}

/** A complete flow definition mapping a user workflow to code */
export interface FlowDefinition {
  id: string;
  title: string;
  description: string;
  entry_point: string;
  steps: FlowStep[];
  files: string[];
  tags: string[];
  last_verified_sha: string;
  last_verified_at: string;
}

/** Top-level flows file schema */
export interface FlowsFile {
  version: '1';
  last_generated: string;
  flows: FlowDefinition[];
}

/** Result of flow validation */
export interface FlowValidationResult {
  errors: string[];
  warnings: string[];
}

/** Result of staleness check for a single flow */
export interface FlowStalenessResult {
  stale: boolean;
  changedFiles: string[];
}

/** Parse and validate a flows JSON string */
export function parseFlows(json: string): FlowsFile {
  const raw = JSON.parse(json);

  if (!raw || typeof raw !== 'object') {
    throw new Error('flows.json must be an object');
  }
  if (raw.version !== '1') {
    throw new Error(`Unsupported flows version: ${raw.version}`);
  }
  if (!Array.isArray(raw.flows)) {
    throw new Error('flows.json must have a "flows" array');
  }

  for (const flow of raw.flows) {
    if (!flow.id || typeof flow.id !== 'string') {
      throw new Error('Each flow must have a string "id"');
    }
    if (!flow.title || typeof flow.title !== 'string') {
      throw new Error(`Flow "${flow.id}": must have a string "title"`);
    }
    if (!Array.isArray(flow.steps)) {
      throw new Error(`Flow "${flow.id}": must have a "steps" array`);
    }
    if (!Array.isArray(flow.files)) {
      throw new Error(`Flow "${flow.id}": must have a "files" array`);
    }
    if (!Array.isArray(flow.tags)) {
      throw new Error(`Flow "${flow.id}": must have a "tags" array`);
    }
  }

  return raw as FlowsFile;
}

/** Validate flows against the filesystem — check file paths resolve, detect issues */
export function validateFlows(flows: FlowsFile, cwd: string): FlowValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seenIds = new Set<string>();

  for (const flow of flows.flows) {
    // Duplicate ID check
    if (seenIds.has(flow.id)) {
      errors.push(`Duplicate flow ID: "${flow.id}"`);
    }
    seenIds.add(flow.id);

    // Check top-level files exist
    const missingFiles: string[] = [];
    for (const filePath of flow.files) {
      if (!resolveFileExists(filePath, cwd)) {
        missingFiles.push(filePath);
      }
    }
    if (missingFiles.length > 0) {
      errors.push(`Flow "${flow.id}": ${missingFiles.length} file(s) not found: ${missingFiles.join(', ')}`);
    }

    // Check step file_paths exist
    for (const step of flow.steps) {
      for (const fp of step.file_paths) {
        if (!resolveFileExists(fp, cwd)) {
          warnings.push(`Flow "${flow.id}" step "${step.name}": file not found: ${fp}`);
        }
      }
    }

    // Check for orphaned step paths not in files list
    const filesSet = new Set(flow.files);
    for (const step of flow.steps) {
      for (const fp of step.file_paths) {
        if (!filesSet.has(fp)) {
          warnings.push(`Flow "${flow.id}" step "${step.name}": "${fp}" not in top-level files list`);
        }
      }
    }

    // Empty checks
    if (flow.steps.length === 0) {
      warnings.push(`Flow "${flow.id}": has no steps`);
    }
    if (flow.files.length === 0) {
      warnings.push(`Flow "${flow.id}": has no files`);
    }
  }

  return { errors, warnings };
}

/** Check if files in a flow have changed since last_verified_sha */
export function checkFlowStaleness(
  flow: FlowDefinition,
  currentSha: string,
  cwd: string,
): FlowStalenessResult {
  if (!flow.last_verified_sha || flow.last_verified_sha === currentSha) {
    return { stale: false, changedFiles: [] };
  }

  try {
    const output = execSync(
      `git diff --name-only ${flow.last_verified_sha}..${currentSha} 2>/dev/null`,
      { cwd, encoding: 'utf8', timeout: 10000 },
    ).trim();

    if (!output) {
      return { stale: false, changedFiles: [] };
    }

    const changedInRepo = new Set(output.split('\n').filter(Boolean));
    const changedFiles = flow.files.filter(f => changedInRepo.has(f));

    return {
      stale: changedFiles.length > 0,
      changedFiles,
    };
  } catch {
    // git command failed — can't determine staleness, assume stale
    return { stale: true, changedFiles: [] };
  }
}

/** Load and parse flows from a file path. Returns null if file doesn't exist. */
export function loadFlows(flowsPath: string): FlowsFile | null {
  if (!existsSync(flowsPath)) {
    return null;
  }
  try {
    const content = readFileSync(flowsPath, 'utf8');
    return parseFlows(content);
  } catch {
    return null;
  }
}

// --- Helpers ---

function resolveFileExists(filePath: string, cwd: string): boolean {
  return existsSync(join(cwd, filePath));
}
