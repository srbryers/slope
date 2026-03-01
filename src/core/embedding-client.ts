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
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    throw new Error(`Embedding request failed (${response.status}): ${body}`);
  }

  const json = await response.json() as {
    data: Array<{ embedding: number[]; index: number }>;
  };

  // Sort by index to maintain input order
  const sorted = json.data.sort((a, b) => a.index - b.index);
  return sorted.map(d => new Float32Array(d.embedding));
}

/**
 * Embed code chunks in batches, returning full EmbeddingResults.
 */
export async function embedBatch(
  chunks: CodeChunk[],
  config: EmbeddingConfig,
  batchSize = 32,
): Promise<EmbeddingResult[]> {
  const results: EmbeddingResult[] = [];

  for (let i = 0; i < chunks.length; i += batchSize) {
    const batch = chunks.slice(i, i + batchSize);
    const texts = batch.map(c => c.content);
    const vectors = await embed(texts, config);

    for (let j = 0; j < batch.length; j++) {
      results.push({
        filePath: batch[j].filePath,
        chunkIndex: batch[j].chunkIndex,
        chunkText: batch[j].content,
        vector: vectors[j],
      });
    }
  }

  return results;
}
