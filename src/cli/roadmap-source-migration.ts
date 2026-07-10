import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { stringify } from 'yaml';
import {
  discoverScorecardFiles,
  normalizeDiagnosticPath,
  normalizeScorecard,
  parseRoadmapSourceDocument,
  parseRoadmapSourceProject,
  parseSprintNumber,
  serializeRoadmapProjection,
  validateRoadmapSourceFederation,
  validateScorecard,
  type GolfScorecard,
  type LoadedRoadmapSource,
  type RoadmapSourceProject,
} from '../core/index.js';
import {
  computeRoadmapMigrationDigest,
  parseRoadmapMigrationMapping,
  planRoadmapMigration,
  type RoadmapMigrationPlan,
  type RoadmapMigrationScorecardEvidence,
} from '../core/roadmap-migration.js';
import { atomicWriteFileSync, withFileLockSync } from './atomic-write.js';
import { loadConfig } from './config.js';
import {
  loadRoadmapSourceStore,
  resolveRoadmapSourceManifest,
  validateRoadmapSourceStore,
} from './roadmap-source-store.js';

const AUDIT_RELATIVE_PATH = 'migration/audit.json';
const NON_CORE_RELATIVE_PATH = 'migration/non-core.json';
const RECEIPT_RELATIVE_PATH = 'migration/receipt.json';
const JOURNAL_RELATIVE_PATH = '.federation/migration-journal.json';
const BACKUP_RELATIVE_PATH = '.federation/migration-backup.json';

type ArtifactRole = 'bundle' | 'audit' | 'non_core' | 'receipt' | 'projection' | 'manifest';

interface MigrationArtifact {
  role: ArtifactRole;
  path: string;
  absolutePath: string;
  contents: string;
  sha256: string;
}

interface MigrationEvidenceArtifact {
  path: string;
  absolutePath: string;
  sha256: string;
}

interface RoadmapMigrationReceiptOutput {
  role: Exclude<ArtifactRole, 'receipt'>;
  path: string;
  sha256: string;
}

export interface RoadmapMigrationReceipt {
  version: 1;
  kind: 'roadmap_migration_receipt';
  migration_id: string;
  recorded_at: string;
  plan_sha256: string;
  source: {
    path: string;
    original_sha256: string;
    projection_sha256: string;
  };
  manifest: { path: string; sha256: string };
  audit_path: string;
  non_core_path: string;
  receipt_path: string;
  summary: { sources: number; archives: number; history_unverified: number };
  outputs: RoadmapMigrationReceiptOutput[];
  integrity_sha256: string;
}

interface MigrationJournal {
  version: 1;
  kind: 'roadmap_migration_journal';
  migration_id: string;
  recorded_at: string;
  source_path: string;
  source_original_sha256: string;
  projection_sha256: string;
  manifest_path: string;
  outputs: Array<{ role: ArtifactRole; path: string; sha256: string }>;
  integrity_sha256: string;
}

interface MigrationBackup {
  version: 1;
  kind: 'roadmap_migration_backup';
  source_path: string;
  sha256: string;
  bytes_base64: string;
}

export interface RoadmapSourceMigrationInput {
  cwd: string;
  path?: string;
  source?: string;
  mapping?: string;
  recordedAt?: string;
}

interface PreparedMigrationBase {
  input: RoadmapSourceMigrationInput;
  sourcePath: string;
  sourceRelativePath: string;
  manifestPath: string;
  manifestRelativePath: string;
  sourceRoot: string;
  journalPath: string;
  backupPath: string;
}

export interface ReadyRoadmapSourceMigration extends PreparedMigrationBase {
  status: 'ready';
  recordedAt: string;
  sourceBytes: Buffer;
  sourceSha256: string;
  mappingSha256?: string;
  evidenceSha256: string;
  evidenceArtifacts: MigrationEvidenceArtifact[];
  plan: RoadmapMigrationPlan;
  artifacts: MigrationArtifact[];
  receipt: RoadmapMigrationReceipt;
}

export interface BlockedRoadmapSourceMigration extends PreparedMigrationBase {
  status: 'blocked';
  plan: RoadmapMigrationPlan;
}

export interface UnchangedRoadmapSourceMigration extends PreparedMigrationBase {
  status: 'unchanged';
  receipt: RoadmapMigrationReceipt;
}

export interface RecoveryRequiredRoadmapSourceMigration extends PreparedMigrationBase {
  status: 'recovery_required';
}

export type PreparedRoadmapSourceMigration =
  | ReadyRoadmapSourceMigration
  | BlockedRoadmapSourceMigration
  | UnchangedRoadmapSourceMigration
  | RecoveryRequiredRoadmapSourceMigration;

export interface RoadmapSourceMigrationResult {
  status: 'applied' | 'unchanged';
  receipt: RoadmapMigrationReceipt;
  sources: number;
  archives: number;
  historyUnverified: number;
}

export interface RoadmapSourceMigrationApplyHooks {
  afterWrite?: (role: ArtifactRole, path: string) => void;
}

function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function portablePath(cwd: string, path: string): string {
  return normalizeDiagnosticPath(relative(cwd, path));
}

function samePath(left: string, right: string): boolean {
  return process.platform === 'win32'
    ? resolve(left).toLowerCase() === resolve(right).toLowerCase()
    : resolve(left) === resolve(right);
}

function ensureWithin(root: string, path: string, label: string): string {
  const resolvedRoot = resolve(root);
  const resolvedPath = resolve(path);
  const rel = relative(resolvedRoot, resolvedPath);
  if (rel === '..' || rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(rel)) {
    throw new Error(`${label} escapes ${normalizeDiagnosticPath(resolvedRoot)}: ${normalizeDiagnosticPath(resolvedPath)}`);
  }
  let existing = resolvedPath;
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  const realRoot = realpathSync(resolvedRoot);
  const realExisting = realpathSync(existing);
  const realRel = relative(realRoot, realExisting);
  if (realRel === '..'
    || realRel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
    || isAbsolute(realRel)) {
    throw new Error(`${label} resolves outside ${normalizeDiagnosticPath(realRoot)}: ${normalizeDiagnosticPath(realExisting)}`);
  }
  return resolvedPath;
}

function atomicWriteBytes(path: string, bytes: Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${randomBytes(10).toString('hex')}.migration.tmp`);
  let fd: number | undefined;
  try {
    fd = openSync(temporary, 'wx');
    writeFileSync(fd, bytes);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
    throw error;
  }
}

function readMapping(cwd: string, mappingFlag?: string): { mapping?: ReturnType<typeof parseRoadmapMigrationMapping>; sha?: string } {
  if (!mappingFlag) return {};
  const path = ensureWithin(cwd, resolve(cwd, mappingFlag), 'migration mapping path');
  if (!existsSync(path)) throw new Error(`Roadmap migration mapping not found: ${portablePath(cwd, path)}`);
  const bytes = readFileSync(path);
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`Could not parse migration mapping ${portablePath(cwd, path)}: ${(error as Error).message}`);
  }
  return { mapping: parseRoadmapMigrationMapping(raw), sha: sha256(bytes) };
}

function collectScorecardEvidence(cwd: string): {
  evidence: Record<string, RoadmapMigrationScorecardEvidence>;
  artifacts: MigrationEvidenceArtifact[];
  digest: string;
} {
  const config = loadConfig(cwd);
  const evidence: Record<string, RoadmapMigrationScorecardEvidence> = {};
  const artifacts: MigrationEvidenceArtifact[] = [];
  const evidenceDigests: Array<{ sprint: string; path: string; sha256: string; evidence: RoadmapMigrationScorecardEvidence }> = [];
  for (const discovered of discoverScorecardFiles(config, cwd)) {
    const absolutePath = ensureWithin(cwd, resolve(cwd, discovered), 'scorecard evidence path');
    const bytes = readFileSync(absolutePath);
    const path = portablePath(cwd, absolutePath);
    let raw: Record<string, unknown>;
    try {
      raw = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
    } catch (error) {
      continue;
    }
    const sprint = parseSprintNumber(raw.sprint_number as string | number ?? raw.sprint as string | number);
    if (sprint == null) continue;
    const validation = validateScorecard(normalizeScorecard(raw) as GolfScorecard);
    const sprintKey = String(sprint);
    evidence[sprintKey] = {
      path,
      valid: validation.valid,
      ...(!validation.valid ? { reason: validation.errors.slice(0, 3).map(issue => issue.message).join('; ') } : {}),
    };
    const digest = sha256(bytes);
    artifacts.push({ path, absolutePath, sha256: digest });
    evidenceDigests.push({ sprint: sprintKey, path, sha256: digest, evidence: evidence[sprintKey] });
  }
  artifacts.sort((a, b) => a.path.localeCompare(b.path));
  evidenceDigests.sort((a, b) => a.path.localeCompare(b.path));
  return { evidence, artifacts, digest: computeRoadmapMigrationDigest(evidenceDigests) };
}

function renderMigration(
  cwd: string,
  sourcePath: string,
  manifestPath: string,
  recordedAt: string,
  plan: RoadmapMigrationPlan,
): { artifacts: MigrationArtifact[]; receipt: RoadmapMigrationReceipt } {
  const sourceRoot = dirname(manifestPath);
  const project: RoadmapSourceProject = {
    version: '1',
    name: plan.normalized_roadmap.name,
    ...(plan.normalized_roadmap.description
      ? { description: plan.normalized_roadmap.description }
      : {}),
    output: normalizeDiagnosticPath(relative(sourceRoot, sourcePath)),
    sources: plan.sources.map(source => ({ path: source.path, kind: source.kind })),
  };
  const projectYaml = stringify(project, { lineWidth: 0 });
  const parsedProject = parseRoadmapSourceProject(projectYaml, portablePath(cwd, manifestPath));
  const loadedSources: LoadedRoadmapSource[] = plan.sources.map(source => {
    const absolutePath = ensureWithin(cwd, resolve(sourceRoot, ...source.path.split('/')), 'migration bundle path');
    const document = {
      version: '1' as const,
      phase: source.phase,
      sprints: source.sprints,
      ...(Object.keys(source.scorecards).length > 0 ? { scorecards: source.scorecards } : {}),
    };
    const contents = stringify(document, { lineWidth: 0 });
    return {
      entry: { path: source.path, kind: source.kind },
      document: parseRoadmapSourceDocument(contents, source.path),
      absolutePath,
    };
  });
  const stagedValidation = validateRoadmapSourceFederation(parsedProject, loadedSources);
  if (!stagedValidation.valid) {
    throw new Error([
      'Rendered roadmap migration sources are invalid:',
      ...stagedValidation.errors.slice(0, 10).map(issue => `  - ${issue.source ? `${issue.source}: ` : ''}${issue.message}`),
      ...(stagedValidation.errors.length > 10 ? [`  - ... ${stagedValidation.errors.length - 10} additional error(s)`] : []),
    ].join('\n'));
  }
  const projection = serializeRoadmapProjection(stagedValidation.roadmap);
  const artifacts: MigrationArtifact[] = loadedSources.map((source, index) => {
    const contents = stringify({
      version: '1',
      phase: plan.sources[index].phase,
      sprints: plan.sources[index].sprints,
      ...(Object.keys(plan.sources[index].scorecards).length > 0 ? { scorecards: plan.sources[index].scorecards } : {}),
    }, { lineWidth: 0 });
    return {
      role: 'bundle',
      path: portablePath(cwd, source.absolutePath!),
      absolutePath: source.absolutePath!,
      contents,
      sha256: sha256(contents),
    };
  });
  const auditPath = ensureWithin(cwd, join(sourceRoot, AUDIT_RELATIVE_PATH), 'migration audit path');
  const nonCorePath = ensureWithin(cwd, join(sourceRoot, NON_CORE_RELATIVE_PATH), 'migration non-core path');
  const receiptPath = ensureWithin(cwd, join(sourceRoot, RECEIPT_RELATIVE_PATH), 'migration receipt path');
  const auditContents = json({
    version: 1,
    kind: 'roadmap_migration_audit',
    recorded_at: recordedAt,
    plan_sha256: plan.plan_sha256,
    source_sha256: plan.source_sha256,
    mapping_sha256: plan.mapping_sha256,
    diagnostics: plan.diagnostics,
    diagnostics_total: plan.diagnostics_total,
    diagnostics_omitted: plan.diagnostics_omitted,
    audit: plan.audit,
    source_classification: plan.sources.map(source => ({
      path: source.path,
      classification: source.classification,
      reasons: source.classification_reasons,
    })),
  });
  const nonCoreContents = json({
    version: 1,
    kind: 'roadmap_migration_non_core_export',
    source_sha256: plan.source_sha256,
    fields: plan.non_core.fields,
  });
  artifacts.push(
    { role: 'audit', path: portablePath(cwd, auditPath), absolutePath: auditPath, contents: auditContents, sha256: sha256(auditContents) },
    { role: 'non_core', path: portablePath(cwd, nonCorePath), absolutePath: nonCorePath, contents: nonCoreContents, sha256: sha256(nonCoreContents) },
    { role: 'projection', path: portablePath(cwd, sourcePath), absolutePath: sourcePath, contents: projection, sha256: sha256(projection) },
    { role: 'manifest', path: portablePath(cwd, manifestPath), absolutePath: manifestPath, contents: projectYaml, sha256: sha256(projectYaml) },
  );
  const migrationId = plan.plan_sha256.slice(0, 16);
  const receiptOutputs: RoadmapMigrationReceiptOutput[] = artifacts.map(artifact => {
    if (artifact.role === 'receipt') throw new Error('Receipt cannot include its own digest.');
    return { role: artifact.role, path: artifact.path, sha256: artifact.sha256 };
  });
  const receiptWithoutIntegrity = {
    version: 1 as const,
    kind: 'roadmap_migration_receipt' as const,
    migration_id: migrationId,
    recorded_at: recordedAt,
    plan_sha256: plan.plan_sha256,
    source: {
      path: portablePath(cwd, sourcePath),
      original_sha256: plan.source_sha256,
      projection_sha256: sha256(projection),
    },
    manifest: { path: portablePath(cwd, manifestPath), sha256: sha256(projectYaml) },
    audit_path: portablePath(cwd, auditPath),
    non_core_path: portablePath(cwd, nonCorePath),
    receipt_path: portablePath(cwd, receiptPath),
    summary: {
      sources: plan.sources.length,
      archives: plan.sources.filter(source => source.classification === 'archive').length,
      history_unverified: plan.sources.filter(source => source.classification === 'history_unverified').length,
    },
    outputs: receiptOutputs,
  };
  const receipt: RoadmapMigrationReceipt = {
    ...receiptWithoutIntegrity,
    integrity_sha256: computeRoadmapMigrationDigest(receiptWithoutIntegrity),
  };
  const receiptContents = json(receipt);
  artifacts.splice(artifacts.length - 2, 0, {
    role: 'receipt',
    path: portablePath(cwd, receiptPath),
    absolutePath: receiptPath,
    contents: receiptContents,
    sha256: sha256(receiptContents),
  });
  const paths = new Set<string>();
  for (const artifact of artifacts) {
    const key = process.platform === 'win32' ? artifact.absolutePath.toLowerCase() : artifact.absolutePath;
    if (paths.has(key)) throw new Error(`Roadmap migration output collision: ${artifact.path}`);
    paths.add(key);
  }
  return { artifacts, receipt };
}

function basePaths(input: RoadmapSourceMigrationInput): PreparedMigrationBase {
  const cwd = realpathSync(resolve(input.cwd));
  const config = loadConfig(cwd);
  const configuredPath = ensureWithin(cwd, resolve(cwd, config.roadmapPath), 'configured roadmap path');
  const sourcePath = ensureWithin(cwd, resolve(cwd, input.path ?? config.roadmapPath), 'migration roadmap path');
  if (!samePath(sourcePath, configuredPath)) {
    throw new Error(`Migration --path must equal configured roadmapPath ${portablePath(cwd, configuredPath)}.`);
  }
  if (!existsSync(sourcePath)) throw new Error(`Roadmap migration source not found: ${portablePath(cwd, sourcePath)}`);
  if (realpathSync(sourcePath) !== realpathSync(configuredPath)) {
    throw new Error('Migration --path and configured roadmapPath do not resolve to the same file.');
  }
  const manifestPath = resolveRoadmapSourceManifest(cwd, input.source);
  const sourceRoot = dirname(manifestPath);
  if (samePath(sourcePath, manifestPath)) throw new Error('Migration source and manifest paths must be different.');
  return {
    input: { ...input, cwd },
    sourcePath,
    sourceRelativePath: portablePath(cwd, sourcePath),
    manifestPath,
    manifestRelativePath: portablePath(cwd, manifestPath),
    sourceRoot,
    journalPath: ensureWithin(cwd, join(sourceRoot, JOURNAL_RELATIVE_PATH), 'migration journal path'),
    backupPath: ensureWithin(cwd, join(sourceRoot, BACKUP_RELATIVE_PATH), 'migration backup path'),
  };
}

function parseReceipt(base: PreparedMigrationBase): RoadmapMigrationReceipt | null {
  const receiptPath = join(base.sourceRoot, RECEIPT_RELATIVE_PATH);
  if (!existsSync(receiptPath)) return null;
  let receipt: RoadmapMigrationReceipt;
  try {
    receipt = JSON.parse(readFileSync(receiptPath, 'utf8')) as RoadmapMigrationReceipt;
  } catch {
    return null;
  }
  if (!receipt || typeof receipt !== 'object' || !receipt.source || !receipt.manifest || !receipt.summary
    || !Array.isArray(receipt.outputs) || typeof receipt.integrity_sha256 !== 'string') return null;
  const { integrity_sha256: receiptIntegrity, ...receiptPayload } = receipt;
  if (receipt.version !== 1 || receipt.kind !== 'roadmap_migration_receipt'
    || receipt.receipt_path !== portablePath(base.input.cwd, receiptPath)
    || receipt.manifest.path !== base.manifestRelativePath
    || receipt.source.path !== base.sourceRelativePath
    || receiptIntegrity !== computeRoadmapMigrationDigest(receiptPayload)) {
    return null;
  }
  const roles = new Map<Exclude<ArtifactRole, 'receipt'>, RoadmapMigrationReceiptOutput>();
  const outputPaths = new Set<string>();
  for (const output of receipt.outputs) {
    if (!output || typeof output.path !== 'string' || typeof output.sha256 !== 'string'
      || !/^[a-f0-9]{64}$/i.test(output.sha256)
      || !['bundle', 'audit', 'non_core', 'projection', 'manifest'].includes(output.role)) return null;
    if (output.role !== 'bundle' && roles.has(output.role)) return null;
    if (output.role !== 'bundle') roles.set(output.role, output);
    const path = ensureWithin(base.input.cwd, resolve(base.input.cwd, ...output.path.split('/')), 'receipt output path');
    const pathKey = process.platform === 'win32' ? path.toLowerCase() : path;
    if (outputPaths.has(pathKey)) return null;
    outputPaths.add(pathKey);
    if (!existsSync(path) || sha256(readFileSync(path)) !== output.sha256) return null;
  }
  if (roles.get('manifest')?.path !== receipt.manifest.path
    || roles.get('manifest')?.sha256 !== receipt.manifest.sha256
    || roles.get('projection')?.path !== receipt.source.path
    || roles.get('projection')?.sha256 !== receipt.source.projection_sha256
    || roles.get('audit')?.path !== receipt.audit_path
    || roles.get('non_core')?.path !== receipt.non_core_path
    || receipt.summary.sources !== receipt.outputs.filter(output => output.role === 'bundle').length
    || !Number.isInteger(receipt.summary.archives) || receipt.summary.archives < 0
    || !Number.isInteger(receipt.summary.history_unverified) || receipt.summary.history_unverified < 0
    || receipt.summary.archives + receipt.summary.history_unverified > receipt.summary.sources) return null;
  if (sha256(readFileSync(receiptPath)) !== sha256(json(receipt))) return null;
  try {
    const store = loadRoadmapSourceStore(base.input.cwd, base.manifestRelativePath);
    if (!validateRoadmapSourceStore(store).valid) return null;
    const receiptBundles = new Set(receipt.outputs.filter(output => output.role === 'bundle').map(output => output.path));
    if (store.sources.some(source => !source.absolutePath || !receiptBundles.has(portablePath(base.input.cwd, source.absolutePath)))) return null;
  } catch {
    return null;
  }
  return receipt;
}

function readBackup(base: PreparedMigrationBase): { backup: MigrationBackup; bytes: Buffer } {
  let backup: MigrationBackup;
  try {
    backup = JSON.parse(readFileSync(base.backupPath, 'utf8')) as MigrationBackup;
  } catch (error) {
    throw new Error(`Could not read roadmap migration backup: ${(error as Error).message}`);
  }
  if (typeof backup.bytes_base64 !== 'string') throw new Error('Roadmap migration backup is malformed.');
  const bytes = Buffer.from(backup.bytes_base64, 'base64');
  if (backup.version !== 1 || backup.kind !== 'roadmap_migration_backup'
    || backup.source_path !== base.sourceRelativePath || sha256(bytes) !== backup.sha256) {
    throw new Error('Roadmap migration backup failed integrity validation.');
  }
  return { backup, bytes };
}

export function prepareRoadmapSourceMigration(input: RoadmapSourceMigrationInput): PreparedRoadmapSourceMigration {
  const base = basePaths(input);
  const journalExists = existsSync(base.journalPath);
  const backupExists = existsSync(base.backupPath);
  if (existsSync(base.manifestPath)) {
    const receipt = parseReceipt(base);
    if (receipt) return { ...base, status: 'unchanged', receipt };
    if (journalExists && backupExists) return { ...base, status: 'recovery_required' };
    throw new Error(`Modular roadmap manifest already exists at ${base.manifestRelativePath}; refusing to replace hand-authored sources.`);
  }
  if (journalExists && !backupExists) {
    throw new Error('Roadmap migration journal exists without its required backup; refusing unsafe recovery.');
  }
  if (backupExists) return { ...base, status: 'recovery_required' };
  const sourceBytes = readFileSync(base.sourcePath);
  const sourceText = sourceBytes.toString('utf8');
  const mapping = readMapping(base.input.cwd, input.mapping);
  const evidence = collectScorecardEvidence(base.input.cwd);
  const plan = planRoadmapMigration(sourceText, { mapping: mapping.mapping, evidence: evidence.evidence });
  if (plan.source_sha256 !== sha256(sourceBytes)) {
    throw new Error('Roadmap migration planner source digest does not match the exact input bytes.');
  }
  if (!plan.applicable) return { ...base, status: 'blocked', plan };
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  const rendered = renderMigration(base.input.cwd, base.sourcePath, base.manifestPath, recordedAt, plan);
  const simulated = {
    cwd: base.input.cwd,
    manifestPath: base.manifestPath,
    sourceRoot: base.sourceRoot,
    outputPath: base.sourcePath,
    project: parseRoadmapSourceProject(
      rendered.artifacts.find(artifact => artifact.role === 'manifest')!.contents,
      base.manifestRelativePath,
    ),
    sources: rendered.artifacts.filter(artifact => artifact.role === 'bundle').map(artifact => ({
      entry: plan.sources.find(source => samePath(join(base.sourceRoot, source.path), artifact.absolutePath))!,
      document: parseRoadmapSourceDocument(artifact.contents, artifact.path),
      absolutePath: artifact.absolutePath,
    })).map(item => ({ entry: { path: item.entry.path, kind: item.entry.kind }, document: item.document, absolutePath: item.absolutePath })),
    roadmap: validateRoadmapSourceFederation(
      parseRoadmapSourceProject(rendered.artifacts.find(artifact => artifact.role === 'manifest')!.contents, base.manifestRelativePath),
      rendered.artifacts.filter(artifact => artifact.role === 'bundle').map((artifact, index) => ({
        entry: { path: plan.sources[index].path, kind: plan.sources[index].kind },
        document: parseRoadmapSourceDocument(artifact.contents, artifact.path),
        absolutePath: artifact.absolutePath,
      })),
    ).roadmap,
    projection: rendered.artifacts.find(artifact => artifact.role === 'projection')!.contents,
  };
  const stagedValidation = validateRoadmapSourceStore(simulated, { checkProjection: false, checkArchiveEvidence: true });
  if (!stagedValidation.valid) {
    throw new Error([
      'Staged roadmap migration failed archive evidence validation:',
      ...stagedValidation.errors.slice(0, 10).map(issue => `  - ${issue.source ? `${issue.source}: ` : ''}${issue.message}`),
    ].join('\n'));
  }
  return {
    ...base,
    status: 'ready',
    recordedAt,
    sourceBytes,
    sourceSha256: sha256(sourceBytes),
    ...(mapping.sha ? { mappingSha256: mapping.sha } : {}),
    evidenceSha256: evidence.digest,
    evidenceArtifacts: evidence.artifacts,
    plan,
    artifacts: rendered.artifacts,
    receipt: rendered.receipt,
  };
}

function readTransaction(base: PreparedMigrationBase): { journal: MigrationJournal; backup: MigrationBackup; bytes: Buffer } {
  let journal: MigrationJournal;
  let backup: MigrationBackup;
  try {
    journal = JSON.parse(readFileSync(base.journalPath, 'utf8')) as MigrationJournal;
    backup = JSON.parse(readFileSync(base.backupPath, 'utf8')) as MigrationBackup;
  } catch (error) {
    throw new Error(`Could not read roadmap migration recovery metadata: ${(error as Error).message}`);
  }
  if (typeof backup.bytes_base64 !== 'string') throw new Error('Roadmap migration recovery backup is malformed.');
  const bytes = Buffer.from(backup.bytes_base64, 'base64');
  const { integrity_sha256: journalIntegrity, ...journalPayload } = journal;
  if (journal.version !== 1 || journal.kind !== 'roadmap_migration_journal'
    || backup.version !== 1 || backup.kind !== 'roadmap_migration_backup'
    || journal.source_path !== base.sourceRelativePath || backup.source_path !== base.sourceRelativePath
    || journal.manifest_path !== base.manifestRelativePath || !Array.isArray(journal.outputs)
    || typeof journalIntegrity !== 'string'
    || journalIntegrity !== computeRoadmapMigrationDigest(journalPayload)
    || backup.sha256 !== journal.source_original_sha256 || sha256(bytes) !== backup.sha256) {
    throw new Error('Roadmap migration recovery metadata failed integrity validation.');
  }
  const allowedRoles = new Set<ArtifactRole>(['bundle', 'audit', 'non_core', 'receipt', 'projection', 'manifest']);
  const outputPaths = new Set<string>();
  let manifestOutput = false;
  let projectionOutput = false;
  for (const output of journal.outputs) {
    if (!output || !allowedRoles.has(output.role) || typeof output.path !== 'string'
      || typeof output.sha256 !== 'string' || !/^[a-f0-9]{64}$/i.test(output.sha256)) {
      throw new Error('Roadmap migration journal contains an invalid output record.');
    }
    const path = ensureWithin(base.input.cwd, resolve(base.input.cwd, ...output.path.split('/')), 'journal output path');
    const key = process.platform === 'win32' ? path.toLowerCase() : path;
    if (outputPaths.has(key)) throw new Error('Roadmap migration journal contains duplicate output paths.');
    outputPaths.add(key);
    if (output.role === 'manifest') manifestOutput = output.path === base.manifestRelativePath;
    if (output.role === 'projection') projectionOutput = output.path === base.sourceRelativePath
      && output.sha256 === journal.projection_sha256;
  }
  if (!manifestOutput || !projectionOutput) {
    throw new Error('Roadmap migration journal does not bind the expected manifest and projection outputs.');
  }
  return { journal, backup, bytes };
}

function rollbackTransaction(base: PreparedMigrationBase): void {
  if (!existsSync(base.journalPath)) {
    const { backup, bytes } = readBackup(base);
    const currentDigest = sha256(readFileSync(base.sourcePath));
    if (currentDigest !== backup.sha256) {
      throw new Error(`Cannot recover backup-only transaction after roadmap source changed: ${base.sourceRelativePath}`);
    }
    if (!readFileSync(base.sourcePath).equals(bytes)) {
      throw new Error(`Backup-only transaction does not match roadmap source bytes: ${base.sourceRelativePath}`);
    }
    return;
  }
  const { journal, bytes } = readTransaction(base);
  for (const output of [...journal.outputs].reverse()) {
    const path = ensureWithin(base.input.cwd, resolve(base.input.cwd, ...output.path.split('/')), 'journal output path');
    if (samePath(path, base.sourcePath)) continue;
    if (!existsSync(path)) continue;
    if (sha256(readFileSync(path)) !== output.sha256) {
      throw new Error(`Cannot roll back changed migration output: ${output.path}`);
    }
    unlinkSync(path);
  }
  const currentDigest = sha256(readFileSync(base.sourcePath));
  if (currentDigest === journal.projection_sha256) {
    atomicWriteBytes(base.sourcePath, bytes);
  } else if (currentDigest !== journal.source_original_sha256) {
    throw new Error(`Cannot restore changed roadmap source: ${base.sourceRelativePath}`);
  }
}

function cleanupTransaction(base: PreparedMigrationBase): void {
  if (existsSync(base.journalPath)) unlinkSync(base.journalPath);
  if (existsSync(base.backupPath)) unlinkSync(base.backupPath);
}

function verifyEvidence(prepared: ReadyRoadmapSourceMigration): void {
  for (const artifact of prepared.evidenceArtifacts) {
    if (!existsSync(artifact.absolutePath) || sha256(readFileSync(artifact.absolutePath)) !== artifact.sha256) {
      throw new Error(`Scorecard evidence changed during migration: ${artifact.path}`);
    }
  }
}

function resultForReceipt(receipt: RoadmapMigrationReceipt, status: 'applied' | 'unchanged'): RoadmapSourceMigrationResult {
  return {
    status,
    receipt,
    sources: receipt.summary.sources,
    archives: receipt.summary.archives,
    historyUnverified: receipt.summary.history_unverified,
  };
}

export function applyRoadmapSourceMigration(
  prepared: PreparedRoadmapSourceMigration,
  hooks: RoadmapSourceMigrationApplyHooks = {},
): RoadmapSourceMigrationResult {
  const lock = join(prepared.sourceRoot, '.federation');
  return withFileLockSync(lock, () => {
    if (prepared.status === 'unchanged') {
      const fresh = prepareRoadmapSourceMigration(prepared.input);
      if (fresh.status !== 'unchanged') throw new Error('Roadmap migration receipt changed before idempotent verification.');
      cleanupTransaction(fresh);
      return resultForReceipt(fresh.receipt, 'unchanged');
    }
    if (prepared.status === 'recovery_required') {
      rollbackTransaction(prepared);
      cleanupTransaction(prepared);
      const recovered = prepareRoadmapSourceMigration(prepared.input);
      if (recovered.status !== 'ready') {
        throw new Error(`Roadmap migration recovery completed but the fresh plan is ${recovered.status}.`);
      }
      return applyPreparedUnderLock(recovered, hooks);
    }
    if (prepared.status === 'blocked') {
      throw new Error('Roadmap migration has unresolved ownership repairs; provide --mapping before apply.');
    }
    return applyPreparedUnderLock(prepared, hooks);
  });
}

function applyPreparedUnderLock(
  prepared: ReadyRoadmapSourceMigration,
  hooks: RoadmapSourceMigrationApplyHooks,
): RoadmapSourceMigrationResult {
  const fresh = prepareRoadmapSourceMigration({ ...prepared.input, recordedAt: prepared.recordedAt });
  if (fresh.status !== 'ready'
    || fresh.sourceSha256 !== prepared.sourceSha256
    || fresh.mappingSha256 !== prepared.mappingSha256
    || fresh.evidenceSha256 !== prepared.evidenceSha256
    || fresh.plan.plan_sha256 !== prepared.plan.plan_sha256
    || computeRoadmapMigrationDigest(fresh.artifacts.map(artifact => ({
      role: artifact.role, path: artifact.path, sha256: artifact.sha256,
    }))) !== computeRoadmapMigrationDigest(prepared.artifacts.map(artifact => ({
      role: artifact.role, path: artifact.path, sha256: artifact.sha256,
    })))) {
    throw new Error('Roadmap migration inputs changed before the federation lock; rerun dry-run and apply.');
  }
  for (const artifact of fresh.artifacts) {
    if (artifact.role === 'projection') continue;
    if (existsSync(artifact.absolutePath)) {
      throw new Error(`Roadmap migration output already exists: ${artifact.path}`);
    }
  }
  verifyEvidence(fresh);
  if (sha256(readFileSync(fresh.sourcePath)) !== fresh.sourceSha256) {
    throw new Error('Roadmap migration source changed before transaction preparation.');
  }
  const backup: MigrationBackup = {
    version: 1 as const,
    kind: 'roadmap_migration_backup',
    source_path: fresh.sourceRelativePath,
    sha256: fresh.sourceSha256,
    bytes_base64: fresh.sourceBytes.toString('base64'),
  };
  const projection = fresh.artifacts.find(artifact => artifact.role === 'projection')!;
  const journalPayload = {
    version: 1 as const,
    kind: 'roadmap_migration_journal' as const,
    migration_id: fresh.receipt.migration_id,
    recorded_at: fresh.recordedAt,
    source_path: fresh.sourceRelativePath,
    source_original_sha256: fresh.sourceSha256,
    projection_sha256: projection.sha256,
    manifest_path: fresh.manifestRelativePath,
    outputs: fresh.artifacts.map(artifact => ({ role: artifact.role, path: artifact.path, sha256: artifact.sha256 })),
  };
  const journal: MigrationJournal = {
    ...journalPayload,
    integrity_sha256: computeRoadmapMigrationDigest(journalPayload),
  };
  atomicWriteFileSync(fresh.backupPath, json(backup));
  atomicWriteFileSync(fresh.journalPath, json(journal));
  try {
    const manifest = fresh.artifacts.find(artifact => artifact.role === 'manifest')!;
    for (const artifact of fresh.artifacts) {
      if (artifact.role === 'manifest') continue;
      ensureWithin(fresh.input.cwd, artifact.absolutePath, `migration ${artifact.role} path`);
      if (artifact.role === 'projection' && sha256(readFileSync(fresh.sourcePath)) !== fresh.sourceSha256) {
        throw new Error('Roadmap migration source changed before projection commit.');
      }
      atomicWriteFileSync(artifact.absolutePath, artifact.contents);
      hooks.afterWrite?.(artifact.role, artifact.path);
    }
    verifyEvidence(fresh);
    atomicWriteFileSync(manifest.absolutePath, manifest.contents);
    hooks.afterWrite?.(manifest.role, manifest.path);
    const store = loadRoadmapSourceStore(fresh.input.cwd, fresh.manifestRelativePath);
    const validation = validateRoadmapSourceStore(store);
    if (!validation.valid) {
      throw new Error([
        'Committed roadmap migration failed validation:',
        ...validation.errors.slice(0, 10).map(issue => `  - ${issue.source ? `${issue.source}: ` : ''}${issue.message}`),
      ].join('\n'));
    }
    const receipt = parseReceipt(fresh);
    if (!receipt) throw new Error('Committed roadmap migration receipt or output digests failed verification.');
    cleanupTransaction(fresh);
    return {
      status: 'applied',
      receipt,
      sources: fresh.plan.sources.length,
      archives: fresh.plan.sources.filter(source => source.classification === 'archive').length,
      historyUnverified: fresh.plan.sources.filter(source => source.classification === 'history_unverified').length,
    };
  } catch (error) {
    try {
      rollbackTransaction(fresh);
    } catch (rollbackError) {
      throw new Error(`${(error as Error).message}\nAutomatic rollback also failed: ${(rollbackError as Error).message}`);
    }
    throw error;
  }
}
