import { createHash } from 'node:crypto';

/**
 * Canonical serialization and digests for the Team Round coordination ledger.
 *
 * Everything in Phase 64 hashes through here: the event envelope, the chain
 * links, the published scorecard's `content_hash`, and the projection digests.
 * Two implementations that disagree by one byte produce a ledger that cannot
 * verify itself, so this module implements the contract exactly rather than
 * approximately, and rejects input it cannot represent faithfully.
 *
 * The contract is `docs/architecture/team-round-coordination.md`, section
 * "Canonical Cryptography": RFC 8785 JSON Canonicalization Scheme over
 * I-JSON-compatible input, then SHA-256 over length-prefixed domain-separated
 * bytes.
 */

/** Domain tag for every version 1 digest. */
const DOMAIN = 'SLOPE-TEAM-ROUND-V1';

/** Integers that must travel as canonical unsigned decimal strings. */
const UNSIGNED_DECIMAL = /^(0|[1-9][0-9]*)$/;

export class CanonicalizationError extends Error {
  constructor(message: string, readonly path: string) {
    super(`${message} (at ${path || '<root>'})`);
    this.name = 'CanonicalizationError';
  }
}

/** JSON that survives canonicalization. */
export type CanonicalValue =
  | string
  | number
  | boolean
  | null
  | CanonicalValue[]
  | { [key: string]: CanonicalValue };

/**
 * RFC 8785 canonical JSON.
 *
 * The spec's additional restrictions are enforced rather than assumed, because
 * each one is a way two implementations could agree on JSON and disagree on
 * bytes:
 *
 * - `undefined` and absent properties are not the same as `null`, and JSON has
 *   no `undefined`. Silently dropping a key would let a caller change the hash
 *   by leaving a field off.
 * - NaN, infinity, and negative zero have no I-JSON representation.
 * - Non-integer numbers are refused outright. The contract requires decimal
 *   strings with a fixed scale for every non-integer quantity, so a float
 *   reaching here is a caller bug, and `0.1 + 0.2` must never become a hash.
 * - Integers beyond the safe range lose precision in IEEE 754 before this
 *   function ever sees them. Sequences, versions, epochs and fencing tokens
 *   are 64-bit, which is why the contract carries them as strings.
 * - Lone surrogates cannot round-trip through UTF-8.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, '');
}

function serialize(value: unknown, path: string): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false';
    case 'string':
      return serializeString(value, path);
    case 'number':
      return serializeNumber(value, path);
    case 'object':
      break;
    case 'undefined':
      throw new CanonicalizationError('undefined has no canonical form; omit the key or use null', path);
    default:
      throw new CanonicalizationError(`${typeof value} is not serializable`, path);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, i) => serialize(item, `${path}[${i}]`)).join(',')}]`;
  }

  const record = value as Record<string, unknown>;
  // RFC 8785 orders by UTF-16 code unit, which is what JavaScript's default
  // string comparison already does. Spelling it out because a locale-aware
  // sort here would be a silent, hard-to-find divergence.
  const keys = Object.keys(record).sort();
  const parts: string[] = [];
  for (const key of keys) {
    const child = record[key];
    // An explicitly-present `undefined` is a caller mistake, not an omission.
    if (child === undefined) {
      throw new CanonicalizationError(`property "${key}" is undefined; omit it or use null`, path);
    }
    parts.push(`${serializeString(key, path)}:${serialize(child, path ? `${path}.${key}` : key)}`);
  }
  return `{${parts.join(',')}}`;
}

function serializeNumber(value: number, path: string): string {
  if (Number.isNaN(value)) throw new CanonicalizationError('NaN is not representable', path);
  if (!Number.isFinite(value)) throw new CanonicalizationError('Infinity is not representable', path);
  if (Object.is(value, -0)) {
    throw new CanonicalizationError('negative zero is not representable; use 0', path);
  }
  if (!Number.isInteger(value)) {
    throw new CanonicalizationError(
      'non-integer numbers are not canonical; use a fixed-scale decimal string',
      path,
    );
  }
  if (!Number.isSafeInteger(value)) {
    throw new CanonicalizationError(
      'integer exceeds the safe range and has already lost precision; use a decimal string',
      path,
    );
  }
  return String(value);
}

/** JSON string escaping per RFC 8785: the shortest form, lowercase hex. */
function serializeString(value: string, path: string): string {
  let out = '"';
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);

    // Surrogate pairs must be complete. A lone half cannot encode to UTF-8,
    // so different implementations would substitute different replacements.
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        throw new CanonicalizationError('lone high surrogate is not valid Unicode', path);
      }
      out += value[i] + value[i + 1];
      i++;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      throw new CanonicalizationError('lone low surrogate is not valid Unicode', path);
    }

    switch (code) {
      case 0x08: out += '\\b'; break;
      case 0x09: out += '\\t'; break;
      case 0x0a: out += '\\n'; break;
      case 0x0c: out += '\\f'; break;
      case 0x0d: out += '\\r'; break;
      case 0x22: out += '\\"'; break;
      case 0x5c: out += '\\\\'; break;
      default:
        out += code < 0x20
          ? `\\u${code.toString(16).padStart(4, '0')}`
          : value[i];
    }
  }
  return out + '"';
}

/**
 * A 64-bit-safe integer as the contract carries it.
 *
 * Event sequences, aggregate versions, round epochs and fencing tokens are all
 * potentially 64-bit, so they travel as unsigned decimal strings rather than
 * JSON numbers. Passing one through here documents the intent and rejects the
 * spellings that would hash differently: `007`, `+1`, `1e3`, `-0`.
 */
export function canonicalUnsigned(value: bigint | number | string, field = 'value'): string {
  if (typeof value === 'bigint') {
    if (value < 0n) throw new CanonicalizationError(`${field} must not be negative`, field);
    return value.toString(10);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new CanonicalizationError(`${field} must be a safe non-negative integer`, field);
    }
    return String(value);
  }
  if (!UNSIGNED_DECIMAL.test(value)) {
    throw new CanonicalizationError(`${field} must match 0|[1-9][0-9]* — got "${value}"`, field);
  }
  return value;
}

/** One length-prefixed segment of digest input. */
function framed(segment: string): Buffer {
  const body = Buffer.from(segment, 'utf8');
  if (body.length >= 0x1_0000_0000) {
    throw new CanonicalizationError('digest segment must be shorter than 2^32 bytes', 'segment');
  }
  const length = Buffer.alloc(4);
  length.writeUInt32BE(body.length, 0);
  return Buffer.concat([length, body]);
}

export interface DigestInput {
  /** What this digest is for, so two digests over identical bytes differ. */
  purpose: string;
  /** Project namespace. Digests never collide across projects. */
  projectId: string;
  /** Registry revision that selected the algorithms and schema. */
  schemaRevision: string;
  /** The value to canonicalize, or pre-canonicalized bytes. */
  value: unknown;
}

/**
 * SHA-256 over domain-separated, length-prefixed canonical bytes.
 *
 * Every segment carries its own length. Concatenating unframed strings is
 * forbidden by the contract for the usual reason: `("ab", "c")` and
 * `("a", "bc")` would otherwise produce identical input, so a caller could
 * move a character across a boundary and keep the digest.
 */
export function teamRoundDigest(input: DigestInput): string {
  const jcs = canonicalJson(input.value);
  const bytes = Buffer.concat([
    Buffer.from(DOMAIN, 'ascii'),
    Buffer.from([0x00]),
    framed(input.purpose),
    framed(input.projectId),
    framed(input.schemaRevision),
    framed(jcs),
  ]);
  return createHash('sha256').update(bytes).digest('hex');
}
