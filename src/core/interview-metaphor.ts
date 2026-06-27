import { hasMetaphor } from './metaphor.js';

export const CUSTOM_METAPHOR_SENTINEL = 'custom';
export const CUSTOM_METAPHOR_SENTINEL_ERROR =
  '"custom" is a creation placeholder, not a valid saved metaphor. Register a custom metaphor plugin first, then choose its generated id.';

export function validateInterviewMetaphorId(id: string): string | null {
  const metaphor = id.trim();
  if (!metaphor) return null;
  if (metaphor === CUSTOM_METAPHOR_SENTINEL) {
    return CUSTOM_METAPHOR_SENTINEL_ERROR;
  }
  if (!hasMetaphor(metaphor)) {
    return `Unknown metaphor "${metaphor}". Use listMetaphors() to see available options.`;
  }
  return null;
}

export function shouldPersistInterviewMetaphor(id: string): boolean {
  const metaphor = id.trim();
  return metaphor.length > 0 && metaphor !== CUSTOM_METAPHOR_SENTINEL;
}
