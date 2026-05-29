import { storeRecoverySuggestions } from './commands/store.js';

export function formatCliError(err: unknown, cwd = process.cwd()): string[] {
  const message = err instanceof Error ? err.message : String(err);
  const lines = [`Error: ${message}`];
  const recovery = storeRecoverySuggestions(message, cwd);
  if (recovery.length > 0) {
    lines.push('Recovery:');
    for (const suggestion of recovery) {
      lines.push(`  - ${suggestion}`);
    }
  }
  return lines;
}

export function reportCliError(err: unknown): never {
  for (const line of formatCliError(err)) {
    console.error(line);
  }
  process.exit(1);
}
