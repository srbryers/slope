import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Club, LoopConfig, ModelConfig, BacklogSprint } from './types.js';

const COST_ADJUSTED_SCORE_MIN_SAMPLES = 3;
const EPSILON = 0.01;

/**
 * Multi-factor model routing:
 *  1. Token-based: est_tokens > 24000 → API
 *  2. File-based: max_files >= 2 → API
 *  3. Strategy-based: documentation → API (local models can't reliably edit prose)
 *  4. Data-driven: check model-config.json cost_adjusted_scores per club
 *  5. Club defaults: putter/wedge/short_iron → local, long_iron/driver → API
 */
export function selectModel(
  club: Club,
  maxFiles: number,
  estTokens: number,
  config: LoopConfig,
  cwd: string,
  strategy?: BacklogSprint['strategy'],
): string {
  // 1. Token-based escalation: won't fit in Qwen 32K context
  if (estTokens > 24000) return config.modelApi;

  // 2. Multi-file routing: 2+ files → API
  if (maxFiles >= 2) return config.modelApi;

  // 3. Strategy-based: documentation and roadmap tickets need API model
  //    (local models struggle with prose; roadmap tickets are curated features)
  if (strategy === 'documentation' || strategy === 'roadmap') return config.modelApi;

  // 4. Data-driven: use cost-adjusted scores when both models have enough samples
  const modelConfig = loadModelConfig(cwd);
  if (modelConfig) {
    const choice = selectModelByCostAdjustedScore(club, modelConfig, config);
    if (choice) return choice;
  }

  // 5. Club defaults
  switch (club) {
    case 'putter':
    case 'wedge':
    case 'short_iron':
      return config.modelLocal;
    case 'long_iron':
    case 'driver':
      return config.modelApi;
    default:
      return config.modelLocal;
  }
}

/**
 * Compare cost-adjusted scores for local vs API model.
 * Returns the better model if both have sufficient samples, otherwise null.
 * cost_adjusted_score = success_rate / (cost_per_success + epsilon)
 */
function selectModelByCostAdjustedScore(
  club: Club,
  modelConfig: ModelConfig,
  config: LoopConfig,
): string | null {
  const localKey = `${club}:${config.modelLocal}`;
  const apiKey = `${club}:${config.modelApi}`;

  const localScore = modelConfig.cost_adjusted_scores?.[localKey];
  const apiScore = modelConfig.cost_adjusted_scores?.[apiKey];

  // Need both scores to compare
  if (localScore === undefined || apiScore === undefined) {
    // Fall back to recommendations if cost-adjusted scores unavailable
    const rec = modelConfig.recommendations[club];
    if (rec?.model === 'api') return config.modelApi;
    if (rec?.model === 'local') return config.modelLocal;
    return null;
  }

  // Check if both have sufficient samples (min 3)
  const localStats = modelConfig.success_rates[localKey];
  const apiStats = modelConfig.success_rates[apiKey];

  const localHasEnough = localStats && localStats.total >= COST_ADJUSTED_SCORE_MIN_SAMPLES;
  const apiHasEnough = apiStats && apiStats.total >= COST_ADJUSTED_SCORE_MIN_SAMPLES;

  // Both need sufficient data for cost-adjusted comparison
  if (!localHasEnough || !apiHasEnough) {
    return null;
  }

  // Prefer model with higher cost-adjusted score
  if (apiScore > localScore) {
    return config.modelApi;
  } else if (localScore > apiScore) {
    return config.modelLocal;
  }

  // Tie: prefer local (cheaper)
  return config.modelLocal;
}

/** Select timeout based on the resolved model */
export function selectTimeout(model: string, config: LoopConfig): number {
  return isLocalModel(model) ? config.modelLocalTimeout : config.modelApiTimeout;
}

/** Check if a model string refers to a local (ollama) model */
export function isLocalModel(model: string): boolean {
  return model.includes('ollama');
}

/** Load model-config.json if it exists */
function loadModelConfig(cwd: string): ModelConfig | null {
  const configPath = join(cwd, 'slope-loop/model-config.json');
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, 'utf8')) as ModelConfig;
  } catch {
    return null;
  }
}
