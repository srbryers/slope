import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initCommand, detectPlatforms } from '../../src/cli/commands/init.js';

let tmpDir: string;
let originalCwd: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-init-mcp-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('init --cursor (includes MCP)', () => {
  it('creates .cursor/mcp.json with slope server when file does not exist', async () => {
    await initCommand(['--cursor']);

    const mcpPath = join(tmpDir, '.cursor', 'mcp.json');
    expect(existsSync(mcpPath)).toBe(true);

    const content = JSON.parse(readFileSync(mcpPath, 'utf8'));
    expect(content.mcpServers).toBeDefined();
    expect(content.mcpServers.slope).toEqual({
      command: 'npx',
      args: ['-y', 'mcp-slope-tools'],
    });
  });

  it('merges slope into existing .cursor/mcp.json without removing other servers', async () => {
    const cursorDir = join(tmpDir, '.cursor');
    const mcpPath = join(cursorDir, 'mcp.json');
    mkdirSync(cursorDir, { recursive: true });
    writeFileSync(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          other: { command: 'echo', args: [] },
        },
      }, null, 2)
    );

    await initCommand(['--cursor']);

    const content = JSON.parse(readFileSync(mcpPath, 'utf8'));
    expect(content.mcpServers.other).toEqual({ command: 'echo', args: [] });
    expect(content.mcpServers.slope).toEqual({
      command: 'npx',
      args: ['-y', 'mcp-slope-tools'],
    });
  });

  it('does not create .cursor/mcp.json when --cursor is not used', async () => {
    await initCommand(['--generic']);

    const mcpPath = join(tmpDir, '.cursor', 'mcp.json');
    expect(existsSync(mcpPath)).toBe(false);
  });
});

describe('init --claude-code (includes MCP)', () => {
  it('creates .mcp.json with slope server when file does not exist', async () => {
    await initCommand(['--claude-code']);

    const mcpPath = join(tmpDir, '.mcp.json');
    expect(existsSync(mcpPath)).toBe(true);

    const content = JSON.parse(readFileSync(mcpPath, 'utf8'));
    expect(content.mcpServers).toBeDefined();
    expect(content.mcpServers.slope).toEqual({
      command: 'npx',
      args: ['-y', 'mcp-slope-tools'],
    });
  });

  it('merges slope into existing .mcp.json without removing other servers', async () => {
    const mcpPath = join(tmpDir, '.mcp.json');
    writeFileSync(
      mcpPath,
      JSON.stringify({
        mcpServers: {
          other: { command: 'echo', args: [] },
        },
      }, null, 2)
    );

    await initCommand(['--claude-code']);

    const content = JSON.parse(readFileSync(mcpPath, 'utf8'));
    expect(content.mcpServers.other).toEqual({ command: 'echo', args: [] });
    expect(content.mcpServers.slope).toEqual({
      command: 'npx',
      args: ['-y', 'mcp-slope-tools'],
    });
  });

  it('does not create .mcp.json when --generic is used', async () => {
    await initCommand(['--generic']);

    const mcpPath = join(tmpDir, '.mcp.json');
    expect(existsSync(mcpPath)).toBe(false);
  });

  it('creates CLAUDE.md when file does not exist', async () => {
    await initCommand(['--claude-code']);

    const claudeMd = join(tmpDir, 'CLAUDE.md');
    expect(existsSync(claudeMd)).toBe(true);

    const content = readFileSync(claudeMd, 'utf8');
    expect(content).toContain('SLOPE Project');
    expect(content).toContain('MCP Tools');
  });

  it('does not overwrite existing CLAUDE.md', async () => {
    const claudeMd = join(tmpDir, 'CLAUDE.md');
    writeFileSync(claudeMd, '# My Custom CLAUDE.md\n');

    await initCommand(['--claude-code']);

    const content = readFileSync(claudeMd, 'utf8');
    expect(content).toBe('# My Custom CLAUDE.md\n');
  });
});

describe('init --cursor creates .cursorrules', () => {
  it('creates .cursorrules when file does not exist', async () => {
    await initCommand(['--cursor']);

    const cursorrules = join(tmpDir, '.cursorrules');
    expect(existsSync(cursorrules)).toBe(true);

    const content = readFileSync(cursorrules, 'utf8');
    expect(content).toContain('SLOPE Project');
    expect(content).toContain('.cursor/mcp.json');
    expect(content).toContain('.cursor/rules/');
  });

  it('does not overwrite existing .cursorrules', async () => {
    const cursorrules = join(tmpDir, '.cursorrules');
    writeFileSync(cursorrules, '# My Custom Rules\n');

    await initCommand(['--cursor']);

    const content = readFileSync(cursorrules, 'utf8');
    expect(content).toBe('# My Custom Rules\n');
  });

  it('uses metaphor vocabulary in .cursorrules', async () => {
    await initCommand(['--cursor', '--metaphor=gaming']);

    const cursorrules = join(tmpDir, '.cursorrules');
    const content = readFileSync(cursorrules, 'utf8');
    expect(content).toContain('player stats');
    expect(content).toContain('Pre-Level');
    expect(content).toContain('Boss Fight');
  });

  it('generates metaphor-aware .mdc rules', async () => {
    await initCommand(['--cursor', '--metaphor=gaming']);

    const checklist = readFileSync(join(tmpDir, '.cursor', 'rules', 'slope-sprint-checklist.mdc'), 'utf8');
    expect(checklist).toContain('Pre-Level Routine');
    expect(checklist).toContain('Post-Quest Routine');
  });
});

describe('init --opencode', () => {
  it('creates AGENTS.md when file does not exist', async () => {
    await initCommand(['--opencode']);

    const agentsMd = join(tmpDir, 'AGENTS.md');
    expect(existsSync(agentsMd)).toBe(true);

    const content = readFileSync(agentsMd, 'utf8');
    expect(content).toContain('SLOPE Project');
    expect(content).toContain('opencode.json');
    expect(content).toContain('Commit Discipline');
  });

  it('does not overwrite existing AGENTS.md', async () => {
    const agentsMd = join(tmpDir, 'AGENTS.md');
    writeFileSync(agentsMd, '# My Custom AGENTS.md\n');

    await initCommand(['--opencode']);

    const content = readFileSync(agentsMd, 'utf8');
    expect(content).toBe('# My Custom AGENTS.md\n');
  });

  it('creates opencode.json with slope MCP server', async () => {
    await initCommand(['--opencode']);

    const mcpPath = join(tmpDir, 'opencode.json');
    expect(existsSync(mcpPath)).toBe(true);

    const content = JSON.parse(readFileSync(mcpPath, 'utf8'));
    expect(content.$schema).toBe('https://opencode.ai/config.json');
    expect(content.mcp).toBeDefined();
    expect(content.mcp.slope).toEqual({
      type: 'local',
      command: ['npx', '-y', 'mcp-slope-tools'],
    });
  });

  it('merges slope into existing opencode.json', async () => {
    const mcpPath = join(tmpDir, 'opencode.json');
    writeFileSync(mcpPath, JSON.stringify({
      mcp: { other: { type: 'local', command: ['echo'] } },
    }, null, 2));

    await initCommand(['--opencode']);

    const content = JSON.parse(readFileSync(mcpPath, 'utf8'));
    expect(content.mcp.other).toEqual({ type: 'local', command: ['echo'] });
    expect(content.mcp.slope).toEqual({
      type: 'local',
      command: ['npx', '-y', 'mcp-slope-tools'],
    });
  });

  it('uses metaphor vocabulary in AGENTS.md', async () => {
    await initCommand(['--opencode', '--metaphor=gaming']);

    const agentsMd = join(tmpDir, 'AGENTS.md');
    const content = readFileSync(agentsMd, 'utf8');
    expect(content).toContain('player stats');
    expect(content).toContain('Pre-Level');
    expect(content).toContain('Boss Fight');
  });

  it('creates .opencode/plugins/slope-plugin.ts', async () => {
    await initCommand(['--opencode']);

    const pluginPath = join(tmpDir, '.opencode', 'plugins', 'slope-plugin.ts');
    expect(existsSync(pluginPath)).toBe(true);

    const content = readFileSync(pluginPath, 'utf8');
    expect(content).toContain('SLOPE Plugin for OpenCode');
    expect(content).toContain('session.created');
    expect(content).toContain('session.idle');
    expect(content).toContain('session.compacted');
    expect(content).toContain('slope session start');
    expect(content).toContain('slope briefing');
  });

  it('does not overwrite existing plugin', async () => {
    const pluginsDir = join(tmpDir, '.opencode', 'plugins');
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(join(pluginsDir, 'slope-plugin.ts'), '// custom plugin\n');

    await initCommand(['--opencode']);

    const content = readFileSync(join(pluginsDir, 'slope-plugin.ts'), 'utf8');
    expect(content).toBe('// custom plugin\n');
  });
});

describe('detectPlatforms', () => {
  it('detects Claude Code from .claude directory', () => {
    mkdirSync(join(tmpDir, '.claude'), { recursive: true });
    expect(detectPlatforms(tmpDir)).toContain('claude-code');
  });

  it('does not detect Claude Code from CLAUDE.md alone (adapter requires .claude/)', () => {
    writeFileSync(join(tmpDir, 'CLAUDE.md'), '# Test');
    expect(detectPlatforms(tmpDir)).not.toContain('claude-code');
  });

  it('detects Cursor from .cursor directory', () => {
    mkdirSync(join(tmpDir, '.cursor'), { recursive: true });
    expect(detectPlatforms(tmpDir)).toContain('cursor');
  });

  it('does not detect Cursor from .cursorrules alone (adapter requires .cursor/)', () => {
    writeFileSync(join(tmpDir, '.cursorrules'), '# Test');
    expect(detectPlatforms(tmpDir)).not.toContain('cursor');
  });

  it('detects OpenCode from opencode.json', () => {
    writeFileSync(join(tmpDir, 'opencode.json'), '{}');
    expect(detectPlatforms(tmpDir)).toContain('opencode');
  });

  it('detects OpenCode from AGENTS.md', () => {
    writeFileSync(join(tmpDir, 'AGENTS.md'), '# Test');
    expect(detectPlatforms(tmpDir)).toContain('opencode');
  });

  it('detects multiple platforms', () => {
    mkdirSync(join(tmpDir, '.claude'), { recursive: true });
    mkdirSync(join(tmpDir, '.cursor'), { recursive: true });
    writeFileSync(join(tmpDir, 'opencode.json'), '{}');
    const detected = detectPlatforms(tmpDir);
    expect(detected).toContain('claude-code');
    expect(detected).toContain('cursor');
    expect(detected).toContain('opencode');
  });

  it('returns empty array when no platforms detected', () => {
    expect(detectPlatforms(tmpDir)).toEqual([]);
  });
});

describe('init --all', () => {
  it('installs for all three platforms', async () => {
    await initCommand(['--all']);

    // Claude Code
    expect(existsSync(join(tmpDir, 'CLAUDE.md'))).toBe(true);
    expect(existsSync(join(tmpDir, '.mcp.json'))).toBe(true);
    expect(existsSync(join(tmpDir, '.claude', 'rules', 'sprint-checklist.md'))).toBe(true);

    // Cursor
    expect(existsSync(join(tmpDir, '.cursorrules'))).toBe(true);
    expect(existsSync(join(tmpDir, '.cursor', 'mcp.json'))).toBe(true);
    expect(existsSync(join(tmpDir, '.cursor', 'rules', 'slope-sprint-checklist.mdc'))).toBe(true);

    // OpenCode
    expect(existsSync(join(tmpDir, 'AGENTS.md'))).toBe(true);
    expect(existsSync(join(tmpDir, 'opencode.json'))).toBe(true);
  });
});

describe('init auto-detection', () => {
  it('auto-detects and installs for detected platforms', async () => {
    // Pre-create a .cursor directory so detection picks it up
    mkdirSync(join(tmpDir, '.cursor'), { recursive: true });

    await initCommand([]);

    // Cursor should be auto-installed
    expect(existsSync(join(tmpDir, '.cursorrules'))).toBe(true);
    expect(existsSync(join(tmpDir, '.cursor', 'mcp.json'))).toBe(true);
  });
});

describe('init creates roadmap', () => {
  it('creates starter roadmap.json', async () => {
    await initCommand([]);

    const roadmapPath = join(tmpDir, 'docs', 'backlog', 'roadmap.json');
    expect(existsSync(roadmapPath)).toBe(true);

    const content = JSON.parse(readFileSync(roadmapPath, 'utf8'));
    expect(content.name).toBe('Project Roadmap');
    expect(content.sprints).toHaveLength(1);
    expect(content.sprints[0].tickets).toHaveLength(3);
    expect(content.phases).toHaveLength(1);
  });

  it('does not overwrite existing roadmap.json', async () => {
    const backlogDir = join(tmpDir, 'docs', 'backlog');
    mkdirSync(backlogDir, { recursive: true });
    writeFileSync(join(backlogDir, 'roadmap.json'), '{"name":"Custom"}');

    await initCommand([]);

    const content = readFileSync(join(backlogDir, 'roadmap.json'), 'utf8');
    expect(content).toBe('{"name":"Custom"}');
  });

  it('config includes roadmapPath field', async () => {
    await initCommand([]);

    const configPath = join(tmpDir, '.slope', 'config.json');
    const config = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(config.roadmapPath).toBe('docs/backlog/roadmap.json');
  });
});
