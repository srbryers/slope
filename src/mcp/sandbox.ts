/**
 * SLOPE sandbox — runs agent-written JS in a node:vm context
 * with the full @slope-dev/slope API + filesystem helpers pre-injected.
 */
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import * as core from '../core/index.js';

export interface SandboxResult {
  result: unknown;
  logs: string[];
}

/**
 * Resolve and validate that a path stays within the cwd boundary.
 * Throws if the resolved path escapes the cwd.
 */
function safePath(cwd: string, p: string): string {
  const resolved = path.resolve(cwd, p);
  if (resolved !== cwd && !resolved.startsWith(cwd + path.sep)) {
    throw new Error(`Path escape blocked: "${p}" resolves outside project root`);
  }
  return resolved;
}

/**
 * Build filesystem helpers scoped to cwd.
 */
function buildFsHelpers(cwd: string) {
  const loadConfig = (): core.SlopeConfig => {
    return core.loadConfig(cwd);
  };

  const loadScorecards = (): core.GolfScorecard[] => {
    const config = loadConfig();
    return core.loadScorecards(config, cwd);
  };

  const loadCommonIssues = (): unknown => {
    const config = loadConfig();
    const filePath = safePath(cwd, config.commonIssuesPath);
    if (!fs.existsSync(filePath)) return { recurring_patterns: [] };
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  };

  const loadSessions = (): unknown[] => {
    const config = loadConfig();
    const filePath = safePath(cwd, config.sessionsPath);
    if (!fs.existsSync(filePath)) return [];
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  };

  const saveScorecard = (card: core.GolfScorecard): string => {
    const config = loadConfig();
    const dir = safePath(cwd, config.scorecardDir);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const filename = `sprint-${card.sprint_number}.json`;
    const filePath = path.join(dir, filename);
    // Double-check the final path is safe
    safePath(cwd, path.join(config.scorecardDir, filename));
    fs.writeFileSync(filePath, JSON.stringify(card, null, 2) + '\n');
    return filePath;
  };

  const loadRoadmap = (): unknown => {
    const config = loadConfig();
    const roadmapPath = config.roadmapPath;
    const resolved = safePath(cwd, roadmapPath);
    if (!fs.existsSync(resolved)) return null;
    try {
      const raw = JSON.parse(fs.readFileSync(resolved, 'utf8'));
      const { roadmap } = core.parseRoadmap(raw);
      return roadmap;
    } catch {
      return null;
    }
  };

  const readFile = (p: string): string => {
    const resolved = safePath(cwd, p);
    return fs.readFileSync(resolved, 'utf8');
  };

  const writeFile = (p: string, content: string): void => {
    const resolved = safePath(cwd, p);
    const dir = path.dirname(resolved);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(resolved, content);
  };

  const listFiles = (dir?: string, pattern?: string): string[] => {
    const resolved = safePath(cwd, dir ?? '.');
    if (!fs.existsSync(resolved)) return [];
    let entries = fs.readdirSync(resolved);
    if (pattern) {
      // Convert glob pattern to regex (supports basic * patterns)
      const regexStr = '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
      const regex = new RegExp(regexStr);
      entries = entries.filter((e) => regex.test(e));
    }
    return entries.sort();
  };

  return { loadConfig, loadScorecards, loadCommonIssues, loadSessions, loadRoadmap, saveScorecard, readFile, writeFile, listFiles };
}

/**
 * Run agent-written JS code in a sandboxed vm context.
 *
 * The context includes all @slope-dev/slope exports as top-level names,
 * all constants, and filesystem helpers pre-bound to `cwd`.
 *
 * Code is wrapped in an async IIFE so `return` works naturally.
 * Console output is captured to a logs buffer.
 */
export async function runInSandbox(code: string, cwd: string): Promise<SandboxResult> {
  const logs: string[] = [];

  // Build console proxy
  const sandboxConsole = {
    log: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
    error: (...args: unknown[]) => logs.push('[error] ' + args.map(String).join(' ')),
    warn: (...args: unknown[]) => logs.push('[warn] ' + args.map(String).join(' ')),
    info: (...args: unknown[]) => logs.push(args.map(String).join(' ')),
  };

  // Build context with all core exports + fs helpers + constants
  const fsHelpers = buildFsHelpers(cwd);
  const context: Record<string, unknown> = {
    ...core,
    ...fsHelpers,
    console: sandboxConsole,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    RegExp,
    Map,
    Set,
    Promise,
    Error,
    TypeError,
    RangeError,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    undefined,
    NaN,
    Infinity,
  };

  vm.createContext(context);

  const wrappedCode = `(async () => { ${code} })()`;

  const script = new vm.Script(wrappedCode, { filename: 'slope-execute.js' });
  const rawResult = await script.runInContext(context, { timeout: 30_000 });

  return { result: rawResult, logs };
}
