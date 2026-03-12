import { appendFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

export type LogLevel = 'info' | 'warn' | 'error';

export interface Logger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
  child(prefix: string): Logger;
}

function timestamp(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export function isoTimestamp(): string {
  return new Date().toISOString();
}

export function createLogger(prefix: string = 'loop', logFile?: string): Logger {
  if (logFile) {
    const dir = dirname(logFile);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }

  function write(level: LogLevel, msg: string): void {
    const line = `[${timestamp()}] [${prefix}] ${msg}`;
    if (level === 'error' || level === 'warn') {
      console.error(line);
    } else {
      console.log(line);
    }
    if (logFile) {
      try {
        appendFileSync(logFile, line + '\n');
      } catch {
        // Best-effort file logging
      }
    }
  }

  return {
    info: (msg: string) => write('info', msg),
    warn: (msg: string) => write('warn', msg),
    error: (msg: string) => write('error', msg),
    child: (childPrefix: string) => createLogger(`${prefix}:${childPrefix}`, logFile),
  };
}
