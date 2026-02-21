import { join } from 'node:path';
import type { SprintRegistry } from '@slope-dev/core';
import type { SlopeConfig } from '../config.js';
import { FileRegistry } from './file-registry.js';
import { ApiRegistry } from './api-registry.js';

export function createRegistry(config: SlopeConfig, cwd: string = process.cwd()): SprintRegistry {
  switch (config.registry) {
    case 'api': {
      if (!config.registryApiUrl) {
        throw new Error('registryApiUrl is required when registry is set to "api"');
      }
      return new ApiRegistry(config.registryApiUrl);
    }
    case 'file':
    default:
      return new FileRegistry(join(cwd, config.claimsPath));
  }
}

export { FileRegistry } from './file-registry.js';
export { ApiRegistry } from './api-registry.js';
