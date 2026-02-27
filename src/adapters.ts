// SLOPE Adapter Barrel — lightweight subpath export for `@slope-dev/slope/adapters`.
// Consumers can import adapter framework functions + types without pulling in the entire core.

// Side-effect imports: ensure all adapters are registered
import './core/adapters/claude-code.js';
import './core/adapters/cursor.js';
import './core/adapters/windsurf.js';
import './core/adapters/generic.js';

// Framework functions
export { registerAdapter, getAdapter, listAdapters, detectAdapter, clearAdapters, resolveToolMatcher, ADAPTER_PRIORITY, TOOL_CATEGORIES, CLAUDE_CODE_TOOLS } from './core/harness.js';

// Framework types
export type { HarnessAdapter, HarnessId, ToolCategory, ToolNameMap } from './core/harness.js';

// Adapter classes + singletons
export { ClaudeCodeAdapter, claudeCodeAdapter } from './core/adapters/claude-code.js';
export { CursorAdapter, cursorAdapter } from './core/adapters/cursor.js';
export { WindsurfAdapter, windsurfAdapter } from './core/adapters/windsurf.js';
export { GenericAdapter, genericAdapter } from './core/adapters/generic.js';

// Adapter-specific types (for consumers building harness integrations)
export type { GuardManifestEntry } from './core/adapters/generic.js';
