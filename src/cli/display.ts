// SLOPE — Shared Display Helpers
// Visual components used by both demo and interactive-init flows.

// --- Color helpers (raw ANSI, TTY-aware) ---

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

export type Colors = ReturnType<typeof createColors>;

export function createColors(enabled: boolean) {
  const wrap = (code: string) => enabled
    ? (s: string) => `\x1b[${code}m${s}\x1b[0m`
    : (s: string) => s;
  return {
    bold: wrap('1'),
    dim: wrap('2'),
    green: wrap('32'),
    boldCyan: wrap('1;36'),
    boldGreen: wrap('1;32'),
    boldYellow: wrap('1;33'),
    boldWhite: wrap('1;37'),
    boldRed: wrap('1;31'),
    dimCyan: wrap('2;36'),
    dimItalic: wrap('2;3'),
  };
}

// --- Helpers ---

export function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

export function wordWrap(text: string, width: number): string {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) lines.push(line);
  return lines.join('\n');
}

export async function typewrite(prefix: string, text: string, charDelay: number): Promise<void> {
  const indent = ' '.repeat(stripAnsi(prefix).length);
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const lp = i === 0 ? prefix : indent;
    process.stdout.write(lp);
    // Emit ANSI escape sequences atomically so colors don't break typewriter effect
    const tokens = lines[i].match(/\x1b\[[0-9;]*m|./gs) ?? [];
    for (const tok of tokens) {
      process.stdout.write(tok);
      if (charDelay > 0 && !tok.startsWith('\x1b')) await sleep(charDelay);
    }
    process.stdout.write('\n');
  }
}

export async function mcpCall(label: string, result: string, delay: number, c: Colors): Promise<void> {
  const line = result
    ? `  ${c.dim('\u25b8 ' + label.padEnd(32))} \u2192 ${c.bold(result)}`
    : `  ${c.dim('\u25b8 ' + label)}`;
  console.log(line);
  await sleep(delay);
}

export async function revealLines(lines: string[], lineDelay: number): Promise<void> {
  for (const line of lines) {
    console.log(line);
    if (lineDelay > 0) await sleep(lineDelay);
  }
}

// --- Vision Box ---

/** Render a static vision box (no typewriter animation). */
export function renderVisionBox(
  fields: { heading: string; value: string }[],
  c: Colors,
  isTTY: boolean,
): void {
  const contentWidth = 52;
  const innerWidth = contentWidth + 4; // 2-char pad each side
  const b = (s: string) => c.dimCyan(s);

  const printBoxLine = (text: string, ansiCode?: string) => {
    const styled = ansiCode && isTTY
      ? `\x1b[${ansiCode}m${text}\x1b[0m`
      : text;
    const rightPad = ' '.repeat(Math.max(0, contentWidth - text.length + 2));
    console.log(b('\u2502') + '  ' + styled + rightPad + b('\u2502'));
  };

  const emptyLine = () => console.log(
    b('\u2502') + ' '.repeat(innerWidth) + b('\u2502')
  );

  // Top border
  const title = ' Vision ';
  const topRule = '\u2500'.repeat(innerWidth - title.length - 2);
  console.log(b('\u256d\u2500') + b(title) + b(topRule) + b('\u256e'));
  emptyLine();

  for (let i = 0; i < fields.length; i++) {
    const { heading, value } = fields[i];
    printBoxLine(heading, '2'); // dim heading
    const lines = wordWrap(value, contentWidth).split('\n');
    for (const line of lines) {
      printBoxLine(line, '1;37'); // bold white value
    }
    emptyLine(); // spacing between fields
  }

  // Bottom border
  console.log(b('\u2570') + b('\u2500'.repeat(innerWidth)) + b('\u256f'));
}

/** Render a vision box with typewriter animation (for demo). */
export async function typewriteVision(
  fields: { heading: string; value: string }[],
  charDelay: number, c: Colors, isTTY: boolean,
): Promise<void> {
  const contentWidth = 52;
  const innerWidth = contentWidth + 4; // 2-char pad each side
  const b = (s: string) => c.dimCyan(s);

  const printBoxLine = (text: string, ansiCode?: string) => {
    const styled = ansiCode && isTTY
      ? `\x1b[${ansiCode}m${text}\x1b[0m`
      : text;
    const rightPad = ' '.repeat(Math.max(0, contentWidth - text.length + 2));
    console.log(b('\u2502') + '  ' + styled + rightPad + b('\u2502'));
  };

  const typeInBox = async (text: string, ansiCode: string) => {
    const display = text.slice(0, contentWidth);
    const rightPad = ' '.repeat(Math.max(0, contentWidth - display.length + 2));
    process.stdout.write(b('\u2502') + '  ');
    if (charDelay > 0 && isTTY) {
      process.stdout.write(`\x1b[${ansiCode}m`);
      for (const ch of display) {
        process.stdout.write(ch);
        await sleep(Math.max(1, Math.floor(charDelay * 0.4)));
      }
      process.stdout.write('\x1b[0m');
    } else {
      process.stdout.write(isTTY ? `\x1b[${ansiCode}m${display}\x1b[0m` : display);
    }
    process.stdout.write(rightPad + b('\u2502') + '\n');
  };

  const emptyLine = () => console.log(
    b('\u2502') + ' '.repeat(innerWidth) + b('\u2502')
  );

  // Top border
  const title = ' Vision ';
  const topRule = '\u2500'.repeat(innerWidth - title.length - 2);
  console.log(b('\u256d\u2500') + b(title) + b(topRule) + b('\u256e'));
  emptyLine();

  for (let i = 0; i < fields.length; i++) {
    const { heading, value } = fields[i];
    printBoxLine(heading, '2'); // dim heading
    const lines = wordWrap(value, contentWidth).split('\n');
    for (const line of lines) {
      await typeInBox(line, '1;37'); // bold white value
    }
    emptyLine(); // spacing between fields
  }

  // Bottom border
  console.log(b('\u2570') + b('\u2500'.repeat(innerWidth)) + b('\u256f'));
}

// --- Side-by-Side Comparison ---

export function sideBySide(
  leftTitle: string, leftContent: string[],
  rightTitle: string, rightContent: string[],
  c: Colors,
): string[] {
  const lw = 30;
  const rw = 38;
  const gap = '     ';
  const arrow = '  \u2192  ';

  const pad = (s: string, w: number) => {
    const vis = stripAnsi(s).length;
    return s + ' '.repeat(Math.max(0, w - vis));
  };

  // Pad content to equal height with top/bottom spacing
  const lPad = ['', ...leftContent, ''];
  const rPad = ['', ...rightContent, ''];
  while (lPad.length < rPad.length) lPad.splice(lPad.length - 1, 0, '');
  while (rPad.length < lPad.length) rPad.splice(rPad.length - 1, 0, '');
  const h = lPad.length;
  const mid = Math.floor(h / 2);

  const out: string[] = [];

  // Top borders
  const lTop = c.dim('\u256d\u2500 ' + leftTitle + ' ' + '\u2500'.repeat(Math.max(0, lw - leftTitle.length - 3)) + '\u256e');
  const rTop = c.boldCyan('\u256d\u2500 ' + rightTitle + ' ' + '\u2500'.repeat(Math.max(0, rw - rightTitle.length - 3)) + '\u256e');
  out.push('  ' + lTop + gap + rTop);

  // Content rows
  for (let i = 0; i < h; i++) {
    const g = i === mid ? arrow : gap;
    out.push(
      '  ' + c.dim('\u2502') + pad('  ' + (lPad[i] || ''), lw) + c.dim('\u2502') +
      g +
      c.boldCyan('\u2502') + pad('  ' + (rPad[i] || ''), rw) + c.boldCyan('\u2502')
    );
  }

  // Bottom borders
  out.push(
    '  ' + c.dim('\u2570' + '\u2500'.repeat(lw) + '\u256f') +
    gap +
    c.boldCyan('\u2570' + '\u2500'.repeat(rw) + '\u256f')
  );

  return out;
}

// --- CTA Box ---

export interface CtaTool {
  name: string;
  cmd: string;
}

/** Render a "Get Started" CTA box with per-tool commands. */
export function renderCtaBox(tools: CtaTool[], c: Colors): void {
  const maxCmd = Math.max(...tools.map(t => t.cmd.length));
  const bw = maxCmd + 4;
  const bf = (s: string) => c.dimCyan(s);
  console.log('       ' + bf('\u256d') + bf('\u2500 Get Started ') + bf('\u2500'.repeat(bw - 14)) + bf('\u256e'));
  console.log('       ' + bf('\u2502') + ' '.repeat(bw) + bf('\u2502'));
  for (let i = 0; i < tools.length; i++) {
    const { name, cmd } = tools[i];
    console.log('       ' + bf('\u2502') + '  ' + c.dim(name) + ' '.repeat(bw - name.length - 2) + bf('\u2502'));
    console.log('       ' + bf('\u2502') + '  ' + c.boldWhite(cmd) + ' '.repeat(bw - cmd.length - 2) + bf('\u2502'));
    if (i < tools.length - 1) {
      console.log('       ' + bf('\u2502') + ' '.repeat(bw) + bf('\u2502'));
    }
  }
  console.log('       ' + bf('\u2502') + ' '.repeat(bw) + bf('\u2502'));
  console.log('       ' + bf('\u2570') + bf('\u2500'.repeat(bw)) + bf('\u256f'));
}

// --- Roadmap Phase Display ---

/** Render roadmap phases with sprint tickets. */
export function renderRoadmapPhases(
  roadmap: { phases: { name: string; sprints: number[] }[]; sprints: { id: number; par: number; tickets: { key: string; title: string }[] }[] },
  c: Colors,
  overrides?: Record<string, string>,
): string[] {
  const lines: string[] = [];
  const cleanTitle = (key: string, raw: string): string => {
    if (overrides?.[key]) return overrides[key];
    return raw.replace(/^(TODO|FIXME|HACK):\s*/i, '');
  };

  for (const phase of roadmap.phases) {
    lines.push(`  ${c.boldYellow(phase.name)}`);
    for (const sprintId of phase.sprints) {
      const sprint = roadmap.sprints.find(s => s.id === sprintId);
      if (!sprint) continue;
      lines.push(`    ${c.dim(`Sprint ${sprint.id} (${sprint.tickets.length} ticket${sprint.tickets.length !== 1 ? 's' : ''}, par ${sprint.par})`)}`);
      const shown = sprint.tickets.slice(0, 5);
      const extra = sprint.tickets.length - shown.length;
      for (const t of shown) {
        lines.push(`      ${c.dim(t.key)}  ${cleanTitle(t.key, t.title)}`);
      }
      if (extra > 0) lines.push(`      ${c.dim(`... +${extra} more`)}`);
    }
    lines.push(''); // spacing between phases
  }
  return lines;
}
