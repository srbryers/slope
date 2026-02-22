import { computeHandicapCard, computeTeamHandicap } from '@slope-dev/core';
import type { MissDirection } from '@slope-dev/core';
import { loadConfig } from '../config.js';
import { loadScorecards } from '../loader.js';
import { resolveMetaphor } from '../metaphor.js';

function parseCardArgs(args: string[]): { swarm: boolean } {
  return { swarm: args.includes('--swarm') };
}

export function cardCommand(args: string[] = []): void {
  const config = loadConfig();
  const metaphor = resolveMetaphor(args, config.metaphor);
  const scorecards = loadScorecards(config);
  const flags = parseCardArgs(args);

  if (scorecards.length === 0) {
    console.log('\nNo scorecards found. Run `slope init` to create an example.\n');
    process.exit(0);
  }

  if (flags.swarm) {
    showTeamHandicap(scorecards);
    return;
  }

  const card = computeHandicapCard(scorecards);

  const pad = (s: string | number, w: number) => String(s).padStart(w);
  const pct = (n: number) => n.toFixed(1) + '%';

  const minSprint = config.minSprint;
  const cardTitle = metaphor ? `SLOPE ${metaphor.vocabulary.handicapCard.charAt(0).toUpperCase() + metaphor.vocabulary.handicapCard.slice(1)}` : 'SLOPE Handicap Card';
  console.log(`\n${cardTitle} (${scorecards.length} scorecard${scorecards.length === 1 ? '' : 's'}, Sprint ${minSprint}+)`);
  console.log('\u2501'.repeat(47));
  console.log('');
  console.log(`${'Stat'.padEnd(20)}${'Last 5'.padStart(9)}${'Last 10'.padStart(10)}${'All-time'.padStart(10)}`);
  console.log('\u2500'.repeat(49));

  const rows: [string, (w: typeof card.last_5) => string][] = [
    ['Handicap', w => `+${w.handicap.toFixed(1)}`],
    ['Fairways', w => pct(w.fairway_pct)],
    ['GIR', w => pct(w.gir_pct)],
    ['Avg putts/hole', w => w.avg_putts.toFixed(1)],
    ['Penalties/round', w => w.penalties_per_round.toFixed(1)],
    ['Mulligans', w => String(w.mulligans)],
    ['Gimmes', w => String(w.gimmes)],
  ];

  for (const [label, fn] of rows) {
    console.log(`${label.padEnd(20)}${pad(fn(card.last_5), 9)}${pad(fn(card.last_10), 10)}${pad(fn(card.all_time), 10)}`);
  }

  // Miss pattern summary
  const allMiss = card.all_time.miss_pattern;
  const totalMisses = allMiss.long + allMiss.short + allMiss.left + allMiss.right;

  console.log('');
  if (totalMisses === 0) {
    console.log('Miss Pattern: No misses recorded.');
  } else {
    const dirs = (['long', 'short', 'left', 'right'] as MissDirection[])
      .filter(d => allMiss[d] > 0)
      .map(d => `${d}: ${allMiss[d]}`)
      .join(', ');
    console.log(`Miss Pattern: ${dirs} (${totalMisses} total)`);
  }

  if (scorecards.length < 5) {
    console.log(`\nNote: Only ${scorecards.length} scorecard${scorecards.length === 1 ? '' : 's'} \u2014 windows fill at Sprint ${minSprint + 5 - scorecards.length}.`);
  }

  console.log('');
}

function showTeamHandicap(scorecards: import('@slope-dev/core').GolfScorecard[]): void {
  const team = computeTeamHandicap(scorecards);
  const pad = (s: string | number, w: number) => String(s).padStart(w);
  const pct = (n: number) => n.toFixed(1) + '%';

  const swarmCards = scorecards.filter(c => c.agents && c.agents.length > 0);
  if (swarmCards.length === 0) {
    console.log('\nNo swarm scorecards found. Use auto-card --swarm to generate multi-agent scorecards.\n');
    return;
  }

  console.log(`\nSLOPE Team Handicap Card (${swarmCards.length} swarm sprint${swarmCards.length === 1 ? '' : 's'})`);
  console.log('\u2501'.repeat(50));

  // Swarm efficiency
  const eff = team.swarm_efficiency;
  console.log('\n  Swarm Efficiency:');
  console.log(`    Agents: ${eff.total_agents} across ${eff.total_sprints} sprint${eff.total_sprints === 1 ? '' : 's'} (avg ${eff.avg_agents_per_sprint}/sprint)`);
  console.log(`    Score vs Par: ${eff.avg_score_vs_par >= 0 ? '+' : ''}${eff.avg_score_vs_par}`);
  console.log(`    Efficiency: ${eff.efficiency_ratio}%`);

  // Per-role breakdown
  if (team.by_role.length > 0) {
    console.log('\n  Per-Role Performance:');
    console.log(`${'    Role'.padEnd(20)}${'Sprints'.padStart(9)}${'Shots'.padStart(8)}${'Fairway%'.padStart(10)}${'GIR%'.padStart(8)}`);
    console.log('    ' + '\u2500'.repeat(35));

    for (const role of team.by_role) {
      console.log(
        `${'    ' + role.role}`.padEnd(20) +
        pad(role.sprints_participated, 9) +
        pad(role.total_shots, 8) +
        pad(pct(role.stats.fairway_pct), 10) +
        pad(pct(role.stats.gir_pct), 8),
      );
    }
  }

  // Role combinations
  if (team.role_combinations.length > 0) {
    console.log('\n  Role Combinations:');
    for (const combo of team.role_combinations) {
      const score = combo.avg_score_vs_par >= 0 ? `+${combo.avg_score_vs_par}` : `${combo.avg_score_vs_par}`;
      console.log(`    ${combo.roles.join(' + ')} — ${combo.sprint_count} sprint${combo.sprint_count === 1 ? '' : 's'}, avg ${score} vs par`);
    }
  }

  console.log('');
}
