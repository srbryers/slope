// SLOPE — Metaphor Preview Generator
// Generates preview data for metaphor selection during init.

import type { MetaphorDefinition } from './metaphor.js';
import { listMetaphors } from './metaphor.js';

export interface MetaphorPreview {
  id: string;
  name: string;
  tagline: string;
  vocabulary: {
    sprint: string;
    ticket: string;
    scorecard: string;
    perfectScore: string;
    onTarget: string;
    review: string;
  };
  sampleTerms: Array<{ category: string; key: string; term: string }>;
  sampleOutput: string;
}

const TAGLINES: Record<string, string> = {
  golf: 'Fairways, birdies, and the 19th hole',
  tennis: 'Aces, sets, and match point',
  baseball: 'Home runs, innings, and the seventh-inning stretch',
  gaming: 'Boss fights, XP, and S-rank scores',
  dnd: 'Crits, loot drops, and natural 20s',
  matrix: 'Red pills, anomalies, and jacking in',
  agile: 'Stories, ceremonies, and retrospectives',
};

/**
 * Build a preview for a single metaphor definition.
 * Uses defensive fallbacks for custom metaphors with missing optional terms.
 */
export function buildMetaphorPreview(metaphor: MetaphorDefinition): MetaphorPreview {
  const vocab = metaphor.vocabulary;

  // Pick 5-6 highlight terms across categories
  const sampleTerms: MetaphorPreview['sampleTerms'] = [
    { category: 'clubs', key: 'driver', term: metaphor.clubs.driver ?? 'driver' },
    { category: 'clubs', key: 'short_iron', term: metaphor.clubs.short_iron ?? 'short_iron' },
    { category: 'scoreLabels', key: 'eagle', term: metaphor.scoreLabels.eagle ?? 'eagle' },
    { category: 'scoreLabels', key: 'par', term: metaphor.scoreLabels.par ?? 'par' },
    { category: 'hazards', key: 'bunker', term: metaphor.hazards.bunker ?? 'bunker' },
    { category: 'hazards', key: 'water', term: metaphor.hazards.water ?? 'water' },
  ];

  // Generate sample scorecard header output
  const sprintTerm = vocab.sprint ?? 'sprint';
  const scorecardTerm = vocab.scorecard ?? 'scorecard';
  const perfectTerm = vocab.perfectScore ?? 'perfect';
  const onTargetTerm = vocab.onTarget ?? 'on target';
  const ticketTerm = vocab.ticket ?? 'ticket';
  const driverTerm = metaphor.clubs.driver ?? 'driver';
  const shortIronTerm = metaphor.clubs.short_iron ?? 'short_iron';
  const eagleTerm = metaphor.scoreLabels.eagle ?? 'eagle';

  const sampleOutput = [
    `${capitalize(sprintTerm)} 7 ${capitalize(scorecardTerm)} — ${metaphor.name}`,
    `${capitalize(ticketTerm)} Count: 4 | ${driverTerm}: 1, ${shortIronTerm}: 2, ${metaphor.clubs.wedge ?? 'wedge'}: 1`,
    `Score: ${eagleTerm} — 2 under ${onTargetTerm}`,
    `Best: ${perfectTerm}`,
  ].join('\n');

  return {
    id: metaphor.id,
    name: metaphor.name,
    tagline: TAGLINES[metaphor.id] ?? `${metaphor.name} — ${metaphor.description}`,
    vocabulary: {
      sprint: vocab.sprint ?? 'sprint',
      ticket: vocab.ticket ?? 'ticket',
      scorecard: vocab.scorecard ?? 'scorecard',
      perfectScore: vocab.perfectScore ?? 'perfect',
      onTarget: vocab.onTarget ?? 'on target',
      review: vocab.review ?? 'review',
    },
    sampleTerms,
    sampleOutput,
  };
}

/**
 * Build previews for all registered metaphors.
 */
export function buildAllPreviews(): MetaphorPreview[] {
  return listMetaphors().map(buildMetaphorPreview);
}

/**
 * Format a preview as plain text for CLI display and agent consumption.
 */
export function formatPreviewText(preview: MetaphorPreview): string {
  const lines: string[] = [];
  lines.push(preview.tagline);
  lines.push('');
  lines.push('Vocabulary:');
  lines.push(`  Sprint = ${preview.vocabulary.sprint}`);
  lines.push(`  Ticket = ${preview.vocabulary.ticket}`);
  lines.push(`  Scorecard = ${preview.vocabulary.scorecard}`);
  lines.push(`  Perfect = ${preview.vocabulary.perfectScore}`);
  lines.push(`  On Target = ${preview.vocabulary.onTarget}`);
  lines.push(`  Review = ${preview.vocabulary.review}`);
  lines.push('');
  lines.push('Sample terms:');
  for (const t of preview.sampleTerms) {
    lines.push(`  ${t.key} = ${t.term}`);
  }
  lines.push('');
  lines.push('Sample output:');
  for (const line of preview.sampleOutput.split('\n')) {
    lines.push(`  ${line}`);
  }
  return lines.join('\n');
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
