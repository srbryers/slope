import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { printInstallSummary } from '../../src/cli/commands/init.js';
import type { InitProvider } from '../../src/cli/commands/init.js';
import { initCommand } from '../../src/cli/commands/init.js';

let tmpDir: string;
let originalCwd: string;
let consoleSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-init-summary-'));
  originalCwd = process.cwd();
  process.chdir(tmpDir);
  consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmpDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe('printInstallSummary', () => {
  it('prints core files section', () => {
    printInstallSummary([]);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('SLOPE initialized successfully');
    expect(output).toContain('.slope/config.json');
    expect(output).toContain('.slope/slope.db');
    expect(output).toContain('.slope/common-issues.json');
    expect(output).toContain('docs/retros/');
    expect(output).toContain('docs/backlog/roadmap.json');
  });

  it('prints suggested commands', () => {
    printInstallSummary([]);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('slope briefing');
    expect(output).toContain('slope card');
    expect(output).toContain('slope validate');
    expect(output).toContain('slope hook add --level=full');
  });

  it('lists claude-code specific files and next steps', () => {
    printInstallSummary(['claude-code']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('claude-code');
    expect(output).toContain('.claude/rules/');
    expect(output).toContain('.claude/hooks/');
    expect(output).toContain('.mcp.json');
    expect(output).toContain('CLAUDE.md');
    expect(output).toContain('Restart Claude Code to load the SLOPE MCP server');
  });

  it('lists cursor specific files and next steps', () => {
    printInstallSummary(['cursor']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('.cursor/rules/');
    expect(output).toContain('.cursor/hooks/');
    expect(output).toContain('.cursor/mcp.json');
    expect(output).toContain('.cursorrules');
    expect(output).toContain('MCP server configured in .cursor/mcp.json');
  });

  it('lists windsurf specific files and next steps', () => {
    printInstallSummary(['windsurf']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('.windsurf/rules/');
    expect(output).toContain('.windsurf/hooks/');
    expect(output).toContain('.windsurf/mcp.json');
    expect(output).toContain('.windsurfrules');
    expect(output).toContain('MCP server configured in .windsurf/mcp.json');
  });

  it('lists cline specific files and next steps', () => {
    printInstallSummary(['cline']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('.clinerules/');
    expect(output).toContain('.clinerules/hooks/');
    expect(output).toContain('Add the SLOPE MCP server via Cline settings');
  });

  it('lists opencode specific files and next steps', () => {
    printInstallSummary(['opencode']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('AGENTS.md');
    expect(output).toContain('opencode.json');
    expect(output).toContain('.opencode/plugins/slope-plugin.ts');
    expect(output).toContain('MCP server configured in opencode.json');
  });

  it('lists generic specific files', () => {
    printInstallSummary(['generic']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('SLOPE-CHECKLIST.md');
  });

  it('handles multiple providers', () => {
    printInstallSummary(['claude-code', 'cursor', 'opencode']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Platforms: claude-code, cursor, opencode');
    expect(output).toContain('Restart Claude Code');
    expect(output).toContain('.cursor/mcp.json');
    expect(output).toContain('opencode.json');
  });

  it('uses singular "Platform" for single provider', () => {
    printInstallSummary(['cursor']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('Platform: cursor');
    expect(output).not.toContain('Platforms:');
  });

  it('silently skips unknown providers', () => {
    printInstallSummary(['nonexistent' as InitProvider]);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('SLOPE initialized successfully');
    expect(output).toContain('Platform: nonexistent');
    // Should not crash — just no files/steps listed for unknown provider
  });
});

describe('initCommand prints summary', () => {
  it('prints summary after --claude-code init', async () => {
    await initCommand(['--claude-code']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('SLOPE initialized successfully');
    expect(output).toContain('Restart Claude Code');
  });

  it('prints summary after --cursor init', async () => {
    await initCommand(['--cursor']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('SLOPE initialized successfully');
    expect(output).toContain('MCP server configured in .cursor/mcp.json');
  });

  it('prints summary after --generic init', async () => {
    await initCommand(['--generic']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('SLOPE initialized successfully');
    expect(output).toContain('SLOPE-CHECKLIST.md');
  });

  it('prints summary after bare init with no providers', async () => {
    await initCommand([]);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('SLOPE initialized successfully');
    expect(output).toContain('slope briefing');
  });

  it('prints summary after --all init', async () => {
    await initCommand(['--all']);

    const output = consoleSpy.mock.calls.map(c => c[0]).join('\n');
    expect(output).toContain('SLOPE initialized successfully');
    expect(output).toContain('claude-code');
    expect(output).toContain('cursor');
    expect(output).toContain('windsurf');
    expect(output).toContain('opencode');
  });

  it('creates .gitignore with .slope/ entry', async () => {
    await initCommand([]);

    const gitignorePath = join(tmpDir, '.gitignore');
    expect(existsSync(gitignorePath)).toBe(true);
    const content = readFileSync(gitignorePath, 'utf8');
    expect(content).toContain('.slope/');
  });

  it('appends to existing .gitignore without duplicating', async () => {
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\n');
    await initCommand([]);

    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
    expect(content).toContain('node_modules/');
    expect(content).toContain('.slope/');
  });

  it('skips .gitignore if .slope/ already present', async () => {
    writeFileSync(join(tmpDir, '.gitignore'), 'node_modules/\n.slope/\n');
    await initCommand([]);

    const content = readFileSync(join(tmpDir, '.gitignore'), 'utf8');
    // Should not have duplicate entries
    const matches = content.match(/\.slope\//g);
    expect(matches).toHaveLength(1);
  });
});
