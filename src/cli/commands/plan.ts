import {
  recommendClub,
  computeHandicapCard,
  computeDispersion,
  generateTrainingPlan,
  hazardBriefing,
  formatAdvisorReport,
} from '../../core/index.js';
import { loadConfig } from '../config.js';
import { loadScorecards } from '../loader.js';

export function planCommand(args: string[]): void {
  let complexity: string | undefined;
  const slopeFactors: string[] = [];
  const areas: string[] = [];

  for (const arg of args) {
    if (arg.startsWith('--complexity=')) {
      complexity = arg.slice('--complexity='.length);
    } else if (arg.startsWith('--slope-factors=')) {
      slopeFactors.push(...arg.slice('--slope-factors='.length).split(',').map(s => s.trim()).filter(Boolean));
    } else if (arg.startsWith('--areas=')) {
      areas.push(...arg.slice('--areas='.length).split(',').map(s => s.trim()).filter(Boolean));
    }
  }

  if (!complexity) {
    console.error('\nUsage: slope plan --complexity=<trivial|small|medium|large> [--slope-factors=a,b] [--areas=x,y]\n');
    process.exit(1);
    return;
  }

  const validComplexities = ['trivial', 'small', 'medium', 'large'];
  if (!validComplexities.includes(complexity)) {
    console.error(`\nInvalid complexity "${complexity}". Must be one of: ${validComplexities.join(', ')}\n`);
    process.exit(1);
    return;
  }

  const config = loadConfig();
  const scorecards = loadScorecards(config);

  // Club recommendation
  const clubRec = recommendClub({
    ticketComplexity: complexity as 'trivial' | 'small' | 'medium' | 'large',
    scorecards,
    slopeFactors,
  });

  // Training plan
  let trainingPlan: ReturnType<typeof generateTrainingPlan> = [];
  if (scorecards.length > 0) {
    const handicap = computeHandicapCard(scorecards);
    const dispersion = computeDispersion(scorecards);
    trainingPlan = generateTrainingPlan({ handicap, dispersion, recentScorecards: scorecards });
  }

  // Hazard warnings
  let hazardWarnings: string[] = [];
  if (areas.length > 0 && scorecards.length > 0) {
    hazardWarnings = hazardBriefing({ areas, scorecards });
  }

  const report = formatAdvisorReport({ clubRecommendation: clubRec, trainingPlan, hazardWarnings });
  console.log('');
  console.log(report);
}
