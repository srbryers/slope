import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import {
  CanonicalizationError,
  canonicalJson,
  canonicalUnsigned,
  teamRoundDigest,
} from '../../src/core/team-round/canonical.js';

/**
 * The Team Round ledger verifies itself against these bytes, so the tests are
 * written against the contract in docs/architecture/team-round-coordination.md
 * rather than against the implementation. Where RFC 8785 publishes a vector,
 * the vector is used.
 */

describe('canonicalJson', () => {
  it('orders object keys by UTF-16 code unit, not by insertion or locale', () => {
    // The RFC 8785 property that matters most: two callers building the same
    // object in different orders must produce identical bytes.
    const a = canonicalJson({ b: 1, a: 2, C: 3 });
    const b = canonicalJson({ C: 3, a: 2, b: 1 });
    expect(a).toBe(b);
    // Uppercase sorts before lowercase in UTF-16. A locale-aware sort would
    // put "a" first and diverge silently.
    expect(a).toBe('{"C":3,"a":2,"b":1}');
  });

  it('sorts nested keys too', () => {
    expect(canonicalJson({ z: { d: 1, a: 2 }, a: [{ y: 1, x: 2 }] }))
      .toBe('{"a":[{"x":2,"y":1}],"z":{"a":2,"d":1}}');
  });

  it('uses the seven short escapes and lowercase u00xx elsewhere', () => {
    // RFC 8785 escaping: short forms where they exist, a lowercase
    // four-digit escape otherwise, and every character at or above U+0020
    // literal. Built with fromCharCode so this source contains no control
    // bytes and no escape sequences to misread.
    // JSON.stringify is a fair independent oracle for STRING escaping only:
    // it agrees with JCS there, and disagrees on key order and number
    // formatting, which the other tests cover directly.
    const shortEscapes = String.fromCharCode(8, 9, 10, 12, 13) + '"' + String.fromCharCode(92);
    expect(canonicalJson(shortEscapes)).toBe(JSON.stringify(shortEscapes));

    const controls = String.fromCharCode(0, 31);
    expect(canonicalJson(controls)).toBe(JSON.stringify(controls));

    // Deliberately NOT escaped: forward slash, DEL, and non-ASCII.
    // Escaping any of these is legal JSON but a different byte string.
    const literals = '/' + String.fromCharCode(127) + String.fromCharCode(233);
    expect(canonicalJson(literals)).toBe('"' + literals + '"');
  });

  it('keeps a valid surrogate pair intact', () => {
    expect(canonicalJson('😀')).toBe('"😀"');
  });

  it('adds no whitespace anywhere', () => {
    expect(canonicalJson({ a: [1, 2], b: {} })).toBe('{"a":[1,2],"b":{}}');
  });

  it('preserves array order', () => {
    // Arrays are sequences; only object keys are reordered.
    expect(canonicalJson([3, 1, 2])).toBe('[3,1,2]');
  });
});

describe('canonicalJson rejects what it cannot represent faithfully', () => {
  const rejects = (value: unknown, fragment: string) => {
    expect(() => canonicalJson(value)).toThrow(CanonicalizationError);
    expect(() => canonicalJson(value)).toThrow(fragment);
  };

  it('rejects NaN, infinity, and negative zero', () => {
    rejects(NaN, 'NaN');
    rejects(Infinity, 'Infinity');
    rejects(-Infinity, 'Infinity');
    // -0 and 0 are the same number to `===` but serialize differently in some
    // implementations, which is exactly the kind of split this prevents.
    rejects(-0, 'negative zero');
  });

  it('rejects non-integer numbers rather than hashing a float', () => {
    // 0.1 + 0.2 is the reason. A quantity with a fractional part must arrive
    // as a fixed-scale decimal string.
    rejects(0.1 + 0.2, 'non-integer');
    rejects({ score: 4.5 }, 'non-integer');
  });

  it('rejects integers that have already lost precision', () => {
    rejects(Number.MAX_SAFE_INTEGER + 2, 'safe range');
  });

  it('rejects undefined rather than silently dropping the key', () => {
    // Dropping it would let a caller change the hash by leaving a field off,
    // which is the difference between "absent" and "null".
    rejects({ a: undefined }, 'undefined');
    rejects(undefined, 'undefined');
  });

  it('rejects lone surrogates', () => {
    rejects('\ud800', 'high surrogate');
    rejects('\udc00', 'low surrogate');
    rejects('\ud800x', 'high surrogate');
  });

  it('names the path so a rejection in a deep envelope is findable', () => {
    expect(() => canonicalJson({ scope: { shots: [{ par: 4.5 }] } }))
      .toThrow('scope.shots[0].par');
  });
});

describe('canonicalUnsigned', () => {
  it('accepts the canonical spellings', () => {
    expect(canonicalUnsigned(0)).toBe('0');
    expect(canonicalUnsigned('0')).toBe('0');
    expect(canonicalUnsigned(42)).toBe('42');
    expect(canonicalUnsigned('42')).toBe('42');
  });

  it('carries a 64-bit value a JSON number could not', () => {
    // The reason sequences and fencing tokens are strings in the contract.
    expect(canonicalUnsigned(18446744073709551615n)).toBe('18446744073709551615');
  });

  it('rejects spellings that would hash differently', () => {
    for (const bad of ['007', '+1', '1e3', '-0', '', ' 1', '1 ', '0x10']) {
      expect(() => canonicalUnsigned(bad)).toThrow(CanonicalizationError);
    }
    expect(() => canonicalUnsigned(-1)).toThrow('non-negative');
    expect(() => canonicalUnsigned(-1n)).toThrow('negative');
    expect(() => canonicalUnsigned(1.5)).toThrow('safe non-negative integer');
  });
});

describe('teamRoundDigest', () => {
  const base = {
    purpose: 'event',
    projectId: 'proj-1',
    schemaRevision: 'v1',
    value: { a: 1 },
  };

  it('is stable across equivalent inputs', () => {
    expect(teamRoundDigest(base)).toBe(teamRoundDigest({ ...base, value: { a: 1 } }));
  });

  it('separates domains, so identical bytes under different purposes differ', () => {
    expect(teamRoundDigest(base)).not.toBe(teamRoundDigest({ ...base, purpose: 'chain' }));
  });

  it('separates projects and schema revisions', () => {
    expect(teamRoundDigest(base)).not.toBe(teamRoundDigest({ ...base, projectId: 'proj-2' }));
    expect(teamRoundDigest(base)).not.toBe(teamRoundDigest({ ...base, schemaRevision: 'v2' }));
  });

  it('cannot be fooled by moving a character across a segment boundary', () => {
    // The reason every segment is length-prefixed. Unframed concatenation
    // would make these two identical.
    const left = teamRoundDigest({ ...base, purpose: 'ab', projectId: 'c' });
    const right = teamRoundDigest({ ...base, purpose: 'a', projectId: 'bc' });
    expect(left).not.toBe(right);
  });

  it('matches an independently computed digest for the documented framing', () => {
    // Recomputed here from the contract's own description rather than from the
    // implementation, so a change to the framing fails this test.
    const jcs = '{"a":1}';
    const frame = (s: string) => {
      const body = Buffer.from(s, 'utf8');
      const len = Buffer.alloc(4);
      len.writeUInt32BE(body.length, 0);
      return Buffer.concat([len, body]);
    };
    const expected = createHash('sha256').update(Buffer.concat([
      Buffer.from('SLOPE-TEAM-ROUND-V1', 'ascii'),
      Buffer.from([0x00]),
      frame('event'),
      frame('proj-1'),
      frame('v1'),
      frame(jcs),
    ])).digest('hex');

    expect(teamRoundDigest(base)).toBe(expected);
  });

  it('refuses to digest a value it cannot canonicalize', () => {
    expect(() => teamRoundDigest({ ...base, value: { score: 4.5 } }))
      .toThrow(CanonicalizationError);
  });
});
