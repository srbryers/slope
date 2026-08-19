import { describe, it, expect } from 'vitest';
import {
  parseShellCommands,
  commandMatches,
  findFlagToken,
  removeToken,
} from '../../../src/cli/guards/command-parse.js';

function values(command: string): string[][] {
  return parseShellCommands(command).map(c => c.tokens.map(t => t.value));
}

describe('parseShellCommands', () => {
  it('splits on the shell operators', () => {
    expect(values('a b && c | d ; e')).toEqual([['a', 'b'], ['c'], ['d'], ['e']]);
  });

  it('keeps a quoted argument as one token', () => {
    expect(values('gh issue create --body "one two three"')).toEqual([
      ['gh', 'issue', 'create', '--body', 'one two three'],
    ]);
  });

  it('does not split on operators inside quotes', () => {
    expect(values('echo "a && b ; c"')).toEqual([['echo', 'a && b ; c']]);
  });

  it('marks quoted tokens so they are never read as commands or flags', () => {
    const [cmd] = parseShellCommands('echo "gh pr merge --delete-branch"');
    expect(cmd.tokens[1].quoted).toBe(true);
    expect(cmd.tokens[0].quoted).toBe(false);
  });

  it('skips a heredoc body entirely', () => {
    const parsed = values("python3 - <<'PY' > out.txt\ngh pr merge --delete-branch\nPY\necho done");
    expect(parsed).toEqual([['python3', '-', '>', 'out.txt'], ['echo', 'done']]);
  });

  it('handles an unquoted and a tab-indented heredoc delimiter', () => {
    expect(values('cat <<-EOF\n\tbody line\n\tEOF\ntrue')).toEqual([['cat'], ['true']]);
  });

  it('treats an unterminated heredoc as swallowing the rest, like the shell', () => {
    expect(values("cat <<'EOF'\nnever closed\n")).toEqual([['cat']]);
  });

  it('does not treat a herestring as a heredoc', () => {
    expect(values('grep x <<< "some text"')).toEqual([['grep', 'x', '<<<', 'some text']]);
  });

  it('records byte spans that map back to the original text', () => {
    const command = 'gh pr merge 117 --squash --delete-branch';
    const [cmd] = parseShellCommands(command);
    const flag = cmd.tokens[cmd.tokens.length - 1];
    expect(command.slice(flag.start, flag.end)).toBe('--delete-branch');
  });
});

describe('commandMatches', () => {
  it('matches a subcommand path', () => {
    const [cmd] = parseShellCommands('gh pr merge 117 --squash');
    expect(commandMatches(cmd, ['gh', 'pr', 'merge'])).toBe(true);
  });

  it('does not match when the words are quoted text', () => {
    const [cmd] = parseShellCommands('echo "gh pr merge"');
    expect(commandMatches(cmd, ['gh', 'pr', 'merge'])).toBe(false);
  });

  it('skips leading environment assignments', () => {
    const [cmd] = parseShellCommands('GH_TOKEN=x gh pr merge 117');
    expect(commandMatches(cmd, ['gh', 'pr', 'merge'])).toBe(true);
  });

  it('does not match a different subcommand', () => {
    const [cmd] = parseShellCommands('gh pr create --fill');
    expect(commandMatches(cmd, ['gh', 'pr', 'merge'])).toBe(false);
  });
});

describe('findFlagToken', () => {
  it('finds a long flag', () => {
    const [cmd] = parseShellCommands('gh pr merge 117 --delete-branch');
    expect(findFlagToken(cmd, ['--delete-branch'])?.value).toBe('--delete-branch');
  });

  it('finds a --flag=value head', () => {
    const [cmd] = parseShellCommands('gh pr merge 117 --delete-branch=true');
    expect(findFlagToken(cmd, ['--delete-branch'])?.value).toBe('--delete-branch=true');
  });

  // The bug behind `cut -d= -f2-` being rewritten to `cut= -f2-` (#683).
  it('does not match -d as a substring of another flag', () => {
    const [cmd] = parseShellCommands('cut -d= -f2-');
    expect(findFlagToken(cmd, ['-d'])).toBeNull();
  });

  it('ignores the flag when it appears inside a quoted argument', () => {
    const [cmd] = parseShellCommands('gh issue create --body "mentions --delete-branch in prose"');
    expect(findFlagToken(cmd, ['--delete-branch'])).toBeNull();
  });

  it('ignores anything after a bare -- terminator', () => {
    const [cmd] = parseShellCommands('some-tool -- --delete-branch');
    expect(findFlagToken(cmd, ['--delete-branch'])).toBeNull();
  });
});

describe('removeToken', () => {
  it('leaves every other byte identical', () => {
    const command = 'gh pr merge 117 --squash --delete-branch --admin';
    const [cmd] = parseShellCommands(command);
    const flag = findFlagToken(cmd, ['--delete-branch']);
    expect(removeToken(command, flag!)).toBe('gh pr merge 117 --squash --admin');
  });

  it('preserves a following pipeline verbatim', () => {
    const command = 'gh pr merge 117 -d | tee log.txt';
    const [cmd] = parseShellCommands(command);
    const flag = findFlagToken(cmd, ['-d']);
    expect(removeToken(command, flag!)).toBe('gh pr merge 117 | tee log.txt');
  });
});
