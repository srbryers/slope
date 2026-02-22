import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initCommand } from '../src/commands/init.js';

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
      args: ['@slope-dev/mcp-tools'],
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
      args: ['@slope-dev/mcp-tools'],
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
      args: ['@slope-dev/mcp-tools'],
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
      args: ['@slope-dev/mcp-tools'],
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
