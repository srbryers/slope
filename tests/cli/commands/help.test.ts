import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { helpCommand, printDefaultHelp } from '../../../src/cli/commands/help.js';

let consoleOutput: string[];
let consoleErrors: string[];

beforeEach(() => {
  consoleOutput = [];
  consoleErrors = [];
  vi.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
    consoleOutput.push(args.map(String).join(' '));
  });
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    consoleErrors.push(args.map(String).join(' '));
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('slope help', () => {
  it('prints a bounded human surface by default', async () => {
    await helpCommand([]);

    const output = consoleOutput.join('\n');
    expect(output).toContain('SLOPE - Human Command Surface');
    expect(output).toContain('now');
    expect(output).toContain('start');
    expect(output).toContain('briefing');
    expect(output).toContain('review');
    expect(output).toContain('doctor');
    expect(output).toContain('roadmap');
    expect(output).toContain('slope help --all');
    expect(output).not.toContain('claim');
    expect(output).not.toContain('guard');
    expect(output).not.toContain('auto-card');
    expect(output.split('\n').length).toBeLessThanOrEqual(25);
  });

  it('uses the same bounded surface for global help rendering', () => {
    printDefaultHelp();

    const output = consoleOutput.join('\n');
    expect(output).toContain('SLOPE - Human Command Surface');
    expect(output).not.toContain('Full Command Reference');
  });

  it('shows the full registry with audience labels behind --all', async () => {
    await helpCommand(['--all']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('SLOPE CLI - Full Command Reference');
    expect(output).toContain('claim');
    expect(output).toContain('[agent]');
    expect(output).toContain('guard');
    expect(output).toContain('[internal]');
    expect(output).toContain('Run `slope help` for the bounded human surface');
  });

  it('shows command detail with audience metadata', async () => {
    await helpCommand(['claim']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('slope claim');
    expect(output).toContain('Category: lifecycle');
    expect(output).toContain('Audience: agent');
    expect(output).toContain('--target=<path>');
  });

  it('shows roadmap interview and vision-generation breadcrumbs', async () => {
    await helpCommand(['roadmap']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('slope roadmap interview');
    expect(output).toContain('alias of slope interview');
    expect(output).toContain('slope vision create/update');
    expect(output).toContain('--dry-run');
  });

  it('shows precise retro learning prefix syntax in command detail', async () => {
    await helpCommand(['retro']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('workflow|style|project|hazard|other[:1-10]:text');
    expect(output).toContain('process->workflow alias');
  });

  it('teaches the --all escape hatch in help usage', async () => {
    await helpCommand(['--help']);

    const output = consoleOutput.join('\n');
    expect(output).toContain('slope help --all');
    expect(output).toContain('bounded human command surface');
  });
});
