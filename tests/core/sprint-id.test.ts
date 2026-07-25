import { describe, it, expect } from 'vitest';
import {
  compareSprintIdKeys,
  parseSprintId,
  sprintIdKey,
  sprintIdsEqual,
} from '../../src/core/sprint-id.js';

describe('sprintIdKey', () => {
  it('preserves an exact string suffix, including trailing zeros (GH #635)', () => {
    expect(sprintIdKey('458.10')).toBe('458.10');
    expect(sprintIdKey('458.1')).toBe('458.1');
    expect(sprintIdKey('458.0')).toBe('458.0');
    expect(sprintIdKey('143.5')).toBe('143.5');
  });

  it('strips a leading S and whitespace', () => {
    expect(sprintIdKey('S458.10')).toBe('458.10');
    expect(sprintIdKey('  s143.5 ')).toBe('143.5');
  });

  it('renders a number literally, without legacy 435 => 43.5 decoding', () => {
    expect(sprintIdKey(7)).toBe('7');
    expect(sprintIdKey(458.1)).toBe('458.1');
    expect(sprintIdKey(43.5)).toBe('43.5');
    expect(sprintIdKey(435)).toBe('435'); // roadmap-aware decode lives elsewhere
  });

  it('rejects non-ids', () => {
    expect(sprintIdKey('abc')).toBeNull();
    expect(sprintIdKey('458.')).toBeNull();
    expect(sprintIdKey('.5')).toBeNull();
    expect(sprintIdKey(0)).toBeNull();
    expect(sprintIdKey(-3)).toBeNull();
    expect(sprintIdKey(Number.NaN)).toBeNull();
  });
});

describe('parseSprintId', () => {
  it('splits base and insert while preserving digits', () => {
    expect(parseSprintId('458.10')).toEqual({ base: 458, insert: 10, insertDigits: '10', key: '458.10' });
    expect(parseSprintId('458.1')).toEqual({ base: 458, insert: 1, insertDigits: '1', key: '458.1' });
    expect(parseSprintId('459')).toEqual({ base: 459, insert: null, insertDigits: null, key: '459' });
  });
});

describe('sprintIdsEqual', () => {
  it('treats 458.10 and 458.1 as distinct (GH #635)', () => {
    expect(sprintIdsEqual('458.10', '458.1')).toBe(false);
    expect(sprintIdsEqual('458.0', '458')).toBe(false);
  });

  it('treats equivalent authored forms as equal', () => {
    expect(sprintIdsEqual('S458.10', '458.10')).toBe(true);
    expect(sprintIdsEqual(459, '459')).toBe(true);
    expect(sprintIdsEqual(458.1, '458.1')).toBe(true);
  });
});

describe('compareSprintIdKeys', () => {
  it('orders inserts by integer value so .9 precedes .10 (GH #635)', () => {
    const ids = ['458.11', '458.10', '458.2', '458.9', '458.1', '459', '458'];
    const sorted = [...ids].sort(compareSprintIdKeys);
    expect(sorted).toEqual(['458', '458.1', '458.2', '458.9', '458.10', '458.11', '459']);
  });

  it('sorts a whole sprint before its inserts', () => {
    expect(compareSprintIdKeys('458', '458.1')).toBeLessThan(0);
    expect(compareSprintIdKeys('458.1', '458')).toBeGreaterThan(0);
  });

  it('round-trips the issue cases as distinct, ordered ids', () => {
    // The exact set from GH #635.
    const sorted = ['459', '458.11', '458.10', '458.1', '458.9'].sort(compareSprintIdKeys);
    expect(sorted).toEqual(['458.1', '458.9', '458.10', '458.11', '459']);
  });
});
