import { writeFileSync, mkdirSync, existsSync, cpSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig } from '../config.js';
import { saveHooksConfig } from '../hooks-config.js';
import { resolveMetaphor } from '../metaphor.js';
import type { MetaphorDefinition } from '@slope-dev/core';
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

const STARTER_ROADMAP = {
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

type Provider = 'claude-code' | 'cursor' | 'opencode' | 'generic';

function detectProvidersFromArgs(args: string[]): Provider[] {
  const providers: Provider[] = [];
  if (args.includes('--claude-code')) providers.push('claude-code');
  if (args.includes('--cursor')) providers.push('cursor');
  if (args.includes('--opencode')) providers.push('opencode');
  if (args.includes('--generic')) providers.push('generic');
  if (args.includes('--all')) return ['claude-code', 'cursor', 'opencode'];
  return providers;
}

/** Detect platforms present in the project directory */
export function detectPlatforms(cwd: string): Provider[] {
  const detected: Provider[] = [];
  if (existsSync(join(cwd, '.claude')) || existsSync(join(cwd, 'CLAUDE.md'))) {
    detected.push('claude-code');
  }
  if (existsSync(join(cwd, '.cursor')) || existsSync(join(cwd, '.cursorrules'))) {
    detected.push('cursor');
  }
  if (existsSync(join(cwd, 'opencode.json')) || existsSync(join(cwd, 'AGENTS.md'))) {
    detected.push('opencode');
  }
  return detected;
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
  args: ['@slope-dev/mcp-tools'],
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
  config.mcpServers.slope = SLOPE_MCP_ENTRY;

  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  Created/updated ${mcpPath} (slope MCP server)`);
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
  config.mcpServers.slope = SLOPE_MCP_ENTRY;

  mkdirSync(join(cwd, '.cursor'), { recursive: true });
  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  Created/updated ${mcpPath} (slope MCP server)`);
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
  config.mcp.slope = {
    type: 'local',
    command: ['npx', '@slope-dev/mcp-tools'],
  };

  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  Created/updated ${mcpPath} (slope MCP server)`);
}

function installDefaultHooks(cwd: string, provider: Provider): void {
  // Import hook templates inline to avoid circular deps
  const SESSION_HOOKS: Record<string, string[]> = {
    'session-start': ['slope session start --ide="$SLOPE_IDE" --role=primary', 'slope briefing --compact'],
    'session-end': ['slope session end --session-id="$SLOPE_SESSION_ID"'],
  };

  const hooksDir = provider === 'claude-code'
    ? join(cwd, '.claude', 'hooks')
    : join(cwd, '.cursor', 'hooks');
  mkdirSync(hooksDir, { recursive: true });

  const { loadHooksConfig } = { loadHooksConfig: (c: string) => {
    try { return JSON.parse(readFileSync(join(c, '.slope/hooks.json'), 'utf8')); }
    catch { return { installed: {} }; }
  }};
  const config = loadHooksConfig(cwd);

  for (const [name, commands] of Object.entries(SESSION_HOOKS)) {
    const filePath = join(hooksDir, `slope-${name}.sh`);
    if (!existsSync(filePath)) {
      const script = [
        '#!/usr/bin/env bash',
        `# SLOPE hook: ${name}`,
        '',
        '# === SLOPE MANAGED (do not edit above this line) ===',
        ...commands,
        '# === SLOPE END ===',
        '',
        '# Add your custom commands below:',
        '',
      ].join('\n');
      writeFileSync(filePath, script, { mode: 0o755 });
      config.installed[name] = { provider, installed_at: new Date().toISOString() };
      console.log(`  Installed hook: ${name}`);
    }
  }

  saveHooksConfig(cwd, config);
}

function installForProvider(cwd: string, provider: Provider, metaphor: MetaphorDefinition): void {
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
    case 'opencode':
      installOpenCodeTemplates(cwd, metaphor);
      installOpenCodeMcpConfig(cwd);
      installOpenCodePlugin(cwd);
      break;
    case 'generic':
      installGenericTemplates(cwd, metaphor);
      break;
  }
}

export async function initCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();

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

  const configPath = createConfig(cwd);

  // Apply metaphor and team config
  const configData = JSON.parse(readFileSync(configPath, 'utf8'));
  configData.metaphor = metaphor.id;
  if (args.includes('--team')) {
    configData.team = { players: {} };
    console.log('  Team mode enabled — add players to .slope/config.json team.players');
  }
  writeFileSync(configPath, JSON.stringify(configData, null, 2) + '\n');

  console.log(`  Created ${configPath}`);

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
      const { createStore } = await import('@slope-dev/store-sqlite');
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

  console.log('\nSLOPE initialized. Try:');
  console.log('  slope card');
  console.log('  slope validate');
  console.log('');
}
