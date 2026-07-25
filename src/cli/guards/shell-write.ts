import type { HookInput, GuardResult } from '../../core/index.js';
import { dedupGuardContext } from '../session-state.js';

/**
 * Inline interpreter invocations — a script passed on the command line or piped in
 * from a heredoc, rather than run from a file.
 */
const INLINE_INTERPRETER = [
  /\b(?:python|python3|py)\s+(?:-\S+\s+)*-c\b/,
  /\bnode\s+(?:--\S+\s+)*(?:-e|--eval|--print)\b/,
  /\b(?:perl|ruby)\s+-e\b/,
  /\b(?:python|python3|py|node|perl|ruby)\s+-\s*<</,
  /\b(?:python|python3|py|node|perl|ruby)\s+<</,
];

/**
 * Calls that write a file. The interpreter alone is not the hazard — reading,
 * computing and printing inline is correct and common. Writing file content
 * through a shell is what stacks escaping layers.
 */
const FILE_WRITE_CALL = [
  /\bopen\s*\([^)]*['"][wa]\+?b?['"]/,      // python open(path, 'w')
  /\bio\.open\s*\([^)]*['"][wa]/,           // python io.open(path, 'w')
  /\.write_text\s*\(/,                      // pathlib
  /\bwriteFileSync\b/,
  /\bappendFileSync\b/,
  /\bcreateWriteStream\b/,
  /\bfs\.promises\.writeFile\b/,
  /\bFile\.write\b/,                        // ruby
];

/** A heredoc redirected straight into a file: `cat > x.ts <<'EOF'`. */
const HEREDOC_TO_FILE = /(?:^|[;&|]\s*)(?:cat|tee)\s+[^<|;&]*>>?\s*\S+[^<]*<</;

/**
 * shell-write guard: fires PreToolUse on Bash.
 *
 * Warns when file content is written through a shell rather than with the Write
 * or Edit tools. Advisory only, once per session.
 *
 * Escaping in shell-inline scripts mangled a write three times in one session on
 * this repo, the second and third after the first was already recorded in a
 * scorecard — documentation alone did not fix it. `python -c` with backticks had
 * them substituted by bash, silently deleting every code span from a markdown
 * rule; a heredoc twice emitted a real newline where a literal \\n was wanted,
 * producing unterminated TypeScript string literals. All three exited 0 with wrong
 * content, so nothing failed loudly.
 *
 * Deliberately keyed on a file-write call, not on the interpreter: inline scripting
 * that only reads, computes or prints has one escaping layer and was used
 * constantly and correctly.
 */
export async function shellWriteGuard(input: HookInput, cwd: string): Promise<GuardResult> {
  if (input.tool_name !== 'Bash') return { metricReason: 'irrelevant-tool' };

  const command = typeof input.tool_input?.command === 'string' ? input.tool_input.command : '';
  if (!command) return { metricReason: 'no-command' };

  const reason = describeShellWrite(command);
  if (!reason) return { metricReason: 'no-match' };

  const message = [
    `SLOPE advisory (non-blocking) — ${reason}`,
    'Use the Write tool for new files and Edit for changes; both take literal content with no escaping layer.',
    'If scripting is genuinely needed, write the script to a file and run it — never inline it.',
    'Read back anything a script wrote: this class of failure exits 0 with wrong content.',
  ].join('\n');

  const dedup = dedupGuardContext(cwd, input.session_id, 'shell-write', message);
  if (dedup === '') return { metricReason: 'budget-exhausted' };
  return { metricReason: 'matched', context: dedup ?? message };
}

/** Describe how a command writes file content through a shell, or null. */
export function describeShellWrite(command: string): string | null {
  if (HEREDOC_TO_FILE.test(command)) {
    return 'this redirects a heredoc into a file, so the shell processes the content on its way to disk.';
  }

  const interpreter = INLINE_INTERPRETER.some(pattern => pattern.test(command));
  if (!interpreter) return null;

  const writes = FILE_WRITE_CALL.some(pattern => pattern.test(command));
  if (!writes) return null;

  return 'this runs an inline script that writes a file, stacking shell and script escaping.';
}
