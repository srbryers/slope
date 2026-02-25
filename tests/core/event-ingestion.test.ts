import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { validateEventPayload, ingestEvents, createEventHandler } from '../../src/core/event-ingestion.js';
import { SqliteSlopeStore } from '../../src/store/index.js';
import type { SlopeStore } from '../../src/core/store.js';

let store: SlopeStore;
let tmpDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'slope-ingest-'));
  store = new SqliteSlopeStore(join(tmpDir, 'test.db'));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('validateEventPayload', () => {
  it('accepts a valid event', () => {
    const result = validateEventPayload({
      type: 'failure',
      data: { error: 'build failed' },
      session_id: 'sess-1',
      sprint_number: 5,
      ticket_key: 'T-1',
    });
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('accepts minimal valid event (type only)', () => {
    const result = validateEventPayload({ type: 'decision' });
    expect(result.valid).toBe(true);
  });

  it('rejects non-object', () => {
    expect(validateEventPayload('string').valid).toBe(false);
    expect(validateEventPayload(null).valid).toBe(false);
    expect(validateEventPayload(42).valid).toBe(false);
  });

  it('rejects missing type', () => {
    const result = validateEventPayload({ data: {} });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('"type"'))).toBe(true);
  });

  it('rejects invalid type', () => {
    const result = validateEventPayload({ type: 'invalid_type' });
    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.includes('Invalid event type'))).toBe(true);
  });

  it('accepts all valid event types', () => {
    const types = ['failure', 'dead_end', 'scope_change', 'compaction', 'hazard', 'decision', 'standup'];
    for (const type of types) {
      expect(validateEventPayload({ type }).valid).toBe(true);
    }
  });

  it('rejects non-object data', () => {
    const result = validateEventPayload({ type: 'failure', data: 'string' });
    expect(result.valid).toBe(false);
  });

  it('rejects non-string session_id', () => {
    const result = validateEventPayload({ type: 'failure', session_id: 123 });
    expect(result.valid).toBe(false);
  });

  it('rejects non-number sprint_number', () => {
    const result = validateEventPayload({ type: 'failure', sprint_number: 'five' });
    expect(result.valid).toBe(false);
  });

  it('rejects non-string ticket_key', () => {
    const result = validateEventPayload({ type: 'failure', ticket_key: 123 });
    expect(result.valid).toBe(false);
  });

  it('collects multiple errors', () => {
    const result = validateEventPayload({ data: 'bad', session_id: 123 });
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

describe('ingestEvents', () => {
  it('inserts valid events', async () => {
    const result = await ingestEvents(store, [
      { type: 'failure', data: { error: 'build' }, sprint_number: 1 },
      { type: 'decision', data: { choice: 'refactor' }, sprint_number: 1 },
    ]);

    expect(result.inserted).toHaveLength(2);
    expect(result.duplicates).toBe(0);
    expect(result.errors).toEqual([]);

    // Verify in store
    const events = await store.getEventsBySprint(1);
    expect(events).toHaveLength(2);
  });

  it('reports validation errors with index', async () => {
    const result = await ingestEvents(store, [
      { type: 'failure', data: {} },
      { type: 'invalid' },             // index 1 — bad type
      { type: 'decision', data: {} },
      'not-an-object',                  // index 3 — not an object
    ]);

    expect(result.inserted).toHaveLength(2);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0].index).toBe(1);
    expect(result.errors[1].index).toBe(3);
  });

  it('rejects batches exceeding max size', async () => {
    const events = Array.from({ length: 1001 }, () => ({ type: 'failure', data: {} }));
    await expect(ingestEvents(store, events)).rejects.toThrow(/exceeds maximum/);
  });

  it('handles empty batch', async () => {
    const result = await ingestEvents(store, []);
    expect(result.inserted).toEqual([]);
    expect(result.duplicates).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it('handles events with default empty data', async () => {
    const result = await ingestEvents(store, [
      { type: 'compaction' },
    ]);

    expect(result.inserted).toHaveLength(1);
    expect(result.inserted[0].data).toEqual({});
  });
});

describe('createEventHandler', () => {
  it('handles single event', async () => {
    const handler = createEventHandler(store);
    const result = await handler({
      body: { type: 'failure', data: { error: 'test' } },
    });

    expect(result.status).toBe(200);
    expect((result.body as Record<string, unknown>).inserted).toBe(1);
  });

  it('handles array of events', async () => {
    const handler = createEventHandler(store);
    const result = await handler({
      body: [
        { type: 'failure', data: {} },
        { type: 'decision', data: {} },
      ],
    });

    expect(result.status).toBe(200);
    expect((result.body as Record<string, unknown>).inserted).toBe(2);
  });

  it('returns 207 for partial success', async () => {
    const handler = createEventHandler(store);
    const result = await handler({
      body: [
        { type: 'failure', data: {} },
        { type: 'invalid' },
      ],
    });

    expect(result.status).toBe(207);
    expect((result.body as Record<string, unknown>).inserted).toBe(1);
    expect(((result.body as Record<string, unknown>).errors as unknown[]).length).toBe(1);
  });

  it('returns 413 for oversized batch', async () => {
    const handler = createEventHandler(store);
    const events = Array.from({ length: 1001 }, () => ({ type: 'failure' }));
    const result = await handler({ body: events });

    expect(result.status).toBe(413);
  });
});
