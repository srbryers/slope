// SLOPE — Roadmap Generator
// Generates a RoadmapDefinition from repo analysis, complexity, and merged backlog data.

import type { RepoProfile, VisionDocument } from '../analyzers/types.js';
import type { ComplexityProfile } from '../analyzers/complexity.js';
import type { MergedBacklog } from '../analyzers/backlog-merged.js';
import type { RoadmapDefinition, RoadmapSprint, RoadmapTicket, RoadmapClub, RoadmapPhase } from '../roadmap.js';
import type { GitHubIssue } from '../github.js';
import type { TodoEntry } from '../analyzers/backlog.js';

const ISSUE_REF_PATTERN = /(?:depends\s+on\s+#(\d+)|blocked\s+by\s+#(\d+)|requires\s+#(\d+)|after\s+#(\d+))/gi;

/**
 * Generate a roadmap from repo analysis data.
 *
 * Fallback chain:
 * 1. Milestones exist → each milestone = a phase, issues within = sprint tickets
 * 2. Labels but no milestones → group issues by label into sprints
 * 3. No remote data → fall back to local TODO clusters
 */
export function generateRoadmap(
  profile: RepoProfile,
  complexity: ComplexityProfile,
  backlog: MergedBacklog,
): RoadmapDefinition {
  const remote = backlog.remote;
  const hasMilestones = (remote?.milestones?.length ?? 0) > 0;
  const hasRemoteIssues = (remote?.issues?.length ?? 0) > 0;

  if (hasMilestones && hasRemoteIssues) {
    return fromMilestones(profile, complexity, backlog);
  }

  if (hasRemoteIssues) {
    return fromLabels(profile, complexity, backlog);
  }

  return fromLocalTodos(profile, complexity, backlog);
}

function fromMilestones(
  profile: RepoProfile,
  complexity: ComplexityProfile,
  backlog: MergedBacklog,
): RoadmapDefinition {
  const remote = backlog.remote!;
  const phases: RoadmapPhase[] = [];
  const sprints: RoadmapSprint[] = [];
  let sprintNum = 1;

  // Map issue numbers to sprint ticket keys for dependency resolution
  const issueToKey = new Map<number, string>();

  for (const ms of remote.milestones) {
    const msIssues = remote.issuesByMilestone[ms.title] ?? [];
    if (msIssues.length === 0) continue;

    const tickets = msIssues.map((issue, i) => {
      const key = `S${sprintNum}-${i + 1}`;
      issueToKey.set(issue.number, key);
      return issueToTicket(issue, key);
    });

    sprints.push({
      id: sprintNum,
      theme: ms.title,
      par: complexity.estimatedPar,
      slope: complexity.estimatedSlope,
      type: inferSprintType(msIssues),
      tickets,
    });

    phases.push({
      name: `Phase ${phases.length + 1} — ${ms.title}`,
      sprints: [sprintNum],
    });

    sprintNum++;
  }

  // Resolve dependencies now that all keys are mapped
  resolveDependencies(sprints, issueToKey, remote.issues);

  return {
    name: `${profile.stack.primaryLanguage} Project`,
    description: 'Auto-generated roadmap from GitHub milestones',
    phases,
    sprints,
  };
}

function fromLabels(
  profile: RepoProfile,
  complexity: ComplexityProfile,
  backlog: MergedBacklog,
): RoadmapDefinition {
  const remote = backlog.remote!;
  const sprints: RoadmapSprint[] = [];
  let sprintNum = 1;

  const issueToKey = new Map<number, string>();

  // Sort labels by issue count descending, take top groups
  const labelGroups = Object.entries(remote.issuesByLabel)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 5);

  const assignedIssues = new Set<number>();

  for (const [label, issues] of labelGroups) {
    // Deduplicate: skip issues already assigned to a sprint
    const unassigned = issues.filter(i => !assignedIssues.has(i.number));
    if (unassigned.length === 0) continue;

    const tickets = unassigned.map((issue, i) => {
      const key = `S${sprintNum}-${i + 1}`;
      issueToKey.set(issue.number, key);
      assignedIssues.add(issue.number);
      return issueToTicket(issue, key);
    });

    sprints.push({
      id: sprintNum,
      theme: `${label} work`,
      par: complexity.estimatedPar,
      slope: complexity.estimatedSlope,
      type: inferSprintType(unassigned),
      tickets,
    });

    sprintNum++;
  }

  resolveDependencies(sprints, issueToKey, remote.issues);

  const phases: RoadmapPhase[] = [{
    name: 'Phase 1 — Backlog',
    sprints: sprints.map(s => s.id),
  }];

  return {
    name: `${profile.stack.primaryLanguage} Project`,
    description: 'Auto-generated roadmap from GitHub issue labels',
    phases,
    sprints,
  };
}

function fromLocalTodos(
  profile: RepoProfile,
  complexity: ComplexityProfile,
  backlog: MergedBacklog,
): RoadmapDefinition {
  const sprints: RoadmapSprint[] = [];
  let sprintNum = 1;

  const modules = Object.entries(backlog.local.todosByModule)
    .sort(([, a], [, b]) => b.length - a.length)
    .slice(0, 4);

  if (modules.length > 0) {
    const tickets: RoadmapTicket[] = modules.map(([mod, todos], i) => ({
      key: `S${sprintNum}-${i + 1}`,
      title: `Address ${todos.length} TODO${todos.length > 1 ? 's' : ''} in ${mod}`,
      club: (todos.length > 3 ? 'short_iron' : 'wedge') as RoadmapClub,
      complexity: todos.length > 3 ? 'standard' as const : 'small' as const,
    }));

    sprints.push({
      id: sprintNum,
      theme: 'Local Backlog Cleanup',
      par: complexity.estimatedPar,
      slope: complexity.estimatedSlope,
      type: 'maintenance',
      tickets,
    });
  } else {
    // Fallback: generic starter
    sprints.push({
      id: sprintNum,
      theme: 'Getting Started',
      par: complexity.estimatedPar,
      slope: complexity.estimatedSlope,
      type: 'setup',
      tickets: [{
        key: `S${sprintNum}-1`,
        title: 'Set up project infrastructure',
        club: 'short_iron',
        complexity: 'standard',
      }],
    });
  }

  return {
    name: `${profile.stack.primaryLanguage} Project`,
    description: 'Auto-generated roadmap from local backlog',
    phases: [{ name: 'Phase 1 — Setup', sprints: [1] }],
    sprints,
  };
}

function issueToTicket(issue: GitHubIssue, key: string): RoadmapTicket {
  const labels = issue.labels.map(l => l.toLowerCase());
  let club: RoadmapClub = 'short_iron';
  let ticketComplexity: 'trivial' | 'small' | 'standard' | 'moderate' = 'standard';

  if (labels.some(l => l.includes('bug') || l.includes('fix'))) {
    club = 'wedge';
    ticketComplexity = 'small';
  } else if (labels.some(l => l.includes('feature') || l.includes('enhancement'))) {
    club = 'short_iron';
    ticketComplexity = 'standard';
  }

  // Large features: many labels or title hints
  if (labels.some(l => l.includes('epic') || l.includes('large'))) {
    club = 'long_iron';
    ticketComplexity = 'moderate';
  }

  return { key, title: issue.title, club, complexity: ticketComplexity };
}

function inferSprintType(issues: GitHubIssue[]): string {
  const labels = issues.flatMap(i => i.labels.map(l => l.toLowerCase()));
  const hasBugs = labels.some(l => l.includes('bug'));
  const hasFeatures = labels.some(l => l.includes('feature') || l.includes('enhancement'));

  if (hasBugs && hasFeatures) return 'mixed';
  if (hasBugs) return 'bugfix';
  if (hasFeatures) return 'feature';
  return 'general';
}

// ─── Priority Keyword Synonyms ───

const PRIORITY_SYNONYMS: Record<string, string[]> = {
  // Quality attributes (expanded)
  speed: ['performance', 'optimize', 'fast', 'latency', 'benchmark', 'perf', 'cache', 'cron', 'batch', 'async', 'concurrent', 'parallel', 'queue', 'index', 'throttle'],
  performance: ['speed', 'optimize', 'fast', 'latency', 'benchmark', 'perf', 'cache', 'cron', 'batch', 'async', 'concurrent', 'parallel', 'queue', 'index', 'throttle'],
  reliability: ['test', 'error', 'coverage', 'monitoring', 'resilient', 'stable', 'robust', 'retry', 'fallback', 'validate', 'check', 'hash', 'dedup', 'backup', 'recovery', 'logging', 'status'],
  security: ['auth', 'vulnerability', 'permission', 'encrypt', 'secure', 'access', 'token', 'jwt', 'oauth', 'credential', 'secret', 'cors', 'csrf', 'sanitize'],
  scalability: ['scale', 'distributed', 'horizontal', 'throughput', 'capacity', 'shard', 'partition', 'replicate', 'cluster', 'load-balance'],
  testing: ['test', 'coverage', 'spec', 'e2e', 'integration', 'unit', 'mock', 'fixture', 'assert', 'snapshot'],
  observability: ['monitoring', 'logging', 'tracing', 'metrics', 'alert', 'dashboard', 'health', 'uptime'],
  ux: ['ui', 'design', 'usability', 'accessibility', 'a11y', 'user experience', 'email', 'notification', 'subscriber', 'onboarding', 'welcome', 'template', 'layout', 'responsive', 'mobile', 'theme', 'deliver'],
  'developer experience': ['dx', 'cli', 'tooling', 'ergonomic', 'developer', 'devex', 'lint', 'format', 'config', 'scaffold'],
  dx: ['developer', 'cli', 'tooling', 'ergonomic', 'devex', 'developer experience', 'lint', 'format', 'config', 'scaffold'],
  documentation: ['docs', 'readme', 'guide', 'tutorial', 'api-docs', 'changelog', 'jsdoc', 'typedoc'],

  // Implementation domains
  api: ['endpoint', 'route', 'rest', 'graphql', 'webhook', 'fetch', 'request', 'response', 'middleware', 'handler', 'controller'],
  data: ['database', 'db', 'supabase', 'postgres', 'sqlite', 'mongo', 'redis', 'query', 'insert', 'migration', 'schema', 'model', 'orm', 'prisma', 'drizzle'],
  ai: ['summarize', 'summarization', 'claude', 'openai', 'gpt', 'llm', 'embedding', 'relevance', 'scoring', 'ml', 'inference', 'prompt', 'generate', 'classify'],
  delivery: ['email', 'notification', 'send', 'smtp', 'resend', 'mailgun', 'push', 'sms', 'alert', 'subscribe', 'newsletter', 'briefing'],
  ingestion: ['feed', 'rss', 'news', 'scrape', 'crawl', 'import', 'ingest', 'source', 'poll', 'newsapi'],
  pipeline: ['cron', 'processing', 'batch', 'queue', 'job', 'worker', 'scheduler', 'schedule', 'pipeline', 'workflow', 'step'],
  infra: ['deploy', 'ci', 'cd', 'docker', 'env', 'setup', 'install', 'build', 'vercel', 'aws', 'terraform', 'k8s'],
  payments: ['stripe', 'billing', 'subscription', 'invoice', 'checkout', 'payment', 'price', 'plan', 'charge'],
  auth: ['login', 'signup', 'register', 'session', 'token', 'oauth', 'sso', 'password', 'mfa', '2fa', 'clerk', 'nextauth'],
};

function matchesPriority(text: string, priority: string): boolean {
  const lower = text.toLowerCase();
  const priorityLower = priority.toLowerCase();
  if (lower.includes(priorityLower)) return true;
  const synonyms = PRIORITY_SYNONYMS[priorityLower] ?? [];
  if (synonyms.some(s => lower.includes(s))) return true;
  // Check if any path segments exactly match the priority or its synonyms
  // e.g., "src/lib/delivery/deliver.ts" → segments ["src", "lib", "delivery", "deliver"]
  const segments = lower.split(/[/\\.]/).filter(s => s.length > 2);
  if (segments.some(seg => seg === priorityLower || priorityLower === seg)) return true;
  return synonyms.some(syn => segments.some(seg => seg === syn));
}

/**
 * Generate a roadmap from a vision document + merged backlog.
 * Groups backlog items into sprints aligned with vision priorities.
 */
export function generateRoadmapFromVision(
  vision: VisionDocument,
  backlog: MergedBacklog,
  complexity?: ComplexityProfile,
): RoadmapDefinition {
  const par = complexity?.estimatedPar ?? 4;
  const slope = complexity?.estimatedSlope ?? 3;
  const phases: RoadmapPhase[] = [];
  const sprints: RoadmapSprint[] = [];
  let sprintNum = 1;

  const assignedIssueNumbers = new Set<number>();
  const assignedTodoKeys = new Set<string>();

  for (const priority of vision.priorities) {
    const matchedIssues: GitHubIssue[] = [];
    const matchedTodos: TodoEntry[] = [];

    if (backlog.remote) {
      for (const issue of backlog.remote.issues) {
        if (assignedIssueNumbers.has(issue.number)) continue;
        const searchText = [issue.title, ...issue.labels].join(' ');
        if (matchesPriority(searchText, priority)) {
          matchedIssues.push(issue);
          assignedIssueNumbers.add(issue.number);
        }
      }
    }

    for (const todo of backlog.local.todos) {
      const key = `${todo.file}:${todo.line}`;
      if (assignedTodoKeys.has(key)) continue;
      const searchText = `${todo.file} ${todo.text}`;
      if (matchesPriority(searchText, priority)) {
        matchedTodos.push(todo);
        assignedTodoKeys.add(key);
      }
    }

    const tickets: RoadmapTicket[] = [];

    for (const issue of matchedIssues) {
      tickets.push(issueToTicket(issue, `S${sprintNum}-${tickets.length + 1}`));
    }

    for (const todo of matchedTodos) {
      tickets.push({
        key: `S${sprintNum}-${tickets.length + 1}`,
        title: `${todo.type}: ${todo.text}`,
        club: 'wedge' as RoadmapClub,
        complexity: 'small',
      });
    }

    if (tickets.length === 0) {
      tickets.push({
        key: `S${sprintNum}-1`,
        title: `Investigate and plan ${priority} improvements`,
        club: 'short_iron' as RoadmapClub,
        complexity: 'standard',
      });
    }

    sprints.push({
      id: sprintNum,
      theme: priority,
      par,
      slope,
      type: 'feature',
      tickets,
    });

    phases.push({
      name: `Phase ${phases.length + 1} — ${priority.charAt(0).toUpperCase() + priority.slice(1)}`,
      sprints: [sprintNum],
    });

    sprintNum++;
  }

  const overflowTickets: RoadmapTicket[] = [];

  if (backlog.remote) {
    for (const issue of backlog.remote.issues) {
      if (assignedIssueNumbers.has(issue.number)) continue;
      overflowTickets.push(issueToTicket(issue, `S${sprintNum}-${overflowTickets.length + 1}`));
    }
  }

  for (const todo of backlog.local.todos) {
    const key = `${todo.file}:${todo.line}`;
    if (assignedTodoKeys.has(key)) continue;
    overflowTickets.push({
      key: `S${sprintNum}-${overflowTickets.length + 1}`,
      title: `${todo.type}: ${todo.text}`,
      club: 'wedge' as RoadmapClub,
      complexity: 'small',
    });
  }

  if (overflowTickets.length > 0) {
    sprints.push({
      id: sprintNum,
      theme: 'General',
      par,
      slope,
      type: 'general',
      tickets: overflowTickets,
    });
    phases.push({
      name: `Phase ${phases.length + 1} — General`,
      sprints: [sprintNum],
    });
  }

  return {
    name: vision.purpose,
    description: `Roadmap generated from vision priorities: ${vision.priorities.join(', ')}`,
    phases,
    sprints,
  };
}

function resolveDependencies(
  sprints: RoadmapSprint[],
  issueToKey: Map<number, string>,
  allIssues: GitHubIssue[],
): void {
  // Build a lookup from ticket key to sprint id for cross-sprint deps
  const keyToSprint = new Map<string, number>();
  for (const sprint of sprints) {
    for (const ticket of sprint.tickets) {
      keyToSprint.set(ticket.key, sprint.id);
    }
  }

  for (const issue of allIssues) {
    if (!issue.body) continue;
    const ticketKey = issueToKey.get(issue.number);
    if (!ticketKey) continue;

    const ticket = sprints
      .flatMap(s => s.tickets)
      .find(t => t.key === ticketKey);
    if (!ticket) continue;

    const thisSprint = keyToSprint.get(ticketKey)!;
    const deps: string[] = [];

    let match: RegExpExecArray | null;
    const pattern = new RegExp(ISSUE_REF_PATTERN.source, 'gi');
    while ((match = pattern.exec(issue.body)) !== null) {
      const refNum = parseInt(match[1] ?? match[2] ?? match[3] ?? match[4], 10);
      const depKey = issueToKey.get(refNum);
      if (depKey && depKey !== ticketKey) {
        const depSprint = keyToSprint.get(depKey);
        if (depSprint === thisSprint) {
          // Intra-sprint ticket dependency
          deps.push(depKey);
        } else if (depSprint !== undefined) {
          // Cross-sprint dependency — add at sprint level
          const sprint = sprints.find(s => s.id === thisSprint);
          if (sprint && !(sprint.depends_on ?? []).includes(depSprint)) {
            sprint.depends_on = [...(sprint.depends_on ?? []), depSprint];
          }
        }
      }
    }

    if (deps.length > 0) {
      ticket.depends_on = deps;
    }
  }
}
