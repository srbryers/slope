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
    expect(teamRoundDigest(base).digest).toBe(teamRoundDigest({ ...base, value: { a: 1 } }).digest);
  });

  it('separates domains, so identical bytes under different purposes differ', () => {
    expect(teamRoundDigest(base).digest).not.toBe(teamRoundDigest({ ...base, purpose: 'chain' }).digest);
  });

  it('separates projects and schema revisions', () => {
    expect(teamRoundDigest(base).digest).not.toBe(teamRoundDigest({ ...base, projectId: 'proj-2' }).digest);
    expect(teamRoundDigest(base).digest).not.toBe(teamRoundDigest({ ...base, schemaRevision: 'v2' }).digest);
  });

  it('cannot be fooled by moving a character across a segment boundary', () => {
    // The reason every segment is length-prefixed. Unframed concatenation
    // would make these two identical.
    const left = teamRoundDigest({ ...base, purpose: 'ab', projectId: 'c' }).digest;
    const right = teamRoundDigest({ ...base, purpose: 'a', projectId: 'bc' }).digest;
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

    expect(teamRoundDigest(base).digest).toBe(expected);
  });

  it('refuses to digest a value it cannot canonicalize', () => {
    expect(() => teamRoundDigest({ ...base, value: { score: 4.5 } }))
      .toThrow(CanonicalizationError);
  });

  it('returns the exact bytes it hashed, so caller storage cannot drift', () => {
    // A caller needing both would otherwise canonicalize twice, and a getter
    // or Proxy can answer differently the second time. The stored bytes and
    // the hashed bytes would then disagree with nothing to detect it.
    const result = teamRoundDigest(base);
    expect(result.canonical).toBe('{"a":1}');
  });

  it('rejects a segment whose bytes are not recoverable', () => {
    // Buffer.from replaces a lone surrogate with U+FFFD, so these three
    // project ids all produced identical digest input. These segments carry
    // the domain separation, so a collision here crosses projects.
    for (const projectId of ['p\ud800', 'p\udc00']) {
      expect(() => teamRoundDigest({ ...base, projectId })).toThrow(CanonicalizationError);
    }
    // The replacement character itself is a legitimate string and still hashes.
    expect(teamRoundDigest({ ...base, projectId: 'p�' }).digest)
      .not.toBe(teamRoundDigest(base).digest);
  });
});

describe('canonicalJson rejects shapes that would hash as something else', () => {
  it('rejects a sparse array rather than emitting invalid JSON', () => {
    // `map` skips holes and `join` renders them empty, so this would have been
    // `[,1]`, which no JSON parser accepts and no verifier can reproduce.
    const sparse: unknown[] = [];
    sparse[1] = 1;
    expect(() => canonicalJson(sparse)).toThrow('sparse array hole');
    expect(() => canonicalJson(new Array(3))).toThrow('sparse array hole');
  });

  it('rejects Date, Map, Set and RegExp instead of collapsing them to {}', () => {
    // Each has no own enumerable keys, so all of these would have hashed
    // identically to an empty object and to each other. A Date in occurred_at
    // would hash as {} while the column stored the real timestamp.
    for (const value of [new Date(0), new Map([['k', 'v']]), new Set([1]), /x/]) {
      expect(() => canonicalJson({ evidence: value })).toThrow(CanonicalizationError);
    }
    // A null-prototype object is still a plain record and is accepted.
    expect(canonicalJson(Object.assign(Object.create(null), { a: 1 }))).toBe('{"a":1}');
  });

  it('rejects a cycle rather than exhausting the stack', () => {
    const cyclic: Record<string, unknown> = { a: 1 };
    cyclic.self = cyclic;
    expect(() => canonicalJson(cyclic)).toThrow('cyclic reference');
  });

  it('allows the same object in two sibling positions', () => {
    // Repetition is not a cycle. Tracking per branch keeps this legal.
    const shared = { id: 'x' };
    expect(canonicalJson({ a: shared, b: shared })).toBe('{"a":{"id":"x"},"b":{"id":"x"}}');
  });

  it('bounds nesting rather than throwing a RangeError the taxonomy lacks', () => {
    // Canonicalization runs inside the append transaction, where a RangeError
    // maps to no defined error class. A few kilobytes of brackets is enough.
    let deep: unknown = 0;
    for (let i = 0; i < 200; i++) deep = [deep];
    expect(() => canonicalJson(deep)).toThrow('nesting exceeds');
  });
});
