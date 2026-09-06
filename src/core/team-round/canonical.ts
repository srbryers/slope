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
  return serialize(value, '', new Set(), 0);
}

/**
 * Depth bound.
 *
 * Canonicalization is recursive and runs inside the append transaction, so a
 * deeply nested payload becomes a `RangeError` that the contract's error
 * taxonomy has no entry for. Four kilobytes of `[[[[...]]]]` is enough to
 * exhaust the default stack. A bound turns that into a normal rejection well
 * below any legitimate envelope, which nests about six levels.
 */
const MAX_DEPTH = 64;

function serialize(value: unknown, path: string, seen: Set<object>, depth: number): string {
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

  if (depth > MAX_DEPTH) {
    throw new CanonicalizationError(`nesting exceeds ${MAX_DEPTH} levels`, path);
  }
  // A cycle would otherwise recurse until the stack dies. Tracked per branch,
  // so a value legitimately repeated in two sibling positions is still fine.
  if (seen.has(value as object)) {
    throw new CanonicalizationError('cyclic reference has no canonical form', path);
  }
  seen.add(value as object);
  try {
    return serializeContainer(value, path, seen, depth);
  } finally {
    seen.delete(value as object);
  }
}

function serializeContainer(value: object, path: string, seen: Set<object>, depth: number): string {
  if (Array.isArray(value)) {
    const parts: string[] = [];
    for (let i = 0; i < value.length; i++) {
      // A hole is not `undefined` and not `null`. `map` skips it and `join`
      // renders it as empty, so `[, 1]` would emit `[,1]`, which no JSON
      // parser accepts. An independent verifier could then neither parse nor
      // reproduce the bytes an event_hash was taken over. `new Array(n)` and
      // `delete arr[i]` both produce holes, and both are easy to write.
      if (!Object.prototype.hasOwnProperty.call(value, i)) {
        throw new CanonicalizationError('sparse array hole has no canonical form', `${path}[${i}]`);
      }
      parts.push(serialize(value[i], `${path}[${i}]`, seen, depth + 1));
    }
    return `[${parts.join(',')}]`;
  }

  // Only plain objects. Date, Map, Set, RegExp and Error all have no own
  // enumerable keys, so each would serialize as `{}` and collide with an empty
  // object and with each other. A Date in `occurred_at` would hash as `{}`
  // while the column stored the real timestamp, leaving the chain verifying
  // over bytes that do not describe the row.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) {
    const name = (value as object).constructor?.name ?? 'object';
    throw new CanonicalizationError(
      `${name} has no canonical form; convert it to a string or plain object first`,
      path,
    );
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
    parts.push(`${serializeString(key, path)}:${serialize(child, path ? `${path}.${key}` : key, seen, depth + 1)}`);
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
    return bounded(value.toString(10), field);
  }
  if (typeof value === 'number') {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new CanonicalizationError(`${field} must be a safe non-negative integer`, field);
    }
    return bounded(String(value), field);
  }
  if (!UNSIGNED_DECIMAL.test(value)) {
    throw new CanonicalizationError(`${field} must match 0|[1-9][0-9]* — got "${value}"`, field);
  }
  return bounded(value, field);
}

/** Largest unsigned 64-bit value. */
const MAX_UNSIGNED_64 = 18446744073709551615n;

/**
 * The contract describes these fields as 64-bit, so anything wider is a bug
 * rather than a very large sequence. Accepting it would store a value no
 * backend column can hold and no other implementation can read back.
 */
function bounded(decimal: string, field: string): string {
  if (BigInt(decimal) > MAX_UNSIGNED_64) {
    throw new CanonicalizationError(`${field} exceeds the unsigned 64-bit range`, field);
  }
  return decimal;
}

/**
 * One length-prefixed segment of digest input.
 *
 * The segment is validated, not just measured. `Buffer.from(s, 'utf8')`
 * replaces a lone surrogate with U+FFFD, so `"p\uD800"`, `"p\uDC00"` and
 * `"p�"` all produced the same bytes and therefore the same digest. These
 * segments carry the domain separation itself, so a collision here is a
 * collision across projects, which is the one property the framing exists to
 * guarantee.
 */
function framed(segment: string, field: string): Buffer {
  if (typeof segment !== 'string') {
    throw new CanonicalizationError(`${field} must be a string`, field);
  }
  // Reuse the string canonicalizer's surrogate checking rather than repeat it.
  serializeString(segment, field);
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
  /**
   * The value to canonicalize. Always canonicalized here.
   *
   * Passing already-canonical JSON text re-encodes it as a quoted string and
   * silently changes the digest, so callers hand over the value and take the
   * bytes back from the result.
   */
  value: unknown;
}

export interface DigestResult {
  /** Hex SHA-256 over the domain-separated framed input. */
  digest: string;
  /** The exact canonical bytes the digest covers. */
  canonical: string;
}

/**
 * SHA-256 over domain-separated, length-prefixed canonical bytes.
 *
 * Every segment carries its own length. Concatenating unframed strings is
 * forbidden by the contract for the usual reason: `("ab", "c")` and
 * `("a", "bc")` would otherwise produce identical input, so a caller could
 * move a character across a boundary and keep the digest.
 */
export function teamRoundDigest(input: DigestInput): DigestResult {
  // Canonicalized exactly once, and the bytes are returned with the digest.
  // A caller that needed both would otherwise call canonicalJson again, and a
  // getter or Proxy could return something different the second time, so the
  // stored bytes and the hashed bytes would disagree.
  const canonical = canonicalJson(input.value);
  const bytes = Buffer.concat([
    Buffer.from(DOMAIN, 'ascii'),
    Buffer.from([0x00]),
    framed(input.purpose, 'purpose'),
    framed(input.projectId, 'projectId'),
    framed(input.schemaRevision, 'schemaRevision'),
    framed(canonical, 'canonical'),
  ]);
  return { digest: createHash('sha256').update(bytes).digest('hex'), canonical };
}
