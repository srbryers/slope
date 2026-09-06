import { randomBytes } from 'node:crypto';
import { canonicalJson, teamRoundDigest } from './canonical.js';

/**
 * Project identity and the trust bootstrap ceremony (S268-1).
 *
 * A new project has no implicit administrator. The contract is explicit that
 * bootstrap must not derive administrator identity from `$USER`, role text,
 * repository ownership, Git author, branch, worktree path, or the first remote
 * request. Every one of those is either forgeable by whoever runs the command
 * or changes when a checkout moves, and this identity namespaces every digest
 * in the ledger for the life of the project.
 *
 * So nothing here reads the environment. The caller supplies a principal that
 * came from a trusted channel, and this module refuses to invent one.
 *
 * Contract: `team-round-coordination.md`, "Trust Bootstrap" and "Stable Project
 * Binding". Amended by `team-round-deployment-profiles.md`.
 */

/** Schema revision for every record this module produces. */
export const BOOTSTRAP_SCHEMA_REVISION = 'team-round-bootstrap-v1';

export class BootstrapError extends Error {
  constructor(message: string, readonly code: BootstrapErrorCode) {
    super(message);
    this.name = 'BootstrapError';
  }
}

export type BootstrapErrorCode =
  | 'PROJECT_EXISTS'
  | 'PRINCIPAL_UNTRUSTED'
  | 'INVALID_PROJECT_ID'
  | 'AMBIGUOUS_LEGACY_NAMESPACE';

/**
 * A durable project namespace.
 *
 * 128 bits of randomness, hex encoded, prefixed so a value found in a log or a
 * database column is recognisable. Opaque on purpose: a reader must not be
 * able to infer a path, a name, or an ordering from it, because any of those
 * would invite deriving it rather than storing it.
 */
export type ProjectId = string;

const PROJECT_ID_PATTERN = /^prj_[0-9a-f]{32}$/;

/** Mint a new project identity. Called once, by the bootstrap ceremony. */
export function mintProjectId(): ProjectId {
  return `prj_${randomBytes(16).toString('hex')}`;
}

/** True when a value is a well-formed project identity. */
export function isProjectId(value: unknown): value is ProjectId {
  return typeof value === 'string' && PROJECT_ID_PATTERN.test(value);
}

export function assertProjectId(value: unknown): ProjectId {
  if (!isProjectId(value)) {
    throw new BootstrapError(
      `not a project identity: ${JSON.stringify(value)}. Expected prj_ followed by 32 hex characters.`,
      'INVALID_PROJECT_ID',
    );
  }
  return value;
}

/**
 * How a principal reached us.
 *
 * Recorded rather than inferred, because the contract's whole point is that
 * the ceremony cannot promote an ambient identity. `operator_confirmed` is the
 * only source version 1 accepts: a human read the manifest and approved it.
 * The others exist so a caller can hand over what it actually has and be
 * refused, instead of quietly succeeding.
 */
export type PrincipalSource =
  | 'operator_confirmed'
  | 'environment'
  | 'git_author'
  | 'repository_owner'
  | 'remote_request';

export interface BootstrapPrincipal {
  /** Stable identifier from the trusted channel. Not a display name. */
  principal_id: string;
  /** Identifies the authentication that produced this principal. */
  authentication_context_id: string;
  source: PrincipalSource;
}

/** Everything the ceremony writes, as one atomic unit. */
export interface GenesisRecords {
  project: {
    project_id: ProjectId;
    schema_revision: string;
    created_at: string;
  };
  identity_policy: { revision: string; administrator_principal_id: string };
  capability_policy: { revision: string; grants: BootstrapGrant[] };
  visibility_policy: { revision: string; default_classification: 'restricted' };
  resource_policy: { revision: string };
  integrity_checkpoint: { event_sequence: '0'; project_hash: string };
}

export interface BootstrapGrant {
  principal_id: string;
  capability: string;
  scope: string;
}

/**
 * The enumerated bootstrap administration grant.
 *
 * Enumerated, not a wildcard. The contract asks for an enumerated grant and
 * the difference matters: a wildcard silently acquires every capability added
 * in a later sprint, so an administrator bootstrapped today would gain
 * `round.reopen` and `recovery.manage` the moment those ship, with no record
 * of anyone deciding that.
 */
export const BOOTSTRAP_ADMIN_CAPABILITIES: readonly string[] = [
  'round.read',
  'round.open',
  'event.read_filtered',
  'recovery.manage',
];

export interface BootstrapManifest {
  schema_revision: string;
  project_id: ProjectId;
  administrator_principal_id: string;
  authentication_context_id: string;
  capabilities: readonly string[];
  policy_revisions: {
    identity: string;
    capability: string;
    visibility: string;
    resource: string;
  };
  checkpoint_hash: string;
  /** Hash over every field above. Displayed and recorded. */
  manifest_hash: string;
}

export interface BootstrapResult {
  records: GenesisRecords;
  manifest: BootstrapManifest;
}

export interface BootstrapInput {
  principal: BootstrapPrincipal;
  /** Store time, supplied so the ceremony is deterministic under test. */
  now: string;
  /** Present when a store already holds a project. Bootstrap then refuses. */
  existingProjectId?: ProjectId | null;
  /**
   * Distinct legacy namespaces found in the store. More than one means rows
   * map ambiguously to several projects, and the contract requires migration
   * quarantine and an explicit mapping rather than a guess.
   */
  legacyNamespaces?: readonly string[];
  /** Injected for tests. Real callers take the default. */
  mint?: () => ProjectId;
}

/**
 * Run the bootstrap ceremony and return what to write and what to display.
 *
 * Pure: it performs no I/O and reads no environment. The caller persists the
 * records in one transaction and shows the manifest for confirmation. Keeping
 * it pure is what lets the refusals be tested at all.
 */
export function bootstrapProject(input: BootstrapInput): BootstrapResult {
  if (input.existingProjectId) {
    throw new BootstrapError(
      `project ${input.existingProjectId} already exists. Bootstrap is a one-time ceremony; `
      + 'recovering an unavailable trust root is a separate authorized policy event.',
      'PROJECT_EXISTS',
    );
  }

  // The refusal the contract cares most about. An ambient identity is exactly
  // what an attacker running the command already has.
  if (input.principal.source !== 'operator_confirmed') {
    throw new BootstrapError(
      `refusing to bootstrap from a ${input.principal.source} principal. `
      + 'Administrator identity must come from a trusted channel and be confirmed by an operator, '
      + 'not derived from the environment, the Git author, repository ownership, or a remote request.',
      'PRINCIPAL_UNTRUSTED',
    );
  }
  if (!input.principal.principal_id.trim() || !input.principal.authentication_context_id.trim()) {
    throw new BootstrapError(
      'principal_id and authentication_context_id are both required and must be non-empty.',
      'PRINCIPAL_UNTRUSTED',
    );
  }

  const namespaces = input.legacyNamespaces ?? [];
  if (namespaces.length > 1) {
    throw new BootstrapError(
      `store rows map to ${namespaces.length} namespaces (${namespaces.join(', ')}). `
      + 'Migration quarantine requires an explicit operator-supplied mapping; '
      + 'bootstrap will not choose one.',
      'AMBIGUOUS_LEGACY_NAMESPACE',
    );
  }

  const projectId = (input.mint ?? mintProjectId)();
  assertProjectId(projectId);

  const revisions = {
    identity: `${BOOTSTRAP_SCHEMA_REVISION}:identity:1`,
    capability: `${BOOTSTRAP_SCHEMA_REVISION}:capability:1`,
    visibility: `${BOOTSTRAP_SCHEMA_REVISION}:visibility:1`,
    resource: `${BOOTSTRAP_SCHEMA_REVISION}:resource:1`,
  };

  const grants: BootstrapGrant[] = BOOTSTRAP_ADMIN_CAPABILITIES.map(capability => ({
    principal_id: input.principal.principal_id,
    capability,
    scope: projectId,
  }));

  const records: GenesisRecords = {
    project: {
      project_id: projectId,
      schema_revision: BOOTSTRAP_SCHEMA_REVISION,
      created_at: input.now,
    },
    identity_policy: {
      revision: revisions.identity,
      administrator_principal_id: input.principal.principal_id,
    },
    capability_policy: { revision: revisions.capability, grants },
    // Restricted by default, per the contract. A weaker default would
    // over-disclose every event written before anyone set a policy.
    visibility_policy: { revision: revisions.visibility, default_classification: 'restricted' },
    resource_policy: { revision: revisions.resource },
    integrity_checkpoint: {
      event_sequence: '0',
      project_hash: teamRoundDigest({
        purpose: 'genesis-checkpoint',
        projectId,
        schemaRevision: BOOTSTRAP_SCHEMA_REVISION,
        value: { project_id: projectId, created_at: input.now },
      }).digest,
    },
  };

  const manifestBody = {
    schema_revision: BOOTSTRAP_SCHEMA_REVISION,
    project_id: projectId,
    administrator_principal_id: input.principal.principal_id,
    authentication_context_id: input.principal.authentication_context_id,
    capabilities: [...BOOTSTRAP_ADMIN_CAPABILITIES],
    policy_revisions: revisions,
    checkpoint_hash: records.integrity_checkpoint.project_hash,
  };

  return {
    records,
    manifest: {
      ...manifestBody,
      manifest_hash: teamRoundDigest({
        purpose: 'bootstrap-manifest',
        projectId,
        schemaRevision: BOOTSTRAP_SCHEMA_REVISION,
        value: manifestBody,
      }).digest,
    },
  };
}

/**
 * The manifest as an operator should read it before approving.
 *
 * Plain text on purpose. The person confirming has to be able to compare the
 * principal and the hash against what they expect, and a JSON blob invites
 * approval without reading.
 */
export function formatBootstrapManifest(manifest: BootstrapManifest): string {
  return [
    'Team Round bootstrap — confirm before this is written',
    '',
    `  Project:        ${manifest.project_id}`,
    `  Administrator:  ${manifest.administrator_principal_id}`,
    `  Authenticated:  ${manifest.authentication_context_id}`,
    `  Capabilities:   ${manifest.capabilities.join(', ')}`,
    `  Checkpoint:     ${manifest.checkpoint_hash}`,
    `  Manifest hash:  ${manifest.manifest_hash}`,
    '',
    'This is a one-time ceremony. The project identity cannot be changed later,',
    'and it namespaces every digest in the ledger.',
  ].join('\n');
}

/** Canonical bytes of the manifest, for recording alongside the records. */
export function bootstrapManifestBytes(manifest: BootstrapManifest): string {
  return canonicalJson({ ...manifest });
}
