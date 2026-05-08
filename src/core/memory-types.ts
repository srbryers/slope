// Memory types extracted into a sibling so memory.ts and memory-backend.ts
// can both import without a circular dependency.

export type MemoryCategory = 'workflow' | 'style' | 'project' | 'hazard' | 'other';
export type MemorySource = 'manual' | 'auto-guard' | 'auto-workflow';

export interface Memory {
  id: string;
  text: string;
  category: MemoryCategory;
  weight: number; // 1–10 relevance
  source: MemorySource;
  createdAt: string;
  updatedAt: string;
  /** Optional session that produced this memory (auto-* sources). */
  sourceSessionId?: string;
}

export interface MemoriesFile {
  version: number;
  memories: Memory[];
}

export interface MemorySearchOptions {
  query?: string;
  category?: MemoryCategory;
  source?: MemorySource;
  limit?: number;
  minWeight?: number;
}
