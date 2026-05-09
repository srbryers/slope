import { describe, it, expect, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const REPO_ROOT = resolve(__dirname, '..', '..');
const SLOPE_BIN = resolve(REPO_ROOT, 'dist', 'cli', 'index.js');

describe('slope init --codex (GH #309)', () => {
  beforeAll(() => {
    if (!existsSync(SLOPE_BIN)) {
      throw new Error(`dist not built — run \`pnpm build\` first. Expected ${SLOPE_BIN}`);
    }
  });

  it('creates AGENTS.md with project context (#340)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-init-codex-agents-'));
    try {
      execSync(`node ${SLOPE_BIN} init --codex`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      const agentsMd = join(cwd, 'AGENTS.md');
      expect(existsSync(agentsMd)).toBe(true);
      const stat = require('node:fs').statSync(agentsMd);
      expect(stat.size).toBeGreaterThan(100);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not overwrite existing AGENTS.md (#340)', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-init-codex-existing-'));
    const agentsMd = join(cwd, 'AGENTS.md');
    try {
      const sentinel = '# Custom user content — do not touch\n';
      require('node:fs').writeFileSync(agentsMd, sentinel);
      execSync(`node ${SLOPE_BIN} init --codex`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      const content = require('node:fs').readFileSync(agentsMd, 'utf8');
      expect(content).toBe(sentinel);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('installs Codex hooks under .codex/hooks/', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-init-codex-'));
    try {
      execSync(`node ${SLOPE_BIN} init --codex`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      expect(existsSync(join(cwd, '.codex', 'hooks', 'slope-session-start.sh'))).toBe(true);
      expect(existsSync(join(cwd, '.codex', 'hooks', 'slope-session-end.sh'))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('prints Codex-specific next steps including MCP config snippet', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-init-codex-next-'));
    try {
      const out = execSync(`node ${SLOPE_BIN} init --codex`, { cwd, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
      expect(out).toContain('Platform: codex');
      expect(out).toContain('.codex/config.toml');
      expect(out).toContain('Branch discipline');
      expect(out).toContain('slope sprint begin');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('--all includes codex among the installed providers', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-init-codex-all-'));
    try {
      execSync(`node ${SLOPE_BIN} init --all`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      expect(existsSync(join(cwd, '.codex', 'hooks', 'slope-session-start.sh'))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('does not create .codex when other providers selected', () => {
    const cwd = mkdtempSync(join(tmpdir(), 'slope-init-no-codex-'));
    try {
      execSync(`node ${SLOPE_BIN} init --claude-code`, { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
      expect(existsSync(join(cwd, '.codex'))).toBe(false);
      expect(existsSync(join(cwd, '.claude'))).toBe(true);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
