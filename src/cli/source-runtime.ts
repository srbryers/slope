import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

const SLOPE_PACKAGE_NAME = '@slope-dev/slope';
const MACHINE_OUTPUT_SUBCOMMANDS = new Set(['guard']);

export interface SourceRuntimeWarningOptions {
  cwd: string;
  cliEntryPath: string;
  args?: string[];
  env?: NodeJS.ProcessEnv;
}

export function buildSourceCheckoutRuntimeWarning(options: SourceRuntimeWarningOptions): string | null {
  const env = options.env ?? process.env;
  if (env.SLOPE_SOURCE_RUNTIME_WARNING === '0') return null;

  const args = options.args ?? [];
  if (args[0] && MACHINE_OUTPUT_SUBCOMMANDS.has(args[0])) return null;

  const cwd = resolve(options.cwd);
  if (!isSlopeSourceCheckout(cwd)) return null;

  const runtimePath = resolve(options.cliEntryPath);
  if (isPathInside(cwd, runtimePath)) return null;

  const command = formatLocalCliCommand(args);
  return [
    'SLOPE source checkout warning: this command is running an installed SLOPE binary outside the current source checkout.',
    `  Checkout: ${cwd}`,
    `  Runtime:  ${runtimePath}`,
    '  Branch-local changes are only active through the built checkout CLI.',
    `  Use: ${command}`,
  ].join('\n');
}

export function isSlopeSourceCheckout(cwd: string): boolean {
  const pkg = readPackageJson(join(cwd, 'package.json'));
  return pkg?.name === SLOPE_PACKAGE_NAME;
}

function readPackageJson(path: string): { name?: unknown } | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as { name?: unknown };
  } catch {
    return null;
  }
}

function isPathInside(parent: string, child: string): boolean {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (rel.length > 0 && !rel.startsWith('..') && !isAbsolute(rel));
}

function formatLocalCliCommand(args: string[]): string {
  const suffix = args.length > 0 ? ` ${args.map(formatArg).join(' ')}` : ' <command>';
  return `pnpm build && node dist/cli/index.js${suffix}`;
}

function formatArg(arg: string): string {
  return /^[A-Za-z0-9_./:=@+-]+$/.test(arg) ? arg : JSON.stringify(arg);
}
