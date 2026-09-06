import { describe, it, expect } from 'vitest';
import {
  BOOTSTRAP_ADMIN_CAPABILITIES,
  BootstrapError,
  assertProjectId,
  bootstrapProject,
  formatBootstrapManifest,
  isProjectId,
  mintProjectId,
} from '../../src/core/team-round/identity.js';
import type { BootstrapInput, PrincipalSource } from '../../src/core/team-round/identity.js';

/**
 * The refusals are the feature. A bootstrap that succeeds from an ambient
 * identity hands administrator authority to whoever ran the command, and the
 * project identity it mints namespaces every digest for the life of the
 * ledger, so there is no correcting it afterwards.
 */

function input(overrides: Partial<BootstrapInput> = {}): BootstrapInput {
  return {
    principal: {
      principal_id: 'principal-alice',
      authentication_context_id: 'auth-ctx-1',
      source: 'operator_confirmed',
    },
    now: '2026-09-06T00:00:00.000Z',
    mint: () => 'prj_00112233445566778899aabbccddeeff',
    ...overrides,
  };
}

describe('project identity', () => {
  it('mints an opaque value that reveals nothing about the checkout', () => {
    const id = mintProjectId();
    expect(isProjectId(id)).toBe(true);
    // 128 bits, so two mints never collide in practice and nobody is tempted
    // to derive one from a path or a name.
    expect(id).toMatch(/^prj_[0-9a-f]{32}$/);
    expect(mintProjectId()).not.toBe(id);
  });

  it('rejects the shapes someone would reach for instead of minting', () => {
    // Each of these is a real thing a caller might pass: a path, a slug, a
    // remote, a branch. The contract forbids all of them.
    for (const bad of [
      'C:/Users/dev/project',
      'my-project',
      'git@github.com:owner/repo.git',
      'main',
      'default',
      'prj_short',
      'prj_00112233445566778899AABBCCDDEEFF',
      '',
      null,
      42,
    ]) {
      expect(isProjectId(bad)).toBe(false);
      expect(() => assertProjectId(bad)).toThrow(BootstrapError);
    }
  });
});

describe('bootstrap ceremony', () => {
  it('produces genesis records and a manifest an operator can check', () => {
    const { records, manifest } = bootstrapProject(input());

    expect(records.project.project_id).toBe('prj_00112233445566778899aabbccddeeff');
    expect(records.identity_policy.administrator_principal_id).toBe('principal-alice');
    expect(records.integrity_checkpoint.event_sequence).toBe('0');
    expect(manifest.manifest_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.checkpoint_hash).toBe(records.integrity_checkpoint.project_hash);
  });

  it('defaults visibility to restricted', () => {
    // A weaker default would over-disclose every event written before anyone
    // set a policy, and events are immutable.
    expect(bootstrapProject(input()).records.visibility_policy.default_classification)
      .toBe('restricted');
  });

  it('issues an enumerated grant rather than a wildcard', () => {
    const { records } = bootstrapProject(input());
    const capabilities = records.capability_policy.grants.map(g => g.capability);

    expect(capabilities).toEqual([...BOOTSTRAP_ADMIN_CAPABILITIES]);
    // The point of enumerating: a wildcard would silently acquire every
    // capability a later sprint adds, with nobody deciding that.
    expect(capabilities).not.toContain('*');
    expect(capabilities).not.toContain('round.finalize');
    for (const grant of records.capability_policy.grants) {
      expect(grant.principal_id).toBe('principal-alice');
      expect(grant.scope).toBe(records.project.project_id);
    }
  });

  it('refuses every principal source except an operator-confirmed one', () => {
    // These are exactly the sources the contract names as forbidden, and each
    // is something the caller could supply believing it is good enough.
    const forbidden: PrincipalSource[] = [
      'environment',
      'git_author',
      'repository_owner',
      'remote_request',
    ];
    for (const source of forbidden) {
      const call = () => bootstrapProject(input({
        principal: {
          principal_id: 'principal-alice',
          authentication_context_id: 'auth-ctx-1',
          source,
        },
      }));
      expect(call).toThrow(BootstrapError);
      expect(call).toThrow(/trusted channel/);
    }
  });

  it('refuses an empty principal or authentication context', () => {
    for (const principal of [
      { principal_id: '  ', authentication_context_id: 'auth-ctx-1' },
      { principal_id: 'principal-alice', authentication_context_id: '' },
    ]) {
      expect(() => bootstrapProject(input({
        principal: { ...principal, source: 'operator_confirmed' },
      }))).toThrow(BootstrapError);
    }
  });

  it('refuses to bootstrap a project that already exists', () => {
    // Re-bootstrapping would mint a second identity over existing history and
    // invalidate every digest namespaced by the first.
    const call = () => bootstrapProject(input({
      existingProjectId: 'prj_ffffffffffffffffffffffffffffffff',
    }));
    expect(call).toThrow(BootstrapError);
    expect(call).toThrow(/one-time ceremony/);
  });

  it('quarantines rather than guessing when legacy rows span namespaces', () => {
    const call = () => bootstrapProject(input({
      legacyNamespaces: ['default', 'other-project'],
    }));
    expect(call).toThrow(/explicit operator-supplied mapping/);

    // One namespace is unambiguous and proceeds.
    expect(() => bootstrapProject(input({ legacyNamespaces: ['default'] }))).not.toThrow();
  });

  it('binds the manifest hash to every field an operator reads', () => {
    // If a field could change without the hash changing, confirming the hash
    // would not confirm what was approved.
    const baseline = bootstrapProject(input()).manifest.manifest_hash;

    const otherPrincipal = bootstrapProject(input({
      principal: {
        principal_id: 'principal-mallory',
        authentication_context_id: 'auth-ctx-1',
        source: 'operator_confirmed',
      },
    })).manifest.manifest_hash;
    expect(otherPrincipal).not.toBe(baseline);

    const otherContext = bootstrapProject(input({
      principal: {
        principal_id: 'principal-alice',
        authentication_context_id: 'auth-ctx-2',
        source: 'operator_confirmed',
      },
    })).manifest.manifest_hash;
    expect(otherContext).not.toBe(baseline);

    const otherProject = bootstrapProject(input({
      mint: () => 'prj_ffffffffffffffffffffffffffffffff',
    })).manifest.manifest_hash;
    expect(otherProject).not.toBe(baseline);
  });

  it('is deterministic for one set of inputs', () => {
    // The store writes these in a transaction and the operator approves the
    // hash beforehand, so the two must describe the same thing.
    expect(bootstrapProject(input()).manifest.manifest_hash)
      .toBe(bootstrapProject(input()).manifest.manifest_hash);
  });

  it('reads no environment', () => {
    // The whole refusal is meaningless if an ambient value leaks in anyway.
    const before = { ...process.env };
    process.env.USER = 'attacker';
    process.env.USERNAME = 'attacker';
    try {
      const { records, manifest } = bootstrapProject(input());
      expect(records.identity_policy.administrator_principal_id).toBe('principal-alice');
      expect(JSON.stringify(manifest)).not.toContain('attacker');
    } finally {
      process.env = before;
    }
  });
});

describe('operator display', () => {
  it('shows the principal and both hashes in plain text', () => {
    const out = formatBootstrapManifest(bootstrapProject(input()).manifest);

    expect(out).toContain('prj_00112233445566778899aabbccddeeff');
    expect(out).toContain('principal-alice');
    expect(out).toContain('auth-ctx-1');
    expect(out).toContain('Manifest hash:');
    // Says plainly that this cannot be undone, because that is the part an
    // operator most needs to know before approving.
    expect(out).toContain('one-time ceremony');
  });
});
