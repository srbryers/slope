/**
 * slope review run — Generate review prompts for subagent-based PR reviews.
 *
 * Prepares isolated review context (PR diff + changed files) and outputs
 * structured prompts that can be used with Claude Code's Agent tool.
 *
 * Usage:
 *   slope review run [--pr=N] [--type=architect|code|both] [--sprint=N] [--json]
 */

import { execSync } from 'node:child_process';
import { loadConfig, detectLatestSprint } from '../../core/index.js';

export interface ReviewPrompt {
  type: 'architect' | 'code';
  prompt: string;
  context: {
    pr_number?: number;
    sprint?: number;
    changed_files: string[];
    diff_lines: number;
  };
}

function getPrDiff(prNumber?: number): { diff: string; files: string[]; prNum: number } | null {
  try {
    const prArg = prNumber ? String(prNumber) : '';
    const diff = execSync(`gh pr diff ${prArg}`, { encoding: 'utf8', timeout: 30000 }).trim();
    const filesRaw = execSync(`gh pr diff ${prArg} --name-only`, { encoding: 'utf8', timeout: 10000 }).trim();
    const files = filesRaw.split('\n').filter(Boolean);
    const num = prNumber ?? parseInt(execSync(`gh pr view --json number -q .number`, { encoding: 'utf8', timeout: 10000 }).trim(), 10);
    return { diff, files, prNum: num };
  } catch {
    return null;
  }
}

function buildArchitectPrompt(diff: string, files: string[], sprint?: number): string {
  return [
    'You are performing an ARCHITECT REVIEW of a pull request.',
    'You have a clean context — no prior implementation knowledge.',
    '',
    '## Review Criteria',
    '1. Does the design match codebase patterns? Check for duplication of existing infrastructure.',
    '2. Are dependencies correct and ordering optimal?',
    '3. Are there scope gaps or underscoped complexity?',
    '4. Does it introduce unnecessary complexity?',
    '5. Are there security concerns (injection, auth bypass, data exposure)?',
    '',
    '## Changed Files',
    files.map(f => `- ${f}`).join('\n'),
    '',
    '## Diff',
    '```diff',
    diff.length > 50000 ? diff.slice(0, 50000) + '\n... (truncated)' : diff,
    '```',
    '',
    '## Output Format',
    'For each finding, output:',
    '```',
    `slope review findings add --type=architect${sprint ? ` --sprint=${sprint}` : ''} --severity=<minor|moderate|major|critical> --description="<finding>"`,
    '```',
    'If no issues found, say "No architect findings."',
  ].join('\n');
}

function buildCodePrompt(diff: string, files: string[], sprint?: number): string {
  return [
    'You are performing a CODE REVIEW of a pull request.',
    'You have a clean context — no prior implementation knowledge.',
    '',
    '## Review Criteria',
    '1. Correctness: Does the code do what it claims? Edge cases?',
    '2. Error handling: Are errors caught and handled appropriately?',
    '3. Test coverage: Are new paths tested? Any gaps?',
    '4. Code quality: Naming, structure, consistency with existing patterns.',
    '5. Performance: Any obvious bottlenecks or N+1 patterns?',
    '',
    '## Changed Files',
    files.map(f => `- ${f}`).join('\n'),
    '',
    '## Diff',
    '```diff',
    diff.length > 50000 ? diff.slice(0, 50000) + '\n... (truncated)' : diff,
    '```',
    '',
    '## Output Format',
    'For each finding, output:',
    '```',
    `slope review findings add --type=code${sprint ? ` --sprint=${sprint}` : ''} --severity=<minor|moderate|major|critical> --description="<finding>"`,
    '```',
    'If no issues found, say "No code findings."',
  ].join('\n');
}

export async function reviewRunCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const flags: Record<string, string> = {};
  for (const arg of args) {
    const match = arg.match(/^--(\w[\w-]*)(?:=(.+))?$/);
    if (match) flags[match[1]] = match[2] ?? 'true';
  }

  const prNumber = flags.pr ? parseInt(flags.pr, 10) : undefined;
  const reviewType = (flags.type ?? 'both') as 'architect' | 'code' | 'both';
  const json = flags.json === 'true';

  // Detect sprint
  let sprint: number | undefined;
  if (flags.sprint) {
    sprint = parseInt(flags.sprint, 10);
  } else {
    try {
      const config = loadConfig(cwd);
      sprint = config.currentSprint ?? detectLatestSprint(config, cwd);
    } catch { /* no config */ }
  }

  // Get PR diff
  const pr = getPrDiff(prNumber);
  if (!pr) {
    console.error('Could not get PR diff. Ensure `gh` CLI is installed and a PR exists for the current branch.');
    process.exit(1);
  }

  const diffLines = pr.diff.split('\n').length;
  const prompts: ReviewPrompt[] = [];

  if (reviewType === 'architect' || reviewType === 'both') {
    prompts.push({
      type: 'architect',
      prompt: buildArchitectPrompt(pr.diff, pr.files, sprint),
      context: { pr_number: pr.prNum, sprint, changed_files: pr.files, diff_lines: diffLines },
    });
  }

  if (reviewType === 'code' || reviewType === 'both') {
    prompts.push({
      type: 'code',
      prompt: buildCodePrompt(pr.diff, pr.files, sprint),
      context: { pr_number: pr.prNum, sprint, changed_files: pr.files, diff_lines: diffLines },
    });
  }

  if (json) {
    console.log(JSON.stringify(prompts, null, 2));
    return;
  }

  // Output prompts for agent consumption
  console.log(`\n=== Review Prompts for PR #${pr.prNum} ===`);
  console.log(`Sprint: ${sprint ?? '?'} | Files: ${pr.files.length} | Diff: ${diffLines} lines\n`);

  for (const p of prompts) {
    console.log(`--- ${p.type.toUpperCase()} REVIEW PROMPT ---`);
    console.log('Use this with Claude Code\'s Agent tool (model: "haiku") for an isolated review:\n');
    console.log(p.prompt);
    console.log('');
  }

  console.log('To run both reviews as subagents, use:');
  console.log('  slope review run --json | # pass to Agent tool prompts');
  console.log('');
}
