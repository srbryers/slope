import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { CodexAdapter } from '../../../src/core/adapters/codex.js';
import { GUARD_DEFINITIONS } from '../../../src/core/guard.js';
import type { GuardResult } from '../../../src/core/guard.js';

type CodexHookEntry = { matcher?: string; hooks: Array<{ command: string; statusMessage?: string }> };

function findHookGroupForCommand(groups: CodexHookEntry[] | undefined, commandPart: string): CodexHookEntry | undefined {
  return groups?.find(group => group.hooks.some(hook => hook.command.includes(commandPart)));
}

describe('CodexAdapter', () => {
  let adapter: CodexAdapter;

  beforeEach(() => {
    adapter = new CodexAdapter();
  });

  it('has correct id and displayName', () => {
    expect(adapter.id).toBe('codex');
    expect(adapter.displayName).toBe('Codex CLI');
  });

  describe('supportedEvents', () => {
    it('contains PreToolUse, PostToolUse, and Stop', () => {
      expect(adapter.supportedEvents).toEqual(new Set(['PreToolUse', 'PostToolUse', 'Stop']));
    });

    it('does not contain PreCompact', () => {
      expect(adapter.supportedEvents.has('PreCompact')).toBe(false);
    });
  });

  describe('toolNames', () => {
    it('uses current Codex matcher aliases for file edits', () => {
      expect(adapter.toolNames.write_file).toBe('apply_patch|Edit|Write');
    });

    it('keeps SLOPE-specific workflow matcher names used by current installs', () => {
      expect(adapter.toolNames.execute_command).toBe('Bash');
      expect(adapter.toolNames.create_subagent).toBe('Agent');
      expect(adapter.toolNames.exit_plan).toBe('ExitPlanMode');
      expect(adapter.toolNames.enter_worktree).toBe('EnterWorktree');
    });
  });

  describe('supportsContextInjection', () => {
    it('is true', () => {
      expect(adapter.supportsContextInjection).toBe(true);
    });
  });

  describe('hooksConfigPath', () => {
    it('returns .codex/hooks.json path', () => {
      expect(adapter.hooksConfigPath('/tmp/test')).toBe(join('/tmp/test', '.codex', 'hooks.json'));
    });
  });

  describe('detect', () => {
    it('returns true when .codex/ directory exists', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-codex-'));
      mkdirSync(join(tmpDir, '.codex'), { recursive: true });
      expect(adapter.detect(tmpDir)).toBe(true);
    });

    it('returns false when .codex/ does not exist', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-codex-'));
      expect(adapter.detect(tmpDir)).toBe(false);
    });
  });

  describe('formatPreToolOutput', () => {
    it('returns deny with blockReason', () => {
      const result: GuardResult = { blockReason: 'blocked' };
      const output = adapter.formatPreToolOutput(result) as { hookSpecificOutput: { permissionDecision?: string; permissionDecisionReason?: string } };
      expect(output.hookSpecificOutput.permissionDecision).toBe('deny');
      expect(output.hookSpecificOutput.permissionDecisionReason).toBe('blocked');
    });

    it('returns context as additionalContext', () => {
      const result: GuardResult = { context: 'warning text' };
      const output = adapter.formatPreToolOutput(result) as { hookSpecificOutput: { additionalContext?: string } };
      expect(output.hookSpecificOutput.additionalContext).toBe('warning text');
    });

    it('returns empty for no-op result', () => {
      const result: GuardResult = {};
      const output = adapter.formatPreToolOutput(result) as { hookSpecificOutput: Record<string, unknown> };
      expect(output.hookSpecificOutput.permissionDecision).toBeUndefined();
      expect(output.hookSpecificOutput.additionalContext).toBeUndefined();
    });
  });

  describe('formatPostToolOutput', () => {
    it('returns block decision for blockReason', () => {
      const result: GuardResult = { blockReason: 'test block' };
      const output = adapter.formatPostToolOutput(result) as { decision?: string; reason?: string };
      expect(output.decision).toBe('block');
      expect(output.reason).toBe('test block');
    });

    it('returns context as additionalContext', () => {
      const result: GuardResult = { context: 'info text' };
      const output = adapter.formatPostToolOutput(result) as { hookSpecificOutput?: { additionalContext?: string } };
      expect(output.hookSpecificOutput?.additionalContext).toBe('info text');
    });

    it('returns empty for no-op', () => {
      const result: GuardResult = {};
      const output = adapter.formatPostToolOutput(result);
      expect(output).toEqual({});
    });
  });

  describe('formatStopOutput', () => {
    it('returns block for blockReason', () => {
      const result: GuardResult = { blockReason: 'stop blocked' };
      const output = adapter.formatStopOutput(result) as { decision?: string; reason?: string };
      expect(output.decision).toBe('block');
      expect(output.reason).toBe('stop blocked');
    });

    it('returns empty for no-op', () => {
      const result: GuardResult = {};
      const output = adapter.formatStopOutput(result);
      expect(output).toEqual({});
    });
  });

  describe('generateHooksConfig', () => {
    it('generates config with guard entries', () => {
      const guards = GUARD_DEFINITIONS.filter(g => g.name === 'hazard' || g.name === 'stop-check');
      const config = adapter.generateHooksConfig(guards, '/path/to/slope-guard.sh');
      expect(config).toBeDefined();
      // hazard is PreToolUse, stop-check is Stop
      expect(config.hooks.PreToolUse).toBeDefined();
      expect(config.hooks.Stop).toBeDefined();
    });

    it('wraps events under the Codex hooks root', () => {
      const guards = GUARD_DEFINITIONS.filter(g => g.name === 'hazard');
      const config = adapter.generateHooksConfig(guards, '/path/to/slope-guard.sh');

      expect(config).toHaveProperty('hooks');
      expect(config).not.toHaveProperty('PreToolUse');
      expect(config.hooks.PreToolUse?.[0]?.hooks[0]?.statusMessage).toBe('SLOPE hazard');
    });

    it('resolves matcher from toolCategories using Codex tool names', () => {
      const guards = GUARD_DEFINITIONS.filter(g => g.name === 'hazard');
      const config = adapter.generateHooksConfig(guards, '/path/to/slope-guard.sh');

      expect(config.hooks.PreToolUse?.[0]?.matcher).toBe('apply_patch|Edit|Write');
    });

    it('keeps Codex search and edit matchers valid when categories are combined', () => {
      const guards = GUARD_DEFINITIONS.filter(g => g.name === 'explore');
      const config = adapter.generateHooksConfig(guards, '/path/to/slope-guard.sh');

      expect(config.hooks.PreToolUse?.[0]?.matcher).toBe(
        'mcp__.*__read.*|mcp__.*__glob.*|mcp__.*__list.*|mcp__.*__search.*|mcp__.*__grep.*|apply_patch|Edit|Write',
      );
    });

    it('keeps claim-required in the Codex write matcher group', () => {
      const guards = GUARD_DEFINITIONS.filter(g => g.name === 'claim-required');
      const config = adapter.generateHooksConfig(guards, '/path/to/slope-guard.sh');

      const group = findHookGroupForCommand(config.hooks.PreToolUse, 'claim-required');
      expect(group).toBeDefined();
      expect(group?.matcher?.split('|')).toEqual(expect.arrayContaining(['apply_patch', 'Edit', 'Write']));
      expect(group?.hooks[0]?.statusMessage).toBe('SLOPE claim-required');
    });

    it('groups guards by event and matcher for Codex review ergonomics', () => {
      const guards = GUARD_DEFINITIONS.filter(g => g.hookEvent === 'PreToolUse' && g.matcher === 'Bash').slice(0, 2);
      expect(guards).toHaveLength(2);

      const config = adapter.generateHooksConfig(guards, '/path/to/slope-guard.sh');

      expect(config.hooks.PreToolUse).toHaveLength(1);
      expect(config.hooks.PreToolUse?.[0]?.matcher).toBe('Bash');
      expect(config.hooks.PreToolUse?.[0]?.hooks).toHaveLength(2);
      for (const guard of guards) {
        expect(config.hooks.PreToolUse?.[0]?.hooks.some(hook => hook.command === `"/path/to/slope-guard.sh" ${guard.name}`)).toBe(true);
      }
    });

    it('skips PreCompact guards (unsupported)', () => {
      const guards = GUARD_DEFINITIONS.filter(g => g.hookEvent === 'PreCompact');
      const config = adapter.generateHooksConfig(guards, '/path/to/slope-guard.sh');
      expect(config.hooks.PreCompact).toBeUndefined();
    });
  });

  describe('installGuards', () => {
    it('creates .codex/hooks directory and hooks.json', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-codex-install-'));
      mkdirSync(join(tmpDir, '.codex'), { recursive: true });

      const guards = GUARD_DEFINITIONS.filter(g => g.name === 'hazard');
      adapter.installGuards(tmpDir, guards);

      expect(existsSync(join(tmpDir, '.codex', 'hooks', 'slope-guard.sh'))).toBe(true);
      expect(existsSync(join(tmpDir, '.codex', 'hooks.json'))).toBe(true);
      if (process.platform !== 'win32') {
        expect(statSync(join(tmpDir, '.codex', 'hooks', 'slope-guard.sh')).mode & 0o111).toBeTruthy();
      }

      const config = JSON.parse(readFileSync(join(tmpDir, '.codex', 'hooks.json'), 'utf8'));
      expect(config.hooks.PreToolUse).toBeDefined();
      const script = readFileSync(join(tmpDir, '.codex', 'hooks', 'slope-guard.sh'), 'utf8');
      expect(script).toContain('#!/usr/bin/env bash');
      expect(script).toContain('exec npx --yes @slope-dev/slope guard "$@"');
      expect(script).not.toContain('SLOPE_BIN="npx --yes @slope-dev/slope"');
      expect(script).not.toContain('\r\n');
    });

    it('normalizes CRLF in existing generated dispatchers on reinstall', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-codex-install-'));
      const hooksDir = join(tmpDir, '.codex', 'hooks');
      mkdirSync(hooksDir, { recursive: true });
      const scriptPath = join(hooksDir, 'slope-guard.sh');
      writeFileSync(scriptPath, [
        '#!/usr/bin/env bash',
        '# SLOPE Codex guard dispatcher.',
        '',
        '# === SLOPE MANAGED (do not edit above this line) ===',
        'slope guard "$@"',
        '# === SLOPE END ===',
        '',
      ].join('\r\n'));

      const guards = GUARD_DEFINITIONS.filter(g => g.name === 'hazard');
      adapter.installGuards(tmpDir, guards);

      expect(readFileSync(scriptPath, 'utf8')).not.toContain('\r\n');
    });

    it('can install Codex guards to the user-level hooks directory', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'slope-codex-user-cwd-'));
      const homeDir = mkdtempSync(join(tmpdir(), 'slope-codex-user-home-'));

      const guards = GUARD_DEFINITIONS.filter(g => g.name === 'branch-before-commit');
      adapter.installGuards(cwd, guards, { scope: 'user', homeDir });

      const scriptPath = join(homeDir, '.codex', 'hooks', 'slope-guard.sh');
      const configPath = join(homeDir, '.codex', 'hooks.json');
      expect(existsSync(scriptPath)).toBe(true);
      expect(existsSync(configPath)).toBe(true);
      const script = readFileSync(scriptPath, 'utf8');
      expect(script).toContain('if [ ! -d "$SLOPE_PROJECT_DIR/.slope" ]; then');
      expect(script).toContain('dist/cli/index.js');

      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const commands = config.hooks.PreToolUse.flatMap((entry: { hooks: Array<{ command: string }> }) =>
        entry.hooks.map(h => h.command),
      );
      expect(commands).toEqual([`"${scriptPath}" branch-before-commit`]);
    });

    it('does not duplicate user-level Codex hook entries on reinstall', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'slope-codex-user-repeat-cwd-'));
      const homeDir = mkdtempSync(join(tmpdir(), 'slope-codex-user-repeat-home-'));
      const guards = GUARD_DEFINITIONS.filter(g => g.name === 'branch-before-commit');

      adapter.installGuards(cwd, guards, { scope: 'user', homeDir });
      adapter.installGuards(cwd, guards, { scope: 'user', homeDir });

      const config = JSON.parse(readFileSync(join(homeDir, '.codex', 'hooks.json'), 'utf8'));
      const commands = config.hooks.PreToolUse.flatMap((entry: { hooks: Array<{ command: string }> }) =>
        entry.hooks.map(h => h.command),
      );
      expect(commands.filter((cmd: string) => cmd.includes('branch-before-commit'))).toHaveLength(1);
    });

    it('installs claim-required under apply_patch/Edit/Write for user-level full installs', () => {
      const cwd = mkdtempSync(join(tmpdir(), 'slope-codex-user-full-cwd-'));
      const homeDir = mkdtempSync(join(tmpdir(), 'slope-codex-user-full-home-'));
      const guards = GUARD_DEFINITIONS.filter(g => g.level === 'full');

      adapter.installGuards(cwd, guards, { scope: 'user', homeDir });

      const config = JSON.parse(readFileSync(join(homeDir, '.codex', 'hooks.json'), 'utf8'));
      const group = findHookGroupForCommand(config.hooks.PreToolUse, 'claim-required');
      expect(group).toBeDefined();
      expect(group?.matcher?.split('|')).toEqual(expect.arrayContaining(['apply_patch', 'Edit', 'Write']));
    });

    it('preserves non-SLOPE hooks and does not duplicate managed entries', () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'slope-codex-merge-'));
      mkdirSync(join(tmpDir, '.codex'), { recursive: true });

      const configPath = join(tmpDir, '.codex', 'hooks.json');
      const existing = {
        hooks: {
          PreToolUse: [{
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo existing', timeout: 5 }],
          }],
        },
      };
      writeFileSync(configPath, JSON.stringify(existing, null, 2) + '\n');

      const guards = GUARD_DEFINITIONS.filter(g => g.name === 'hazard');
      adapter.installGuards(tmpDir, guards);
      adapter.installGuards(tmpDir, guards);

      const config = JSON.parse(readFileSync(configPath, 'utf8'));
      const commands = config.hooks.PreToolUse.flatMap((entry: { hooks: Array<{ command: string }> }) =>
        entry.hooks.map(h => h.command),
      );
      expect(commands.filter((cmd: string) => cmd === 'echo existing')).toHaveLength(1);
      expect(commands.filter((cmd: string) => cmd.includes('slope-guard.sh') && cmd.includes('hazard'))).toHaveLength(1);
    });
  });
});
