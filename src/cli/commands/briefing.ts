import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_SKILLS_PATH, buildSkillBriefing, formatBriefing, parseRoadmap, castRoadmapStructure, getRole, hasRole, loadCustomRoles, filterScorecardsByPlayer, filterHazardsByVisibility, formatDeferredForBriefing, loadDeferred, computeHandicapCard, formatStrategicContext, loadSkillRegistry, parseSprintNumber, loadFindings, formatCodificationCandidatesForBriefing, collectOpenCodificationCandidates } from '../../core/index.js';
import type { CommonIssuesFile, SessionEntry, SprintClaim, RoadmapDefinition, SlopeEvent, RoleDefinition } from '../../core/index.js';
import { loadConfig } from '../config.js';
import { loadScorecards } from '../loader.js';
import { inferSprintContext } from '../sprint-inference.js';
import { resolveStore } from '../store.js';
import { resolveMetaphor } from '../metaphor.js';
import { buildRoadmapReality, collectSiblingWorktreeReality, formatRoadmapRealitySection, formatWorktreeRealitySection } from '../pre-sprint-reality.js';

export async function briefingCommand(args: string[]): Promise<void> {
  const config = loadConfig();
  const cwd = process.cwd();
  const scorecards = loadScorecards(config, cwd);

  // Load common-issues
  let commonIssues: CommonIssuesFile;
  try {
    commonIssues = JSON.parse(readFileSync(join(cwd, config.commonIssuesPath), 'utf8'));
  } catch {
    commonIssues = { recurring_patterns: [] };
  }

  // Load last session
  let lastSession: SessionEntry | undefined;
  try {
    const sessionsData = JSON.parse(readFileSync(join(cwd, config.sessionsPath), 'utf8'));
    const sessions = sessionsData.sessions;
    if (sessions && sessions.length > 0) {
      lastSession = sessions[sessions.length - 1];
    }
  } catch { /* skip */ }

  // Parse args
  const categories: string[] = [];
  const keywords: string[] = [];
  let includeTraining = true;
  let sprintFlag: number | undefined;
  let roleFlag: string | undefined;
  let playerFlag: string | undefined;
  let personalFlag = false;
  let compactFlag = false;
  for (const arg of args) {
    if (arg.startsWith('--categories=')) {
      categories.push(...arg.slice('--categories='.length).split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--keywords=')) {
      keywords.push(...arg.slice('--keywords='.length).split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--sprint=')) {
      const parsed = parseSprintNumber(arg.slice('--sprint='.length));
      if (!parsed) {
        console.error('Error: --sprint must be a positive sprint id, e.g. 114 or 114.5');
        process.exit(1);
      }
      sprintFlag = parsed;
    } else if (arg.startsWith('--role=')) {
      roleFlag = arg.slice('--role='.length).trim();
    } else if (arg.startsWith('--player=')) {
      playerFlag = arg.slice('--player='.length).trim();
    } else if (arg === '--personal') {
      personalFlag = true;
    } else if (arg === '--no-training') {
      includeTraining = false;
    } else if (arg === '--compact') {
      compactFlag = true;
    }
  }

  // Resolve role
  let role: RoleDefinition | undefined;
  if (roleFlag) {
    loadCustomRoles(cwd);
    if (hasRole(roleFlag)) {
      role = getRole(roleFlag);
    } else {
      console.error(`Unknown role: "${roleFlag}". Available roles: generalist, backend, frontend, architect, devops`);
      process.exit(1);
    }
  }

  // Resolve sprint number
  let sprintNumber: number;
  if (sprintFlag) {
    sprintNumber = sprintFlag;
  } else {
    sprintNumber = inferSprintContext(cwd, config).sprint;
  }

  // Load claims and events from store
  let claims: SprintClaim[] = [];
  let recentEvents: SlopeEvent[] = [];
  try {
    const store = await resolveStore(cwd);
    claims = await store.list(sprintNumber);
    // Load events from recent sprints (current + previous window)
    const eventWindow = 5;
    for (let s = Math.max(1, sprintNumber - eventWindow); s <= sprintNumber; s++) {
      const sprintEvents = await store.getEventsBySprint(s);
      recentEvents.push(...sprintEvents);
    }
    store.close();
  } catch { /* skip — claims/events are optional */ }

  // Load roadmap (graceful degradation)
  let roadmap: RoadmapDefinition | undefined;
  const roadmapPath = config.roadmapPath;
  const resolvedRoadmapPath = join(cwd, roadmapPath);
  try {
    if (existsSync(resolvedRoadmapPath)) {
      const raw = JSON.parse(readFileSync(resolvedRoadmapPath, 'utf8'));
      const parsed = parseRoadmap(raw);
      // Fall back to permissive structural cast when parseRoadmap rejects due
      // to validation errors (numbering gaps, ticket-count budget, etc.) —
      // briefing should still surface strategic context when shape is right.
      roadmap = parsed.roadmap ?? castRoadmapStructure(raw) ?? undefined;
    }
  } catch { /* skip — roadmap is optional */ }

  const filter = (categories.length > 0 || keywords.length > 0)
    ? { categories: categories.length > 0 ? categories : undefined, keywords: keywords.length > 0 ? keywords : undefined }
    : undefined;

  const skillRegistry = loadSkillRegistry(join(cwd, config.skillsPath ?? DEFAULT_SKILLS_PATH));

  // Filter scorecards by player if requested
  const effectiveScorecards = playerFlag
    ? filterScorecardsByPlayer(scorecards, playerFlag)
    : scorecards;

  // Filter hazards by visibility
  const visibleIssues = filterHazardsByVisibility(commonIssues, {
    player: playerFlag,
    teamWide: !personalFlag,
  });

  // Compact mode: L0 briefing (~200 tokens)
  if (compactFlag) {
    const card = computeHandicapCard(effectiveScorecards);
    const hcp = card.all_time.handicap.toFixed(1);
    const fwy = card.all_time.fairway_pct.toFixed(0);
    const gir = card.all_time.gir_pct.toFixed(0);
    const hazardCount = visibleIssues.recurring_patterns.length;
    const topHazards = visibleIssues.recurring_patterns
      .sort((a, b) => Math.max(...b.sprints_hit) - Math.max(...a.sprints_hit))
      .slice(0, 3)
      .map(p => p.title)
      .join('; ');
    const claimList = claims.length > 0 ? claims.map(c => c.target).join(', ') : 'none';
    const ctx = roadmap ? formatStrategicContext(roadmap, sprintNumber) : '';
    const ctxLine = ctx ? `\n${ctx.split('\n')[0]}` : '';
    const skillBriefing = buildSkillBriefing({
      registry: skillRegistry,
      scorecards: effectiveScorecards,
      commonIssues: visibleIssues,
      filter,
      roadmap,
      currentSprint: sprintNumber,
      claims,
    });
    const skillSummary = skillBriefing.recommendations.map(r => r.id).slice(0, 3).join(', ');
    const openCodificationCandidates = collectOpenCodificationCandidates(loadFindings(cwd));

    console.log(`\nSLOPE BRIEFING (compact) — S${sprintNumber}`);
    console.log(`Handicap: ${hcp} | Fairways: ${fwy}% | GIR: ${gir}% | Scorecards: ${effectiveScorecards.length}`);
    console.log(`Hazards: ${hazardCount}${topHazards ? ` — top: ${topHazards}` : ''}`);
    if (openCodificationCandidates.length > 0) console.log(`Codification candidates: ${openCodificationCandidates.length} open`);
    if (skillSummary) console.log(`Skills: ${skillSummary}`);
    console.log(`Claims: ${claimList}${ctxLine}`);
    console.log(`\nRun \`slope briefing\` (without --compact) for full details.\n`);
    return;
  }

  const metaphor = resolveMetaphor(args, config.metaphor);
  const output = formatBriefing({ scorecards: effectiveScorecards, commonIssues: visibleIssues, lastSession, filter, includeTraining, claims, roadmap, currentSprint: sprintNumber, metaphor, role, recentEvents, skillRegistry });
  console.log('');
  console.log(output);

  if (roadmap) {
    const roadmapRealityLines = formatRoadmapRealitySection(buildRoadmapReality(cwd, roadmap));
    if (roadmapRealityLines.length > 0) {
      console.log('\u2500'.repeat(50));
      for (const line of roadmapRealityLines) console.log(line);
      console.log('');
    }
  }

  const worktreeRealityLines = formatWorktreeRealitySection(collectSiblingWorktreeReality(cwd));
  if (worktreeRealityLines.length > 0) {
    console.log('\u2500'.repeat(50));
    for (const line of worktreeRealityLines) console.log(line);
    console.log('');
  }

  // Deferred findings section (appended after main briefing)
  const deferred = loadDeferred(cwd);
  const deferredLines = formatDeferredForBriefing(deferred, sprintNumber);
  if (deferredLines.length > 0) {
    console.log('\u2500'.repeat(50));
    for (const line of deferredLines) {
      console.log(line);
    }
    console.log('');
  }

  const codificationLines = formatCodificationCandidatesForBriefing(loadFindings(cwd));
  if (codificationLines.length > 0) {
    console.log('\u2500'.repeat(50));
    for (const line of codificationLines) {
      console.log(line);
    }
    console.log('');
  }
}
