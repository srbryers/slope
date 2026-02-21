import type { SprintClaim, SprintRegistry } from '@slope-dev/core';

export class ApiRegistry implements SprintRegistry {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async claim(input: Omit<SprintClaim, 'id' | 'claimed_at'>): Promise<SprintClaim> {
    const res = await fetch(`${this.baseUrl}/claims`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json() as Promise<SprintClaim>;
  }

  async release(id: string): Promise<boolean> {
    const res = await fetch(`${this.baseUrl}/claims/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return true;
  }

  async list(sprintNumber: number): Promise<SprintClaim[]> {
    const res = await fetch(`${this.baseUrl}/claims?sprint=${sprintNumber}`);
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json() as Promise<SprintClaim[]>;
  }

  async get(id: string): Promise<SprintClaim | undefined> {
    const res = await fetch(`${this.baseUrl}/claims/${encodeURIComponent(id)}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
    return res.json() as Promise<SprintClaim>;
  }
}
