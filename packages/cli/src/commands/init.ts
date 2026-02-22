import { writeFileSync, mkdirSync, existsSync, cpSync, readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig } from '../config.js';
import { saveHooksConfig } from '../hooks-config.js';

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

type Provider = 'claude-code' | 'cursor' | 'generic';

function detectProvider(args: string[]): Provider | null {
  if (args.includes('--claude-code')) return 'claude-code';
  if (args.includes('--cursor')) return 'cursor';
  if (args.includes('--generic')) return 'generic';
  return null;
}

function getTemplatesRoot(): string {
  return join(__dirname, '..', '..', '..', '..', 'templates');
}

function installClaudeCodeTemplates(cwd: string): void {
  const templatesRoot = join(getTemplatesRoot(), 'claude-code');
  const rulesDir = join(cwd, '.claude', 'rules');
  const hooksDir = join(cwd, '.claude', 'hooks');

  mkdirSync(rulesDir, { recursive: true });
  mkdirSync(hooksDir, { recursive: true });

  const ruleFiles = ['sprint-checklist.md', 'commit-discipline.md', 'review-loop.md'];
  for (const file of ruleFiles) {
    const src = join(templatesRoot, 'rules', file);
    const dest = join(rulesDir, file);
    if (existsSync(src) && !existsSync(dest)) {
      cpSync(src, dest);
      console.log(`  Created ${dest}`);
    }
  }

  const hookFiles = ['pre-merge-check.sh'];
  for (const file of hookFiles) {
    const src = join(templatesRoot, 'hooks', file);
    const dest = join(hooksDir, file);
    if (existsSync(src) && !existsSync(dest)) {
      cpSync(src, dest);
      console.log(`  Created ${dest}`);
    }
  }

  const claudeMdSrc = join(getTemplatesRoot(), 'claude-code', 'CLAUDE.md');
  const claudeMdDest = join(cwd, 'CLAUDE.md');
  if (existsSync(claudeMdSrc) && !existsSync(claudeMdDest)) {
    cpSync(claudeMdSrc, claudeMdDest);
    console.log(`  Created ${claudeMdDest}`);
  }

  console.log('\n  Claude Code templates installed to .claude/rules/ and .claude/hooks/');
}

function installCursorTemplates(cwd: string): void {
  const templatesRoot = join(getTemplatesRoot(), 'cursor', 'rules');
  const rulesDir = join(cwd, '.cursor', 'rules');

  mkdirSync(rulesDir, { recursive: true });

  try {
    const files = readdirSync(templatesRoot).filter((f: string) => f.endsWith('.mdc'));
    for (const file of files) {
      const src = join(templatesRoot, file);
      const dest = join(rulesDir, file);
      if (!existsSync(dest)) {
        cpSync(src, dest);
        console.log(`  Created ${dest}`);
      }
    }
  } catch {
    console.error('  Warning: Could not find Cursor rule templates');
  }

  console.log('\n  Cursor rules installed to .cursor/rules/');
}

function installGenericTemplates(cwd: string): void {
  const templatesRoot = join(getTemplatesRoot(), 'generic');
  const dest = join(cwd, 'SLOPE-CHECKLIST.md');

  const src = join(templatesRoot, 'SLOPE-CHECKLIST.md');
  if (existsSync(src) && !existsSync(dest)) {
    cpSync(src, dest);
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

export async function initCommand(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const provider = detectProvider(args);

  const configPath = createConfig(cwd);
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

  // Create initial hooks config
  saveHooksConfig(cwd, { installed: {} });
  console.log(`  Created .slope/hooks.json`);

  switch (provider) {
    case 'claude-code':
      installClaudeCodeTemplates(cwd);
      installClaudeCodeMcpConfig(cwd);
      installDefaultHooks(cwd, 'claude-code');
      break;
    case 'cursor':
      installCursorTemplates(cwd);
      installCursorMcpConfig(cwd);
      installDefaultHooks(cwd, 'cursor');
      break;
    case 'generic':
      installGenericTemplates(cwd);
      break;
    default:
      break;
  }

  console.log('\nSLOPE initialized. Try:');
  console.log('  slope card');
  console.log('  slope validate');
  console.log('');
}
