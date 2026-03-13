import { writeFileSync, mkdirSync, existsSync, cpSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { createConfig } from '../config.js';
import { saveHooksConfig } from '../hooks-config.js';
import { resolveMetaphor } from '../metaphor.js';
import { detectPackageManager, createVision, analyzeStack, SLOPE_BIN_PREAMBLE, writeOrUpdateManagedScript } from '../../core/index.js';
import type { StackProfile } from '../../core/analyzers/types.js';
import type { MetaphorDefinition } from '../../core/index.js';
import {
  generateProjectContext,
  generateSprintChecklist,
  generateCommitDiscipline,
  generateReviewLoop,
  generateCodebaseContextRule,
  generateCursorSprintChecklist,
  generateCursorCommitDiscipline,
  generateCursorReviewLoop,
  generateCursorCodebaseContextRule,
  generateCursorrules,
  generateAgentsMd,
  generateOpenCodePlugin,
  generateGenericChecklist,
} from '../template-generator.js';
import { getAdapter, ADAPTER_PRIORITY } from '../../core/harness.js';
import type { HarnessId } from '../../core/harness.js';

// Side-effect imports: ensure all adapters are registered for detectPlatforms()
import '../../core/adapters/claude-code.js';
import '../../core/adapters/cursor.js';
import '../../core/adapters/windsurf.js';
import '../../core/adapters/cline.js';
import '../../core/adapters/ob1.js';
import '../../core/adapters/generic.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const EXAMPLE_SCORECARD = {
  sprint_number: 1,
  theme: 'Example Sprint',
  par: 3,
  slope: 0,
  score: 3,
  score_label: 'par',
  date: new Date().toISOString().split('T')[0],
  shots: [
    {
      ticket_key: 'S1-1',
      title: 'Set up project',
      club: 'short_iron',
      result: 'green',
      hazards: [],
      notes: 'Clean setup',
    },
    {
      ticket_key: 'S1-2',
      title: 'Add core feature',
      club: 'short_iron',
      result: 'in_the_hole',
      hazards: [],
    },
    {
      ticket_key: 'S1-3',
      title: 'Write tests',
      club: 'wedge',
      result: 'green',
      hazards: [{ type: 'rough', description: 'Flaky test environment' }],
    },
  ],
  conditions: [],
  special_plays: [],
  stats: {
    fairways_hit: 3,
    fairways_total: 3,
    greens_in_regulation: 3,
    greens_total: 3,
    putts: 0,
    penalties: 0,
    hazards_hit: 1,
    hazard_penalties: 0,
    miss_directions: { long: 0, short: 0, left: 0, right: 0 },
  },
  yardage_book_updates: [],
  bunker_locations: [],
  course_management_notes: ['This is an example scorecard — replace with your own sprint data.'],
};

const EXAMPLE_COMMON_ISSUES = {
  recurring_patterns: [
    {
      id: 1,
      title: 'Example pattern',
      category: 'general',
      sprints_hit: [1],
      gotcha_refs: [],
      description: 'This is an example recurring pattern. Replace with your own.',
      prevention: 'Add your prevention strategy here.',
    },
  ],
};

export const STARTER_ROADMAP = {
  name: 'Project Roadmap',
  description: 'Replace this with your project roadmap. Run "slope roadmap validate" to check.',
  phases: [
    { name: 'Phase 1', sprints: [1] },
  ],
  sprints: [
    {
      id: 1,
      theme: 'Getting Started',
      par: 3,
      slope: 0,
      type: 'feature',
      tickets: [
        { key: 'S1-1', title: 'Set up project', club: 'short_iron', complexity: 'standard' },
        { key: 'S1-2', title: 'Add core feature', club: 'short_iron', complexity: 'standard' },
        { key: 'S1-3', title: 'Write tests', club: 'wedge', complexity: 'small' },
      ],
    },
  ],
};

/** Init supports all harness adapters plus OpenCode (template-only, no adapter) */
export type InitProvider = HarnessId | 'opencode';

export function detectProvidersFromArgs(args: string[]): InitProvider[] {
  const providers: InitProvider[] = [];
  if (args.includes('--claude-code')) providers.push('claude-code');
  if (args.includes('--cursor')) providers.push('cursor');
  if (args.includes('--windsurf')) providers.push('windsurf');
  if (args.includes('--cline')) providers.push('cline');
  if (args.includes('--opencode')) providers.push('opencode');
  if (args.includes('--generic')) providers.push('generic');
  if (args.includes('--ob1')) providers.push('ob1');
  // Unified --harness=<id> flag
  const harnessArg = args.find(a => a.startsWith('--harness='));
  if (harnessArg) {
    const id = harnessArg.slice('--harness='.length);
    if (id && !providers.includes(id)) providers.push(id);
  }
  // --all includes all real harnesses + opencode; generic is a fallback, not included
  if (args.includes('--all')) return ['claude-code', 'cursor', 'windsurf', 'opencode', 'ob1'];
  return providers;
}

/** Detect platforms present in the project directory using the adapter framework */
export function detectPlatforms(cwd: string): InitProvider[] {
  const detected: InitProvider[] = [];
  // Check all registered adapters via ADAPTER_PRIORITY
  for (const id of ADAPTER_PRIORITY) {
    if (id === 'generic') continue;
    const a = getAdapter(id);
    if (a?.detect(cwd)) detected.push(id);
  }
  // OpenCode: no adapter, but has init templates
  if (existsSync(join(cwd, 'opencode.json')) || existsSync(join(cwd, 'AGENTS.md'))) {
    detected.push('opencode');
  }
  return detected;
}

/** Recommend guards based on detected stack profile */
function getRecommendedGuards(stack: StackProfile, cwd: string): string[] {
  const recommended: string[] = [];

  // TypeScript/JS projects
  if (stack.primaryLanguage === 'TypeScript' || stack.primaryLanguage === 'JavaScript') {
    recommended.push('typecheck', 'test');
    if (stack.frameworks.includes('react') || stack.frameworks.includes('next')) {
      recommended.push('jsx-a11y');
    }
  }

  // Python projects
  if (stack.primaryLanguage === 'Python') {
    recommended.push('pytest', 'ruff');
  }

  // Databases
  if (stack.frameworks.includes('prisma') || stack.frameworks.includes('drizzle')) {
    recommended.push('migration', 'schema-guard');
  }

  // CI detected
  if (existsSync(join(cwd, '.github/workflows'))) {
    recommended.push('ci-check');
  }

  return [...new Set(recommended)];
}

/** Ensure .slope/ is in .gitignore. Idempotent — skips if already present. */
function ensureGitignore(cwd: string): void {
  const gitignorePath = join(cwd, '.gitignore');
  let content = '';
  if (existsSync(gitignorePath)) {
    content = readFileSync(gitignorePath, 'utf8');
    // Check if .slope/ or .slope is already ignored
    if (/^\/?\.slope\/?$/m.test(content)) return;
  }

  const entry = '\n# SLOPE local state (sessions, handoffs, sprint-state, DB)\n.slope/\n';
  writeFileSync(gitignorePath, content + entry);
  console.log('  Added .slope/ to .gitignore');
}

function getTemplatesRoot(): string {
  return join(__dirname, '..', '..', '..', '..', 'templates');
}

function installClaudeCodeTemplates(cwd: string, metaphor: MetaphorDefinition): void {
  const rulesDir = join(cwd, '.claude', 'rules');
  const hooksDir = join(cwd, '.claude', 'hooks');

  mkdirSync(rulesDir, { recursive: true });
  mkdirSync(hooksDir, { recursive: true });

  // Generate metaphor-aware rules
  const ruleGenerators: Record<string, string> = {
    'sprint-checklist.md': generateSprintChecklist(metaphor),
    'commit-discipline.md': generateCommitDiscipline(metaphor),
    'review-loop.md': generateReviewLoop(),
    'codebase-context.md': generateCodebaseContextRule(),
  };
  for (const [file, content] of Object.entries(ruleGenerators)) {
    const dest = join(rulesDir, file);
    if (!existsSync(dest)) {
      writeFileSync(dest, content);
      console.log(`  Created ${dest}`);
    }
  }

  // Copy static hook files (not metaphor-dependent)
  const templatesRoot = join(getTemplatesRoot(), 'claude-code');
  const hookFiles = ['pre-merge-check.sh'];
  for (const file of hookFiles) {
    const src = join(templatesRoot, 'hooks', file);
    const dest = join(hooksDir, file);
    if (existsSync(src) && !existsSync(dest)) {
      cpSync(src, dest);
      console.log(`  Created ${dest}`);
    }
  }

  // Generate CLAUDE.md
  const claudeMdDest = join(cwd, 'CLAUDE.md');
  if (!existsSync(claudeMdDest)) {
    writeFileSync(claudeMdDest, generateProjectContext(metaphor));
    console.log(`  Created ${claudeMdDest}`);
  }

  console.log('\n  Claude Code templates installed to .claude/rules/ and .claude/hooks/');
}

function installCursorTemplates(cwd: string, metaphor: MetaphorDefinition): void {
  const rulesDir = join(cwd, '.cursor', 'rules');
  mkdirSync(rulesDir, { recursive: true });

  // Generate metaphor-aware Cursor rules
  const ruleGenerators: Record<string, string> = {
    'slope-sprint-checklist.mdc': generateCursorSprintChecklist(metaphor),
    'slope-commit-discipline.mdc': generateCursorCommitDiscipline(metaphor),
    'slope-review-loop.mdc': generateCursorReviewLoop(),
    'slope-codebase-context.mdc': generateCursorCodebaseContextRule(),
  };
  for (const [file, content] of Object.entries(ruleGenerators)) {
    const dest = join(rulesDir, file);
    if (!existsSync(dest)) {
      writeFileSync(dest, content);
      console.log(`  Created ${dest}`);
    }
  }

  // Generate .cursorrules (project root context file)
  const cursorrulesDest = join(cwd, '.cursorrules');
  if (!existsSync(cursorrulesDest)) {
    writeFileSync(cursorrulesDest, generateCursorrules(metaphor));
    console.log(`  Created ${cursorrulesDest}`);
  }

  console.log('\n  Cursor rules installed to .cursor/rules/ and .cursorrules');
}

function installWindsurfTemplates(cwd: string, metaphor: MetaphorDefinition): void {
  const rulesDir = join(cwd, '.windsurf', 'rules');
  mkdirSync(rulesDir, { recursive: true });

  // Windsurf uses .mdc rule format (same as Cursor)
  const ruleGenerators: Record<string, string> = {
    'slope-sprint-checklist.mdc': generateCursorSprintChecklist(metaphor),
    'slope-commit-discipline.mdc': generateCursorCommitDiscipline(metaphor),
    'slope-review-loop.mdc': generateCursorReviewLoop(),
    'slope-codebase-context.mdc': generateCursorCodebaseContextRule(),
  };
  for (const [file, content] of Object.entries(ruleGenerators)) {
    const dest = join(rulesDir, file);
    if (!existsSync(dest)) {
      writeFileSync(dest, content);
      console.log(`  Created ${dest}`);
    }
  }

  // Generate .windsurfrules (project root context file)
  const windsurfrulesDest = join(cwd, '.windsurfrules');
  if (!existsSync(windsurfrulesDest)) {
    writeFileSync(windsurfrulesDest, generateCursorrules(metaphor, 'windsurf'));
    console.log(`  Created ${windsurfrulesDest}`);
  }

  console.log('\n  Windsurf rules installed to .windsurf/rules/ and .windsurfrules');
}

/** Strip .mdc YAML frontmatter (Cursor-specific) so Cline sees plain markdown. */
function stripMdcFrontmatter(content: string): string {
  return content.replace(/^---[\s\S]*?---\n*/, '');
}

function installClineTemplates(cwd: string, metaphor: MetaphorDefinition): void {
  const rulesDir = join(cwd, '.clinerules');
  mkdirSync(rulesDir, { recursive: true });

  // Cline reads .md files from .clinerules/ — reuse Cursor content with frontmatter stripped
  const ruleGenerators: Record<string, string> = {
    'slope-sprint-checklist.md': stripMdcFrontmatter(generateCursorSprintChecklist(metaphor)),
    'slope-commit-discipline.md': stripMdcFrontmatter(generateCursorCommitDiscipline(metaphor)),
    'slope-review-loop.md': stripMdcFrontmatter(generateCursorReviewLoop()),
    'slope-codebase-context.md': stripMdcFrontmatter(generateCursorCodebaseContextRule()),
  };
  for (const [file, content] of Object.entries(ruleGenerators)) {
    const dest = join(rulesDir, file);
    if (!existsSync(dest)) {
      writeFileSync(dest, content);
      console.log(`  Created ${dest}`);
    }
  }

  // Generate Cline-specific context file (references .clinerules/ paths, not .cursor/)
  const clinerulesDest = join(cwd, '.clinerules', 'slope-context.md');
  if (!existsSync(clinerulesDest)) {
    const contextContent = [
      '# SLOPE — Sprint Tracking',
      '',
      'This project uses SLOPE for sprint scoring and operational performance tracking.',
      '',
      '## Key Files',
      '- `.slope/config.json` — SLOPE configuration',
      '- `.clinerules/` — Sprint rules and checklists',
      '- `.clinerules/hooks/` — SLOPE guard hooks',
      '- `CODEBASE.md` — Auto-generated codebase map',
      '- `docs/retros/` — Sprint scorecards',
      '',
      '## Commands',
      '- `slope briefing` — Pre-sprint briefing',
      '- `slope card` — Handicap card',
      '- `slope validate` — Validate scorecard',
      '- `slope map` — Regenerate codebase map',
      '',
      '## MCP Server',
      'Add the SLOPE MCP server in Cline settings (VS Code extension storage):',
      '- Server name: `slope`',
      '- Command: `npx -y mcp-slope-tools`',
      '',
    ].join('\n');
    writeFileSync(clinerulesDest, contextContent);
    console.log(`  Created ${clinerulesDest}`);
  }

  console.log('\n  Cline rules installed to .clinerules/');
}

function installClineMcpConfig(_cwd: string): void {
  // Cline MCP config lives in VS Code's extension storage (cline_mcp_settings.json),
  // NOT in the workspace. We can't write to it from slope init.
  // Users must add the SLOPE MCP server via Cline's UI or manually edit the global config.
  console.log('\n  Note: Cline MCP config is stored in VS Code extension storage.');
  console.log('  Add the SLOPE MCP server in Cline settings:');
  console.log('    Server name: slope');
  console.log('    Command: npx -y mcp-slope-tools');
}

function installGenericTemplates(cwd: string, metaphor: MetaphorDefinition): void {
  const dest = join(cwd, 'SLOPE-CHECKLIST.md');

  if (!existsSync(dest)) {
    writeFileSync(dest, generateGenericChecklist(metaphor));
    console.log(`  Created ${dest}`);
  }

  console.log('\n  Generic SLOPE checklist installed.');
}

const SLOPE_MCP_ENTRY = {
  command: 'npx',
  args: ['-y', 'mcp-slope-tools'],
};

function installClaudeCodeMcpConfig(cwd: string): void {
  const mcpPath = join(cwd, '.mcp.json');
  let config: { mcpServers?: Record<string, { command: string; args: string[] }> } = {};

  if (existsSync(mcpPath)) {
    try {
      const raw = readFileSync(mcpPath, 'utf8');
      config = JSON.parse(raw) as typeof config;
    } catch {
      config = {};
    }
  }

  if (!config.mcpServers) config.mcpServers = {};
  if (!config.mcpServers.slope) {
    config.mcpServers.slope = SLOPE_MCP_ENTRY;
    console.log(`  Created/updated ${mcpPath} (slope MCP server)`);
  } else {
    console.log(`  Preserved existing slope MCP entry in ${mcpPath}`);
  }

  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
}

function installCursorMcpConfig(cwd: string): void {
  const mcpPath = join(cwd, '.cursor', 'mcp.json');
  let config: { mcpServers?: Record<string, { command: string; args: string[] }> } = {};

  if (existsSync(mcpPath)) {
    try {
      const raw = readFileSync(mcpPath, 'utf8');
      config = JSON.parse(raw) as typeof config;
    } catch {
      config = {};
    }
  }

  if (!config.mcpServers) config.mcpServers = {};
  if (!config.mcpServers.slope) {
    config.mcpServers.slope = SLOPE_MCP_ENTRY;
    console.log(`  Created/updated ${mcpPath} (slope MCP server)`);
  } else {
    console.log(`  Preserved existing slope MCP entry in ${mcpPath}`);
  }

  mkdirSync(join(cwd, '.cursor'), { recursive: true });
  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
}

function installWindsurfMcpConfig(cwd: string): void {
  const mcpPath = join(cwd, '.windsurf', 'mcp.json');
  let config: { mcpServers?: Record<string, { command: string; args: string[] }> } = {};

  if (existsSync(mcpPath)) {
    try {
      const raw = readFileSync(mcpPath, 'utf8');
      config = JSON.parse(raw) as typeof config;
    } catch {
      config = {};
    }
  }

  if (!config.mcpServers) config.mcpServers = {};
  if (!config.mcpServers.slope) {
    config.mcpServers.slope = SLOPE_MCP_ENTRY;
    console.log(`  Created/updated ${mcpPath} (slope MCP server)`);
  } else {
    console.log(`  Preserved existing slope MCP entry in ${mcpPath}`);
  }

  mkdirSync(join(cwd, '.windsurf'), { recursive: true });
  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
}

function installOB1McpConfig(cwd: string): void {
  const mcpPath = join(cwd, '.ob1', 'mcp.json');
  let config: { mcpServers?: Record<string, { command: string; args: string[] }> } = {};

  if (existsSync(mcpPath)) {
    try {
      const raw = readFileSync(mcpPath, 'utf8');
      config = JSON.parse(raw) as typeof config;
    } catch {
      config = {};
    }
  }

  if (!config.mcpServers) config.mcpServers = {};
  if (!config.mcpServers.slope) {
    config.mcpServers.slope = SLOPE_MCP_ENTRY;
    console.log(`  Created/updated ${mcpPath} (slope MCP server)`);
  } else {
    console.log(`  Preserved existing slope MCP entry in ${mcpPath}`);
  }

  mkdirSync(join(cwd, '.ob1'), { recursive: true });
  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
}

function installOB1Templates(_cwd: string, _metaphor: MetaphorDefinition): void {
  // OB1 doesn't have a project-level rules system yet.
  // The MCP config and hooks are sufficient for now.
  console.log('\n  OB1 hooks and MCP server configured.');
}

function installOpenCodeTemplates(cwd: string, metaphor: MetaphorDefinition): void {
  // Generate AGENTS.md (OpenCode's project context file)
  const agentsMdDest = join(cwd, 'AGENTS.md');
  if (!existsSync(agentsMdDest)) {
    writeFileSync(agentsMdDest, generateAgentsMd(metaphor));
    console.log(`  Created ${agentsMdDest}`);
  }

  console.log('\n  OpenCode AGENTS.md installed.');
}

function installOpenCodePlugin(cwd: string): void {
  const pluginsDir = join(cwd, '.opencode', 'plugins');
  mkdirSync(pluginsDir, { recursive: true });

  const pluginPath = join(pluginsDir, 'slope-plugin.ts');
  if (!existsSync(pluginPath)) {
    writeFileSync(pluginPath, generateOpenCodePlugin());
    console.log(`  Created ${pluginPath}`);
  }
}

function installOpenCodeMcpConfig(cwd: string): void {
  const mcpPath = join(cwd, 'opencode.json');
  let config: { $schema?: string; mcp?: Record<string, { type: string; command: string[]; enabled?: boolean }> } = {};

  if (existsSync(mcpPath)) {
    try {
      const raw = readFileSync(mcpPath, 'utf8');
      config = JSON.parse(raw) as typeof config;
    } catch {
      config = {};
    }
  }

  if (!config.$schema) config.$schema = 'https://opencode.ai/config.json';
  if (!config.mcp) config.mcp = {};
  if (!config.mcp.slope) {
    config.mcp.slope = {
      type: 'local',
      command: ['npx', '-y', 'mcp-slope-tools'],
    };
    console.log(`  Created/updated ${mcpPath} (slope MCP server)`);
  } else {
    console.log(`  Preserved existing slope MCP entry in ${mcpPath}`);
  }

  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
}

function installDefaultHooks(cwd: string, provider: InitProvider): void {
  // Import hook templates inline to avoid circular deps
  const SESSION_HOOKS: Record<string, string[]> = {
    'session-start': ['slope session start --ide="$SLOPE_IDE" --role=primary', 'slope briefing --compact'],
    'session-end': ['slope session end --session-id="$SLOPE_SESSION_ID"'],
  };

  const hooksDir = provider === 'claude-code'
    ? join(cwd, '.claude', 'hooks')
    : provider === 'windsurf'
      ? join(cwd, '.windsurf', 'hooks')
      : provider === 'cline'
        ? join(cwd, '.clinerules', 'hooks')
        : provider === 'ob1'
          ? join(cwd, '.ob1', 'hooks')
          : join(cwd, '.cursor', 'hooks');
  mkdirSync(hooksDir, { recursive: true });

  const { loadHooksConfig } = { loadHooksConfig: (c: string) => {
    try { return JSON.parse(readFileSync(join(c, '.slope/hooks.json'), 'utf8')); }
    catch { return { installed: {} }; }
  }};
  const config = loadHooksConfig(cwd);

  for (const [name, commands] of Object.entries(SESSION_HOOKS)) {
    const filePath = join(hooksDir, `slope-${name}.sh`);
    const script = [
      '#!/usr/bin/env bash',
      `# SLOPE hook: ${name}`,
      '',
      '# === SLOPE MANAGED (do not edit above this line) ===',
      ...SLOPE_BIN_PREAMBLE,
      '',
      ...commands,
      '# === SLOPE END ===',
      '',
      '# Add your custom commands below:',
      '',
    ].join('\n');
    const result = writeOrUpdateManagedScript(filePath, script);
    if (result !== 'unchanged') {
      config.installed[name] = { provider, installed_at: new Date().toISOString() };
      console.log(`  ${result === 'created' ? 'Installed' : 'Updated'} hook: ${name}`);
    }
  }

  saveHooksConfig(cwd, config);
}

function installForProvider(cwd: string, provider: InitProvider, metaphor: MetaphorDefinition): void {
  switch (provider) {
    case 'claude-code':
      installClaudeCodeTemplates(cwd, metaphor);
      installClaudeCodeMcpConfig(cwd);
      installDefaultHooks(cwd, 'claude-code');
      break;
    case 'cursor':
      installCursorTemplates(cwd, metaphor);
      installCursorMcpConfig(cwd);
      installDefaultHooks(cwd, 'cursor');
      break;
    case 'windsurf':
      installWindsurfTemplates(cwd, metaphor);
      installWindsurfMcpConfig(cwd);
      installDefaultHooks(cwd, 'windsurf');
      break;
    case 'cline':
      installClineTemplates(cwd, metaphor);
      installClineMcpConfig(cwd);
      installDefaultHooks(cwd, 'cline');
      break;
    case 'opencode':
      installOpenCodeTemplates(cwd, metaphor);
      installOpenCodeMcpConfig(cwd);
      installOpenCodePlugin(cwd);
      break;
    case 'ob1':
      installOB1Templates(cwd, metaphor);
      installOB1McpConfig(cwd);
      installDefaultHooks(cwd, 'ob1');
      break;
    case 'generic':
      installGenericTemplates(cwd, metaphor);
      break;
    default:
      console.warn(`  Warning: no templates for provider "${provider}". Use --generic for a basic setup.`);
      break;
  }
}

/** Provider-specific next-step guidance messages */
const PROVIDER_NEXT_STEPS: Partial<Record<InitProvider, string[]>> = {
  'claude-code': [
    'Restart Claude Code to load the SLOPE MCP server',
    'Rules installed to .claude/rules/ (auto-loaded)',
  ],
  cursor: [
    'MCP server configured in .cursor/mcp.json',
    'Rules installed to .cursor/rules/ (auto-loaded)',
  ],
  windsurf: [
    'MCP server configured in .windsurf/mcp.json',
    'Rules installed to .windsurf/rules/ (auto-loaded)',
  ],
  cline: [
    'Add the SLOPE MCP server via Cline settings (VS Code extension)',
    'Rules installed to .clinerules/ (auto-loaded)',
  ],
  opencode: [
    'MCP server configured in opencode.json',
    'Plugin installed to .opencode/plugins/slope-plugin.ts',
  ],
  ob1: [
    'Restart OB1 to load the SLOPE MCP server',
    'MCP config installed to .ob1/mcp.json',
    'Guard hooks installed to .ob1/hooks/',
  ],
  generic: [
    'Checklist installed to SLOPE-CHECKLIST.md',
  ],
};

/** Provider-specific files that get created */
const PROVIDER_FILES: Partial<Record<InitProvider, string[]>> = {
  'claude-code': [
    '.claude/rules/ (sprint checklist, commit discipline, review loop, codebase context)',
    '.claude/hooks/ (pre-merge-check, session hooks)',
    '.mcp.json (SLOPE MCP server)',
    'CLAUDE.md (project context)',
  ],
  cursor: [
    '.cursor/rules/ (sprint checklist, commit discipline, review loop, codebase context)',
    '.cursor/hooks/ (session hooks)',
    '.cursor/mcp.json (SLOPE MCP server)',
    '.cursorrules (project context)',
  ],
  windsurf: [
    '.windsurf/rules/ (sprint checklist, commit discipline, review loop, codebase context)',
    '.windsurf/hooks/ (session hooks)',
    '.windsurf/mcp.json (SLOPE MCP server)',
    '.windsurfrules (project context)',
  ],
  cline: [
    '.clinerules/ (sprint checklist, commit discipline, review loop, codebase context)',
    '.clinerules/hooks/ (session hooks)',
    '.clinerules/slope-context.md (project context + MCP instructions)',
  ],
  opencode: [
    'AGENTS.md (project context)',
    'opencode.json (SLOPE MCP server)',
    '.opencode/plugins/slope-plugin.ts (session lifecycle plugin)',
  ],
  generic: [
    'SLOPE-CHECKLIST.md (sprint checklist)',
  ],
};

/** Print a summary of what was installed after init completes */
export function printInstallSummary(providers: InitProvider[]): void {
  console.log('\n' + '='.repeat(50));
  console.log('  SLOPE initialized successfully');
  console.log('='.repeat(50));

  // Core files (always created)
  console.log('\nCore files:');
  console.log('  .slope/config.json      — configuration');
  console.log('  .slope/slope.db         — SQLite store (sessions, claims, events)');
  console.log('  .slope/common-issues.json — recurring patterns');
  console.log('  .slope/hooks.json       — installed hook registry');
  console.log('  .slope/plugins/         — custom plugin directories');
  console.log('  docs/retros/            — sprint scorecards');
  console.log('  docs/backlog/roadmap.json — project roadmap');

  // Per-provider files
  if (providers.length > 0) {
    console.log(`\nPlatform${providers.length > 1 ? 's' : ''}: ${providers.join(', ')}`);
    for (const p of providers) {
      const files = PROVIDER_FILES[p];
      if (files) {
        console.log(`\n  ${p}:`);
        for (const f of files) {
          console.log(`    ${f}`);
        }
      }
    }
  }

  // Per-provider next steps
  if (providers.length > 0) {
    console.log('\nNext steps:');
    for (const p of providers) {
      const steps = PROVIDER_NEXT_STEPS[p];
      if (steps) {
        for (const step of steps) {
          console.log(`  - ${step}`);
        }
      }
    }
  }

  // Suggested commands
  console.log('\nGet started:');
  console.log('  slope briefing    — pre-sprint briefing with hazards and gotchas');
  console.log('  slope card        — view your handicap card');
  console.log('  slope validate    — validate a scorecard');
  console.log('  slope hook add --level=full — install all guidance hooks');
  console.log('');
}

async function runInteractiveInit(cwd: string, _args: string[]): Promise<void> {
  // Check for TTY — @clack/prompts requires an interactive terminal
  if (!process.stdin.isTTY) {
    console.error('Error: Interactive init requires a TTY (terminal).');
    console.error('Use flag-based init instead: slope init --claude-code --metaphor=golf');
    process.exit(1);
  }

  try {
    const { runInteractiveCli } = await import('../interactive-init.js');
    await runInteractiveCli(cwd);
  } catch (err: unknown) {
    // Handle ERR_USE_AFTER_CLOSE from readline teardown
    const code = (err as { code?: string })?.code;
    if (code === 'ERR_USE_AFTER_CLOSE') {
      console.error('\nInit cancelled (input stream closed).');
      console.error('Use flag-based init instead: slope init --claude-code --metaphor=golf');
      process.exit(1);
    }
    throw err;
  }
}

export async function initCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();

  // Interactive mode: prompt for project details, then exit
  // (do not fall through to non-interactive path which would overwrite the config)
  if (args.includes('--interactive') || args.includes('-i')) {
    await runInteractiveInit(cwd, args);
    return;
  }

  // Determine which providers to install
  let providers = detectProvidersFromArgs(args);
  if (providers.length === 0) {
    // Auto-detect platforms present in the project
    providers = detectPlatforms(cwd);
    if (providers.length > 0) {
      console.log(`  Detected platform${providers.length > 1 ? 's' : ''}: ${providers.join(', ')}`);
    }
  }

  // Resolve metaphor early — used for config and template generation
  const metaphorArg = args.find(a => a.startsWith('--metaphor='));
  const metaphorId = metaphorArg?.slice('--metaphor='.length);
  const metaphor = resolveMetaphor(args, metaphorId || undefined);

  // Auto-install: detect package manager and install SLOPE as devDep
  if (args.includes('--auto-install')) {
    const pm = detectPackageManager(cwd);
    if (pm) {
      const pkgJsonPath = join(cwd, 'package.json');
      if (existsSync(pkgJsonPath)) {
        try {
          const pkgJson = JSON.parse(readFileSync(pkgJsonPath, 'utf8'));
          const devDeps = pkgJson.devDependencies ?? {};
          if (!devDeps['@slope-dev/slope']) {
            const installCmd = pm === 'npm' ? 'npm install -D @slope-dev/slope'
              : pm === 'yarn' ? 'yarn add -D @slope-dev/slope'
              : pm === 'bun' ? 'bun add -D @slope-dev/slope'
              : 'pnpm add -D @slope-dev/slope';
            console.log(`  Auto-installing: ${installCmd}`);
            execSync(installCmd, { cwd, stdio: 'inherit' });
          } else {
            console.log('  @slope-dev/slope already installed.');
          }
        } catch (err) {
          console.error(`  Warning: Auto-install failed: ${(err as Error).message}`);
        }
      }
    } else {
      console.log('  Warning: No package manager detected, skipping auto-install.');
    }
  }

  const configPath = createConfig(cwd);

  // Apply metaphor and team config
  const configData = JSON.parse(readFileSync(configPath, 'utf8'));
  configData.metaphor = metaphor.id;

  // Auto-detect stack profile and recommend guards
  let stack: StackProfile | null = null;
  try {
    stack = await analyzeStack(cwd);
    if (stack.primaryLanguage || stack.packageManager) {
      const stackInfo: string[] = [];
      if (stack.primaryLanguage) stackInfo.push(stack.primaryLanguage);
      if (stack.frameworks.length > 0) stackInfo.push(...stack.frameworks.slice(0, 2));
      if (stack.packageManager) stackInfo.push(stack.packageManager);
      console.log(`  Detected stack: ${stackInfo.join(', ')}`);

      // Recommend guards based on detected stack
      const recommendedGuards = getRecommendedGuards(stack, cwd);
      if (recommendedGuards.length > 0) {
        console.log(`  Recommended guards: ${recommendedGuards.join(', ')}`);
        console.log(`  Run: slope hook add --guard=${recommendedGuards[0]} (or --level=recommended)`);
      }

      // Store in config for future reference
      configData.detectedStack = {
        language: stack.primaryLanguage,
        frameworks: stack.frameworks,
        packageManager: stack.packageManager,
        runtime: stack.runtime,
      };
    }
  } catch (err) {
    // Non-fatal — stack detection is best-effort
    console.log(`  Note: Stack detection skipped (${(err as Error).message})`);
  }

  // Handle --migrate flag: upgrade config from older SLOPE versions
  if (args.includes('--migrate')) {
    const configPath = join(cwd, '.slope/config.json');
    if (existsSync(configPath)) {
      try {
        const oldConfig = JSON.parse(readFileSync(configPath, 'utf8'));
        const oldVersion = oldConfig.slopeVersion;

        // Migration: add slopeVersion if missing
        if (!oldConfig.slopeVersion) {
          oldConfig.slopeVersion = '1.25.0';
          console.log(`  Migrated config: added slopeVersion`);
        }

        // Migration: ensure detectedStack exists for older configs
        if (!oldConfig.detectedStack && stack) {
          oldConfig.detectedStack = {
            language: stack.primaryLanguage,
            frameworks: stack.frameworks,
            packageManager: stack.packageManager,
            runtime: stack.runtime,
          };
          console.log(`  Migrated config: added detectedStack`);
        }

        // Write migrated config
        writeFileSync(configPath, JSON.stringify(oldConfig, null, 2) + '\n');
        console.log(`  Migration complete (from ${oldVersion || 'unknown'} to ${oldConfig.slopeVersion})`);
        return; // Exit early after migration
      } catch (err) {
        console.log(`  Migration skipped: ${(err as Error).message}`);
      }
    } else {
      console.log(`  No existing config found, skipping migration`);
    }
  }

  // First-time init: set current version from package.json
  const { version: pkgVersion } = JSON.parse(readFileSync(join(__dirname, '..', '..', '..', '..', 'package.json'), 'utf8'));
  configData.slopeVersion = pkgVersion;

  if (args.includes('--team')) {
    configData.team = { players: {} };
    console.log('  Team mode enabled — add players to .slope/config.json team.players');
  }
  writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n');

  console.log(`  Created ${configPath}`);

  // Ensure .slope/ is gitignored (contains local state: handoffs, sprint-state, DB)
  ensureGitignore(cwd);

  const scorecardDir = join(cwd, 'docs', 'retros');
  if (!existsSync(scorecardDir)) {
    mkdirSync(scorecardDir, { recursive: true });
    console.log(`  Created ${scorecardDir}/`);
  }

  const examplePath = join(scorecardDir, 'sprint-1.json');
  if (!existsSync(examplePath)) {
    writeFileSync(examplePath, JSON.stringify(EXAMPLE_SCORECARD, null, 2) + '\n');
    console.log(`  Created ${examplePath}`);
  }

  const commonIssuesPath = join(cwd, '.slope', 'common-issues.json');
  if (!existsSync(commonIssuesPath)) {
    writeFileSync(commonIssuesPath, JSON.stringify(EXAMPLE_COMMON_ISSUES, null, 2) + '\n');
    console.log(`  Created ${commonIssuesPath}`);
  }

  // Create starter roadmap
  const backlogDir = join(cwd, 'docs', 'backlog');
  const roadmapJsonPath = join(backlogDir, 'roadmap.json');
  if (!existsSync(roadmapJsonPath)) {
    mkdirSync(backlogDir, { recursive: true });
    writeFileSync(roadmapJsonPath, JSON.stringify(STARTER_ROADMAP, null, 2) + '\n');
    console.log(`  Created ${roadmapJsonPath}`);
  }

  // Create SQLite store (replaces sessions.json and claims.json)
  const dbPath = join(cwd, '.slope', 'slope.db');
  if (!existsSync(dbPath)) {
    try {
      const { createStore } = await import('../../store/index.js');
      const store = createStore({ storePath: '.slope/slope.db', cwd });
      store.close();
      console.log(`  Created ${dbPath}`);
    } catch (err) {
      console.error(`  Warning: Could not create SQLite store: ${(err as Error).message}`);
    }
  }

  // Create plugin directories
  const pluginDirs = [
    join(cwd, '.slope', 'plugins', 'metaphors'),
    join(cwd, '.slope', 'plugins', 'guards'),
  ];
  for (const dir of pluginDirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
  console.log(`  Created .slope/plugins/ directories`);

  // Create initial hooks config
  saveHooksConfig(cwd, { installed: {} });
  console.log(`  Created .slope/hooks.json`);

  for (const p of providers) {
    installForProvider(cwd, p, metaphor);
  }

  // Save structured vision if provided via flags
  const visionPurpose = args.find(a => a.startsWith('--vision-purpose='))?.slice('--vision-purpose='.length);
  const visionPriorities = args.find(a => a.startsWith('--vision-priorities='))?.slice('--vision-priorities='.length);
  if (visionPurpose && visionPriorities) {
    try {
      createVision({
        purpose: visionPurpose,
        priorities: visionPriorities.split(',').map(s => s.trim()).filter(Boolean),
      }, cwd);
      console.log('  Created .slope/vision.json');
    } catch (err) {
      console.error(`  Warning: Could not create vision: ${(err as Error).message}`);
    }
  }

  // Auto-map: generate CODEBASE.md after all artifacts are created
  try {
    const { mapCommand } = await import('./map.js');
    await mapCommand([]);
    console.log('  Generated CODEBASE.md');
  } catch {
    // map command may not exist yet or may fail — non-fatal
  }

  printInstallSummary(providers);
}
