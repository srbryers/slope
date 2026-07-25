import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describeShellWrite, shellWriteGuard } from '../../../src/cli/guards/shell-write.js';
import type { HookInput } from '../../../src/core/index.js';

const LF = String.fromCharCode(10);
const SQ = String.fromCharCode(39);

function heredoc(...lines: string[]): string {
  return lines.join(LF);
}

function workspace(): string {
  const cwd = mkdtempSync(join(tmpdir(), 'slope-shell-write-'));
  mkdirSync(join(cwd, '.slope'), { recursive: true });
  writeFileSync(join(cwd, '.slope', 'config.json'), JSON.stringify({ scorecardDir: 'docs/retros' }));
  return cwd;
}

function bash(command: string): HookInput {
  return {
    session_id: 'shell-write-test',
    cwd: process.cwd(),
    hook_event_name: 'PreToolUse',
    tool_name: 'Bash',
    tool_input: { command },
  } as unknown as HookInput;
}

describe('describeShellWrite', () => {
  describe('flags writing file content through a shell', () => {
    it('flags python -c that opens a file for writing', () => {
      // The real failure: backticks in the script were substituted by bash,
      // silently deleting every code span from a markdown rule.
      const command = `python -c "import io; io.open(${SQ}x.md${SQ}, ${SQ}w${SQ}).write(s)"`;
      expect(describeShellWrite(command)).toContain('inline script that writes a file');
    });

    it('flags a heredoc-fed interpreter that writes a file', () => {
      // The real failure, twice: a literal newline escape became a real newline,
      // producing unterminated TypeScript string literals.
      const command = heredoc(
        `python - <<${SQ}EOF${SQ}`,
        `io.open(${SQ}t.ts${SQ}, ${SQ}w${SQ}, encoding=${SQ}utf-8${SQ}).write(out)`,
        'EOF',
      );
      expect(describeShellWrite(command)).toContain('inline script that writes a file');
    });

    it('flags a heredoc redirected straight into a file', () => {
      const command = heredoc(`cat > tests/foo.test.ts <<${SQ}EOF${SQ}`, 'content', 'EOF');
      expect(describeShellWrite(command)).toContain('redirects a heredoc into a file');
    });

    it.each([
      [`node -e "require(${SQ}fs${SQ}).writeFileSync(${SQ}a.ts${SQ}, s)"`, 'writeFileSync'],
      [`node -e "require(${SQ}fs${SQ}).appendFileSync(${SQ}a.ts${SQ}, s)"`, 'appendFileSync'],
      [`python -c "from pathlib import Path; Path(${SQ}a.md${SQ}).write_text(s)"`, 'pathlib write_text'],
    ])('flags %s', command => {
      expect(describeShellWrite(command)).not.toBeNull();
    });
  });

  describe('leaves legitimate inline scripting alone', () => {
    // Reading, computing and printing inline has one escaping layer and is correct.
    // Flagging it would make the guard noise, which is what killed scope-drift's
    // signal (GH #651).
    it.each([
      [`python -c "import json; print(json.load(open(${SQ}package.json${SQ}))[${SQ}version${SQ}])"`, 'read and print'],
      ['node -e "console.log(process.version)"', 'print only'],
      ['node dist/cli/index.js roadmap compile', 'running a built CLI'],
      ['python scripts/foo.py', 'running a script file — the recommended path'],
      ['grep -rn "pattern" src/ | head -5', 'plain shell'],
    ])('stays silent for %s', command => {
      expect(describeShellWrite(command)).toBeNull();
    });

    it('stays silent for a heredoc feeding a commit message rather than a file', () => {
      const command = `git commit -q -m "$(cat <<EOF${LF}message body${LF}EOF${LF})"`;
      expect(describeShellWrite(command)).toBeNull();
    });
  });
});

describe('shellWriteGuard', () => {
  it('emits advisory context, never a decision', async () => {
    const cwd = workspace();
    try {
      const command = `python -c "import io; io.open(${SQ}x.md${SQ}, ${SQ}w${SQ}).write(s)"`;
      const result = await shellWriteGuard(bash(command), cwd);

      expect(result.decision).toBeUndefined();
      expect(result.context).toContain('Write tool');
      expect(result.context).toContain('Read back anything a script wrote');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('warns once per session', async () => {
    const cwd = workspace();
    try {
      const command = `python -c "import io; io.open(${SQ}x.md${SQ}, ${SQ}w${SQ}).write(s)"`;
      const first = await shellWriteGuard(bash(command), cwd);
      const second = await shellWriteGuard(bash(command), cwd);

      expect(first.context).toBeTruthy();
      expect(second.context ?? '').not.toBe(first.context);
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });

  it('ignores non-Bash tools', async () => {
    const cwd = workspace();
    try {
      const input = { ...bash('irrelevant'), tool_name: 'Write' } as HookInput;
      const result = await shellWriteGuard(input, cwd);

      expect(result.context).toBeUndefined();
      expect(result.metricReason).toBe('irrelevant-tool');
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
