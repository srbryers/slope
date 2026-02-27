// SLOPE — Sprint Lifecycle & Operational Performance Engine
// Single package barrel export

// Tokens (design tokens: colors, spacing, typography)
export * from './tokens/index.js';

// Core (scoring engine, types, advisor, formatter, etc.)
export * from './core/index.js';

// Store (SQLite adapter)
export { SqliteSlopeStore, createStore } from './store/index.js';

// CLI Command Registry
export { CLI_COMMAND_REGISTRY, CLI_INTERNAL_MODULES } from './cli/registry.js';
export type { CliCommandMeta } from './cli/registry.js';
