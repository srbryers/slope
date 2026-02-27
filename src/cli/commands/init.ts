import { writeFileSync, mkdirSync, existsSync, cpSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createConfig } from '../config.js';
import { saveHooksConfig } from '../hooks-config.js';
import { resolveMetaphor } from '../metaphor.js';
import type { MetaphorDefinition } from '../../core/index.js';
import { saveVision } from '../../core/vision.js';
import type { VisionDocument } from '../../core/analyzers/types.js';
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

/** Init supports all harness adapters plus OpenCode (template-only, no adapter) */
type InitProvider = HarnessId | 'opencode';

export function detectProvidersFromArgs(args: string[]): InitProvider[] {
  const providers: InitProvider[] = [];
  if (args.includes('--claude-code')) providers.push('claude-code');
  if (args.includes('--cursor')) providers.push('cursor');
  if (args.includes('--windsurf')) providers.push('windsurf');
  if (args.includes('--cline')) providers.push('cline');
  if (args.includes('--opencode')) providers.push('opencode');
  if (args.includes('--generic')) providers.push('generic');
  // Unified --harness=<id> flag
  const harnessArg = args.find(a => a.startsWith('--harness='));
  if (harnessArg) {
    const id = harnessArg.slice('--harness='.length);
    if (id && !providers.includes(id)) providers.push(id);
  }
  // --all includes all real harnesses + opencode; generic is a fallback, not included
  if (args.includes('--all')) return ['claude-code', 'cursor', 'windsurf', 'opencode'];
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
      '- Command: `npx @slope-dev/slope/mcp`',
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
  console.log('    Command: npx @slope-dev/slope/mcp');
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
  args: ['@slope-dev/slope/mcp'],
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
  config.mcpServers.slope = SLOPE_MCP_ENTRY;

  mkdirSync(join(cwd, '.windsurf'), { recursive: true });
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
    command: ['npx', '@slope-dev/slope/mcp'],
  };

  writeFileSync(mcpPath, JSON.stringify(config, null, 2) + '\n');
  console.log(`  Created/updated ${mcpPath} (slope MCP server)`);
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
    case 'generic':
      installGenericTemplates(cwd, metaphor);
      break;
    default:
      console.warn(`  Warning: no templates for provider "${provider}". Use --generic for a basic setup.`);
      break;
  }
}

async function runInteractiveInit(cwd: string, args: string[]): Promise<void> {
  const { createInterface } = await import('node:readline');
  const { initFromInterview } = await import('../../core/interview.js');
  const rl = createInterface({ input: process.stdin, output: process.stdout });

  const ask = (question: string): Promise<string> =>
    new Promise(resolve => rl.question(question, answer => resolve(answer.trim())));

  try {
    const projectName = await ask('Project name: ');
    if (!projectName) {
      console.error('Project name is required');
      process.exit(1);
    }

    const repoUrl = await ask('GitHub repo URL (optional): ') || undefined;
    const metaphor = await ask('Metaphor [golf]: ') || undefined;
    const sprintStr = await ask('Current sprint number [1]: ');
    const currentSprint = sprintStr ? parseInt(sprintStr, 10) : undefined;

    const teamStr = await ask('Team members (slug:name, comma-separated, optional): ');
    let teamMembers: Record<string, string> | undefined;
    if (teamStr) {
      teamMembers = {};
      for (const pair of teamStr.split(',')) {
        const [slug, ...nameParts] = pair.trim().split(':');
        if (slug && nameParts.length > 0) {
          teamMembers[slug.trim()] = nameParts.join(':').trim();
        }
      }
    }

    const visionPurpose = await ask('Project vision / purpose (optional): ') || undefined;
    let visionPriorities: string[] = [];
    if (visionPurpose) {
      const priStr = await ask('Priorities (comma-separated, optional): ');
      if (priStr) {
        visionPriorities = priStr.split(',').map(s => s.trim()).filter(Boolean);
      }
    }

    const vision = visionPurpose || undefined;

    // Run smart analysis if --smart flag is present
    let smartConfig: {
      projectName?: string; techStack?: string[];
      sprintCadence?: 'weekly' | 'biweekly' | 'monthly';
      team?: Record<string, string>;
      roadmap?: import('../../core/roadmap.js').RoadmapDefinition;
      commonIssues?: import('../../core/briefing.js').CommonIssuesFile;
    } = {};
    if (args.includes('--smart')) {
      console.log('\nRunning repo analysis...\n');
      const { runAnalyzers, saveRepoProfile } = await import('../../core/analyzers/index.js');
      const { estimateComplexity } = await import('../../core/analyzers/complexity.js');
      const { analyzeBacklog } = await import('../../core/analyzers/backlog.js');
      const { generateConfig } = await import('../../core/generators/config.js');
      const { generateFirstSprint } = await import('../../core/generators/first-sprint.js');
      const { generateCommonIssues } = await import('../../core/generators/common-issues.js');

      const profile = await runAnalyzers({ cwd });
      saveRepoProfile(profile, cwd);

      const complexity = estimateComplexity(profile);
      const backlog = await analyzeBacklog(cwd);
      const genConfig = generateConfig(profile);
      const genSprint = generateFirstSprint(profile, complexity, backlog);
      const genIssues = generateCommonIssues(profile, backlog);

      // Use generated values as defaults (user input overrides)
      smartConfig = {
        projectName: genConfig.projectName,
        techStack: genConfig.techStack,
        sprintCadence: genConfig.sprintCadence,
        team: genConfig.team,
      };

      // Store generated artifacts for writing after init
      smartConfig.roadmap = genSprint.roadmap;
      smartConfig.commonIssues = genIssues;

      const stackParts = [profile.stack.primaryLanguage || 'unknown'];
      if (profile.stack.packageManager) stackParts.push(profile.stack.packageManager);
      if (profile.stack.runtime) stackParts.push(profile.stack.runtime);
      if (profile.stack.frameworks.length > 0) stackParts.push(profile.stack.frameworks.slice(0, 3).join(', '));

      const moduleInfo = profile.structure.modules.length > 0
        ? `, ${profile.structure.modules.length} modules`
        : '';

      console.log('Smart Analysis Complete:');
      console.log(`  Stack:       ${stackParts.join(', ')}`);
      console.log(`  Structure:   ${profile.structure.sourceFiles} source files, ${profile.structure.testFiles} test files${moduleInfo}`);
      console.log(`  Complexity:  par ${complexity.estimatedPar}, slope ${complexity.estimatedSlope}${complexity.slopeFactors.length > 0 ? ` (${complexity.slopeFactors.join(', ')})` : ''}`);
      console.log(`  Backlog:     ${backlog.todos.length} TODOs across ${Object.keys(backlog.todosByModule).length} modules`);
      console.log(`  Suggested:   ${genSprint.sprint.tickets.length} tickets for Sprint 1\n`);
    }

    console.log('\nInitializing SLOPE project...\n');

    const result = await initFromInterview(cwd, {
      projectName: projectName || smartConfig.projectName || 'my-project',
      repoUrl,
      metaphor,
      currentSprint,
      teamMembers: teamMembers ?? smartConfig.team,
      techStack: smartConfig.techStack,
      sprintCadence: smartConfig.sprintCadence,
      vision,
    });

    console.log(`  Config: ${result.configPath}`);
    for (const f of result.filesCreated.slice(1)) {
      console.log(`  Created: ${f}`);
    }

    // Overwrite with smart-generated artifacts if available
    if (smartConfig.roadmap) {
      const roadmapPath = join(cwd, 'docs', 'backlog', 'roadmap.json');
      mkdirSync(join(cwd, 'docs', 'backlog'), { recursive: true });
      writeFileSync(roadmapPath, JSON.stringify(smartConfig.roadmap, null, 2) + '\n');
      console.log(`  Updated: ${roadmapPath} (from smart analysis)`);
    }
    if (smartConfig.commonIssues) {
      const issuesPath = join(cwd, '.slope', 'common-issues.json');
      writeFileSync(issuesPath, JSON.stringify(smartConfig.commonIssues, null, 2) + '\n');
      console.log(`  Updated: ${issuesPath} (from smart analysis)`);
    }

    // Save vision document if purpose was provided
    if (visionPurpose) {
      const now = new Date().toISOString();
      const visionDoc: VisionDocument = {
        purpose: visionPurpose,
        priorities: visionPriorities,
        createdAt: now,
        updatedAt: now,
      };
      saveVision(visionDoc, cwd);
      console.log(`  Created .slope/vision.json`);
    }

    // Handle store setup (infrastructure concern — CLI only)
    const storeArg = args.find(a => a.startsWith('--store='));
    const storeType = storeArg?.slice('--store='.length) ?? 'sqlite';

    if (storeType === 'sqlite') {
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
    }

    // Continue with provider installation
    return;
  } finally {
    rl.close();
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

  console.log('\nSLOPE initialized. Try:');
  console.log('  slope card');
  console.log('  slope validate');
  console.log('');
}
