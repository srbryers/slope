// SLOPE — Shell command parsing for Bash PreToolUse guards.
//
// Guards used to match flags with a regex over the raw invocation. That fires
// on any command that merely *carries* the text — a `gh issue create` body, a
// heredoc writing documentation about the flag, a commit message — and the
// rewrite those guards suggest is produced by the same blind substitution, so
// following the advice edits prose instead of fixing a command (#683).
//
// These helpers segment an invocation into discrete commands and their argv
// tokens, tracking each token's byte span so a guard can splice one out and
// leave the rest of the command byte-identical.

export interface CommandToken {
  /** Token text with quoting removed. */
  value: string;
  /** Offset of the token's first character in the original command string. */
  start: number;
  /** Offset one past the token's last character. */
  end: number;
  /** True when any part of the token was written inside quotes. */
  quoted: boolean;
}

export interface ParsedCommand {
  tokens: CommandToken[];
}

const SEPARATOR_CHARS = new Set([';', '|', '&', '\n']);

/** Characters a backslash actually escapes. A backslash before anything else
 *  stays literal — POSIX says so inside double quotes, and it is what keeps a
 *  Windows path (`cd "C:\Users\me\wt"`) intact rather than collapsing it to
 *  `C:Usersmewt`. Guards resolve `cd` targets from these tokens, so eating
 *  the separators silently pointed them at the wrong directory. */
const DOUBLE_QUOTE_ESCAPABLE = new Set(['$', '`', '"', '\\', '\n']);
const UNQUOTED_ESCAPABLE = new Set([
  '\\', '"', "'", ' ', '$', '`', '&', '|', ';', '\n', '\r', '<', '>', '(', ')',
]);

/** Segment a shell invocation into commands and argv tokens.
 *
 *  Quoting, backslash escapes and heredoc bodies are all honoured, so text
 *  that is *data* rather than *command* never appears as a token: a heredoc
 *  body is skipped entirely, and a quoted string becomes one token flagged
 *  `quoted` so flag matching can ignore it.
 *
 *  This is a pragmatic parser, not a POSIX shell. It does not expand
 *  variables, resolve subshells, or track redirection targets — a guard only
 *  needs to know which words were passed to which command.
 */
export function parseShellCommands(command: string): ParsedCommand[] {
  const commands: ParsedCommand[] = [];
  let tokens: CommandToken[] = [];

  let value = '';
  let start = -1;
  let quoted = false;

  // Heredoc delimiters seen on the current line, awaiting their body.
  const pendingHeredocs: PendingHeredoc[] = [];

  function endToken(end: number): void {
    if (start === -1) return;
    tokens.push({ value, start, end, quoted });
    value = '';
    start = -1;
    quoted = false;
  }

  function endCommand(end: number): void {
    endToken(end);
    if (tokens.length > 0) commands.push({ tokens });
    tokens = [];
  }

  function beginToken(at: number): void {
    if (start === -1) start = at;
  }

  let i = 0;
  while (i < command.length) {
    const ch = command[i];

    // A newline closes the command, then any heredoc bodies queued on that
    // line are consumed as data and never tokenized.
    if (ch === '\n') {
      endCommand(i);
      i++;
      i = skipHeredocBodies(command, i, pendingHeredocs);
      continue;
    }

    if (ch === '\\' && i + 1 < command.length) {
      // A backslash-newline is a line continuation, not a token character.
      if (command[i + 1] === '\n') {
        i += 2;
        continue;
      }
      beginToken(i);
      if (UNQUOTED_ESCAPABLE.has(command[i + 1])) {
        value += command[i + 1];
        i += 2;
      } else {
        value += ch;
        i++;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      beginToken(i);
      quoted = true;
      i = readQuoted(command, i, ch, s => { value += s; });
      continue;
    }

    if (ch === '<') {
      let run = 0;
      while (command[i + run] === '<') run++;
      // Exactly `<<` (or `<<-`) opens a heredoc: record the delimiter, drop it
      // from the token stream, and let the newline handler skip the body.
      if (run === 2) {
        endToken(i);
        i = readHeredocDelimiter(command, i, pendingHeredocs);
        continue;
      }
      // `<` and the `<<<` herestring are redirects — their own token, so the
      // word after them is never mistaken for a heredoc delimiter.
      endToken(i);
      tokens.push({ value: command.slice(i, i + run), start: i, end: i + run, quoted: false });
      i += run;
      continue;
    }

    if (SEPARATOR_CHARS.has(ch)) {
      endCommand(i);
      // Consume the full operator (`&&`, `||`, `;;`) so it never starts a token.
      while (i < command.length && SEPARATOR_CHARS.has(command[i]) && command[i] !== '\n') i++;
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      endToken(i);
      i++;
      continue;
    }

    beginToken(i);
    value += ch;
    i++;
  }

  endCommand(command.length);
  return commands;
}

/** Read a quoted run starting at `open`. Returns the offset just past the
 *  closing quote (or end of string when the quote is unterminated). */
function readQuoted(command: string, open: number, quote: string, emit: (s: string) => void): number {
  let i = open + 1;
  while (i < command.length) {
    const ch = command[i];
    if (ch === '\\' && quote === '"' && i + 1 < command.length) {
      if (DOUBLE_QUOTE_ESCAPABLE.has(command[i + 1])) {
        emit(command[i + 1]);
        i += 2;
      } else {
        emit(ch);
        i++;
      }
      continue;
    }
    if (ch === quote) return i + 1;
    emit(ch);
    i++;
  }
  return i;
}

/** A heredoc opener awaiting its body. */
interface PendingHeredoc {
  delimiter: string;
  /** `<<-` strips leading TABS (never spaces) from the terminator. */
  stripTabs: boolean;
}

/** Read the delimiter word of a heredoc opener at `<<`, pushing it onto
 *  `pending`. Returns the offset just past the delimiter. */
function readHeredocDelimiter(command: string, at: number, pending: PendingHeredoc[]): number {
  let i = at + 2;
  const stripTabs = command[i] === '-';
  if (stripTabs) i++;
  while (i < command.length && (command[i] === ' ' || command[i] === '\t')) i++;

  let delimiter = '';
  while (i < command.length) {
    const ch = command[i];
    if (ch === "'" || ch === '"') {
      i = readQuoted(command, i, ch, s => { delimiter += s; });
      continue;
    }
    // `\r` must break the delimiter: on a CRLF invocation the opener would
    // otherwise yield `EOF\r`, which no body line ever matches, and the
    // parser would swallow the rest of the command — silently disarming
    // every guard built on it. This repo runs on Windows.
    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || SEPARATOR_CHARS.has(ch)) break;
    delimiter += ch;
    i++;
  }

  if (delimiter.length > 0) pending.push({ delimiter, stripTabs });
  return i;
}

/** Skip heredoc bodies starting at `from`, one per queued delimiter. Returns
 *  the offset of the first character that is command text again. */
function skipHeredocBodies(command: string, from: number, pending: PendingHeredoc[]): number {
  let i = from;
  while (pending.length > 0) {
    const { delimiter, stripTabs } = pending.shift() as PendingHeredoc;
    let closed = false;
    while (i < command.length) {
      let lineEnd = command.indexOf('\n', i);
      if (lineEnd === -1) lineEnd = command.length;
      // The terminator must match the raw line. Trimming it would close the
      // heredoc on an indented BODY line, which puts the rest of the document
      // back into the token stream — reintroducing the #683 false positive
      // this module exists to remove, and making the guard's suggested
      // rewrite edit the document body. Only `<<-` strips, only tabs, only
      // leading. A trailing `\r` is a line ending, not content.
      let line = command.slice(i, lineEnd);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (stripTabs) line = line.replace(/^\t+/, '');
      i = lineEnd + 1;
      if (line === delimiter) {
        closed = true;
        break;
      }
    }
    // An unterminated heredoc means the `<<` probably was not an opener at
    // all — `echo $((1 << 3))`, a `--pretty=format:%h<<%s` argument. The shell
    // would swallow the rest of the input; a guard must not, because
    // discarding the remainder makes it silently see nothing and fail OPEN on
    // whatever followed. Hand the text back to the tokenizer instead.
    if (!closed) return from;
  }
  return Math.min(i, command.length);
}

/** One command plus the raw source text it came from. */
export interface CommandSegment {
  /** The original text of this command, spanning its first to last token. */
  text: string;
  /** Unquoted argv words, in order. */
  words: string[];
  command: ParsedCommand;
}

/** Segment an invocation into commands with their source text and argv words.
 *
 *  The drop-in replacement for the hand-rolled `splitShellSegments` +
 *  `tokenizeShellWords` pairs that several guards carried. Those split on
 *  quote-aware separators but knew nothing about heredocs, so every line of a
 *  heredoc BODY became its own "command" — which let documentation about a
 *  command trigger guards that act on it (#683).
 */
export function shellCommandSegments(command: string): CommandSegment[] {
  return parseShellCommands(command).map(cmd => {
    const first = cmd.tokens[0];
    const last = cmd.tokens[cmd.tokens.length - 1];
    return {
      text: command.slice(first.start, last.end),
      words: cmd.tokens.map(token => token.value),
      command: cmd,
    };
  });
}

/** True when `cmd` invokes the given program and subcommand path, e.g.
 *  `commandMatches(cmd, ['gh', 'pr', 'merge'])`. Leading `env`-style variable
 *  assignments (`FOO=bar gh pr merge`) are skipped. Quoted words do not count
 *  as the program name, so text inside a string never matches. */
export function commandMatches(
  cmd: ParsedCommand,
  path: string[],
  options: { skipGhGlobalFlags?: boolean } = {},
): boolean {
  let words = argvWords(cmd);
  // `gh -R owner/repo pr merge` is the same command as `gh pr merge`; without
  // this the global flags push the subcommand out of position and the guard
  // silently does not fire.
  if (options.skipGhGlobalFlags && words[0]?.value === 'gh' && !words[0].quoted) {
    words = [words[0], ...skipGhGlobalFlagTokens(words.slice(1))];
  }
  if (words.length < path.length) return false;
  for (let i = 0; i < path.length; i++) {
    const token = words[i];
    if (token.quoted || token.value !== path[i]) return false;
  }
  return true;
}

/** `gh` global flags that consume the following word as their value. */
const GH_GLOBAL_FLAGS_WITH_VALUE = new Set(['-R', '--repo', '--hostname', '--config']);

function skipGhGlobalFlagTokens(words: CommandToken[]): CommandToken[] {
  let i = 0;
  while (words[i] != null && !words[i].quoted && words[i].value.startsWith('-')) {
    const flag = words[i].value;
    if (flag === '--') return words.slice(i + 1);
    i += GH_GLOBAL_FLAGS_WITH_VALUE.has(flag) ? 2 : 1;
  }
  return words.slice(i);
}

/** Every command in `command` that invokes the given program and subcommand
 *  path. Use this instead of a regex over the raw invocation: it will not
 *  match the path inside a quoted argument or a heredoc body. */
export function findCommands(command: string, path: string[]): ParsedCommand[] {
  return parseShellCommands(command).filter(cmd => commandMatches(cmd, path));
}

/** The unquoted, non-flag words a command was given after its subcommand
 *  path — `git worktree remove --force ../wt` with a path length of 3 yields
 *  `['../wt']`. Everything after a bare `--` counts as positional. */
export function positionalArgs(cmd: ParsedCommand, pathLength: number): CommandToken[] {
  const words = argvWords(cmd).slice(pathLength);
  const positional: CommandToken[] = [];
  let terminated = false;
  for (const token of words) {
    if (!terminated && token.value === '--') {
      terminated = true;
      continue;
    }
    if (!terminated && !token.quoted && token.value.startsWith('-')) continue;
    positional.push(token);
  }
  return positional;
}

/** The command's tokens with leading environment assignments removed. */
function argvWords(cmd: ParsedCommand): CommandToken[] {
  let i = 0;
  while (i < cmd.tokens.length && !cmd.tokens[i].quoted && /^[A-Za-z_][A-Za-z0-9_]*=/.test(cmd.tokens[i].value)) i++;
  return cmd.tokens.slice(i);
}

/** Find a flag passed as an argument of `cmd`. `names` are matched against the
 *  whole token (`--delete-branch`) or its `--flag=value` head, never as a
 *  substring — so `cut -d= -f2-` does not match `-d`, and a quoted argument
 *  that happens to contain the flag text is ignored.
 *
 *  Everything after a bare `--` is a positional argument, not a flag. */
export function findFlagToken(cmd: ParsedCommand, names: string[]): CommandToken | null {
  const wanted = new Set(names);
  for (const token of argvWords(cmd)) {
    if (token.quoted) continue;
    if (token.value === '--') return null;
    if (wanted.has(token.value)) return token;
    // `--flag=value` is one spelling of a long flag. Short flags take their
    // value adjacently instead (`cut -d=` sets the delimiter to `=`), so
    // splitting them on `=` would match `-d` where no such flag was passed.
    if (!token.value.startsWith('--')) continue;
    const eq = token.value.indexOf('=');
    if (eq > 0 && wanted.has(token.value.slice(0, eq))) return token;
  }
  return null;
}

/** Remove one token from the original command text, along with the whitespace
 *  that separated it from the previous token. Every other byte is preserved,
 *  so the suggested rewrite differs from the original only by the flag. */
export function removeToken(command: string, token: CommandToken): string {
  let cut = token.start;
  while (cut > 0 && (command[cut - 1] === ' ' || command[cut - 1] === '\t')) cut--;
  // A flag at the very start of a command has no preceding separator to eat;
  // drop the whitespace that follows it instead.
  if (cut === 0 || command[cut - 1] === '\n') {
    let end = token.end;
    while (end < command.length && (command[end] === ' ' || command[end] === '\t')) end++;
    return command.slice(0, token.start) + command.slice(end);
  }
  return command.slice(0, cut) + command.slice(token.end);
}
