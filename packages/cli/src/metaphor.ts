// CLI metaphor resolution
// Fallback chain: --metaphor flag → config.metaphor → 'golf' default

// Import named metaphors to ensure registration happens
import { getMetaphor, hasMetaphor, listMetaphors, loadPluginMetaphors, golf } from '@srbryers/core';
import type { MetaphorDefinition, PluginsConfig } from '@srbryers/core';

// Force registration side effect (golf import ensures all metaphors are registered
// since the barrel import triggers packages/core/src/metaphors/index.ts)
void golf;

/**
 * Resolve the active metaphor from CLI args and config.
 */
export function resolveMetaphor(args: string[], configMetaphor?: string, pluginsConfig?: PluginsConfig): MetaphorDefinition {
  // Load custom metaphor plugins
  const cwd = process.cwd();
  loadPluginMetaphors(cwd, pluginsConfig);

  // Check CLI flag first
  const flagArg = args.find(a => a.startsWith('--metaphor='));
  const flagValue = flagArg?.slice('--metaphor='.length);

  const id = flagValue || configMetaphor || 'golf';

  if (!hasMetaphor(id)) {
    const available = listMetaphors().map(m => m.id).join(', ');
    console.error(`Unknown metaphor "${id}". Available: ${available}`);
    process.exit(1);
  }

  return getMetaphor(id);
}
