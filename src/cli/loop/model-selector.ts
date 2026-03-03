import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Club, LoopConfig, ModelConfig } from './types.js';

/**
 * Multi-factor model routing matching run.sh logic exactly:
 *  1. Token-based: est_tokens > 24000 → API
 *  2. File-based: max_files >= 2 → API
 *  3. Data-driven: check model-config.json recommendations per club
 *  4. Club defaults: putter/wedge/short_iron → local, long_iron/driver → API
 */
export function selectModel(
  club: Club,
  maxFiles: number,
  estTokens: number,
  config: LoopConfig,
  cwd: string,
): string {
  // 1. Token-based escalation: won't fit in Qwen 32K context
  if (estTokens > 24000) return config.modelApi;

  // 2. Multi-file routing: 2+ files → API
  if (maxFiles >= 2) return config.modelApi;

  // 3. Data-driven overrides from model-config.json
  const modelConfig = loadModelConfig(cwd);
  if (modelConfig) {
    const rec = modelConfig.recommendations[club];
    if (rec?.model === 'api') return config.modelApi;
    if (rec?.model === 'local') return config.modelLocal;
  }

  // 4. Club defaults
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

/** Select timeout based on club complexity */
export function selectTimeout(club: Club, config: LoopConfig): number {
  switch (club) {
    case 'long_iron':
    case 'driver':
      return config.modelApiTimeout;
    default:
      return config.modelLocalTimeout;
  }
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
