// SLOPE — HTTP Client for OpenAI-Compatible Embedding Endpoints

import type { EmbeddingConfig, CodeChunk, EmbeddingResult } from './embedding.js';

/**
 * Resolve apiKey — supports `env:VAR_NAME` syntax for environment variable resolution.
 */
function resolveApiKey(key: string | null | undefined): string | undefined {
  if (!key) return undefined;
  if (key.startsWith('env:')) {
    const envVar = key.slice(4);
    return process.env[envVar] || undefined;
  }
  return key;
}

/**
 * Embed an array of texts using an OpenAI-compatible embedding endpoint.
 */
export async function embed(
  texts: string[],
  config: EmbeddingConfig,
): Promise<Float32Array[]> {
  if (texts.length === 0) return [];

  const apiKey = resolveApiKey(config.apiKey);
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }

  const response = await fetch(config.endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: config.model,
      input: texts,
    }),
    signal: AbortSignal.timeout(60_000), // 60s timeout per batch
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Embedding request failed (${response.status}): ${body}`);
  }

  const json = await response.json() as {
    data?: Array<{ embedding: number[]; index: number }>;
  };

  if (!json.data || !Array.isArray(json.data)) {
    throw new Error('Unexpected embedding response shape: missing data array');
  }

  // Sort by index to maintain input order
  const sorted = json.data.sort((a, b) => a.index - b.index);
  return sorted.map(d => new Float32Array(d.embedding));
}

// Safety net: truncate chunks that exceed embedding model context.
// nomic-embed-text has 8192 token context; dense content can tokenize
// at ~2 chars/token, so 8000 chars is a safe per-chunk ceiling.
const MAX_EMBED_CHARS = 8000;

/**
 * Embed code chunks in batches, returning full EmbeddingResults.
 * Truncates oversized chunks and retries failed batches individually.
 */
export async function embedBatch(
  chunks: CodeChunk[],
  config: EmbeddingConfig,
  batchSize = 32,
): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map(c =>
      c.content.length > MAX_EMBED_CHARS ? c.content.slice(0, MAX_EMBED_CHARS) : c.content,
    );

    try {
      const vectors = await embed(texts, config);
      for (let j = 0; j < batch.length; j++) {
        results.push({
          filePath: batch[j].filePath,
          chunkIndex: batch[j].chunkIndex,
          chunkText: batch[j].content,
          vector: vectors[j],
        });
      }
    } catch {
      // Batch failed — retry each chunk individually, skip failures
      for (let j = 0; j < batch.length; j++) {
        try {
          const [vector] = await embed([texts[j]], config);
          results.push({
            filePath: batch[j].filePath,
            chunkIndex: batch[j].chunkIndex,
            chunkText: batch[j].content,
            vector,
          });
        } catch {
          // Skip this chunk — content exceeds model context
        }
      }
    }
  }

  return results;
}
