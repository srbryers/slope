import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Club, LoopConfig, ModelConfig, BacklogSprint } from './types.js';

/**
 * Multi-factor model routing:
 *  1. Token-based: est_tokens > 24000 → API
 *  2. File-based: max_files >= 2 → API
 *  3. Strategy-based: documentation → API (local models can't reliably edit prose)
 *  4. Data-driven: check model-config.json recommendations
 *     4a. club+sprintType → most specific
 *     4b. club+strategy → medium specificity
 *     4c. club-only → least specific
 *  5. Club defaults: putter/wedge/short_iron → local, long_iron/driver → API
 */
export function selectModel(
  club: Club,
  maxFiles: number,
  estTokens: number,
  config: LoopConfig,
  cwd: string,
  strategy?: BacklogSprint['strategy'],
  sprintType?: BacklogSprint['type'],
): string {
  // 1. Token-based escalation: won't fit in Qwen 32K context
  if (estTokens > 24000) return config.modelApi;

  // 2. Multi-file routing: 2+ files → API
  if (maxFiles >= 2) return config.modelApi;

  // 3. Strategy-based: documentation and roadmap tickets need API model
  //    (local models struggle with prose; roadmap tickets are curated features)
  if (strategy === 'documentation' || strategy === 'roadmap') return config.modelApi;

  // 4. Data-driven overrides from model-config.json
  const modelConfig = loadModelConfig(cwd);
  if (modelConfig) {
    // 4a. Most specific: club + sprint type
    if (sprintType && modelConfig.recommendations_by_type) {
      const rec = modelConfig.recommendations_by_type[`${club}:${sprintType}`];
      if (rec) return rec.model === 'api' ? config.modelApi : config.modelLocal;
    }

    // 4b. Medium: club + strategy
    if (strategy && modelConfig.recommendations_by_strategy) {
      const rec = modelConfig.recommendations_by_strategy[`${club}:${strategy}`];
      if (rec) return rec.model === 'api' ? config.modelApi : config.modelLocal;
    }

    // 4c. Least specific: club-only
    const rec = modelConfig.recommendations[club];
    if (rec?.model === 'api') return config.modelApi;
    if (rec?.model === 'local') return config.modelLocal;
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
