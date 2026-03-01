// SLOPE — EmbeddingStore Interface
// Separate from SlopeStore — uses type guard for runtime detection.

export interface EmbeddingEntry {
  filePath: string;
  chunkIndex: number;
  chunkText: string;
  gitSha: string;
  model: string;
  vector: Float32Array;
}

export interface EmbeddingSearchResult {
  id: number;
  filePath: string;
  chunkIndex: number;
  chunkText: string;
  score: number; // 0-1 similarity, 1 = exact match
}

export interface EmbeddingStats {
  fileCount: number;
  chunkCount: number;
  model: string | null;
  dimensions: number | null;
  lastIndexedAt: string | null;
  lastIndexedSha: string | null;
}

export interface IndexMeta {
  sha: string;
  model: string;
  dimensions: number;
}

export interface EmbeddingStore {
  saveEmbeddings(entries: EmbeddingEntry[]): Promise<void>;

  searchEmbeddings(queryVector: Float32Array, limit?: number): Promise<EmbeddingSearchResult[]>;

  getIndexedFiles(): Promise<Array<{ filePath: string; gitSha: string; model: string }>>;
  deleteEmbeddingsByFile(filePath: string): Promise<void>;

  getEmbeddingStats(): Promise<EmbeddingStats>;
  setIndexMeta(sha: string, model: string, dimensions: number): Promise<void>;
  getIndexMeta(): Promise<IndexMeta | null>;
}

/** Runtime type guard — check if a store supports embedding operations. */
export function hasEmbeddingSupport(store: unknown): store is EmbeddingStore {
  return store !== null && typeof store === 'object' && 'searchEmbeddings' in (store as object);
}
