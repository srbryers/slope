import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { SprintClaim, SprintRegistry } from '@slope-dev/core';

interface ClaimsFile {
  claims: SprintClaim[];
}

/** @deprecated Use `SlopeStore` via `resolveStore()` instead. Will be removed in v1.1. */
export class FileRegistry implements SprintRegistry {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async claim(input: Omit<SprintClaim, 'id' | 'claimed_at'>): Promise<SprintClaim> {
    const claims = this.readClaims();
    const claim: SprintClaim = {
      ...input,
      id: `claim-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      claimed_at: new Date().toISOString(),
    };
    claims.push(claim);
    this.writeClaims(claims);
    return claim;
  }

  async release(id: string): Promise<boolean> {
    const claims = this.readClaims();
    const idx = claims.findIndex(c => c.id === id);
    if (idx === -1) return false;
    claims.splice(idx, 1);
    this.writeClaims(claims);
    return true;
  }

  async list(sprintNumber: number): Promise<SprintClaim[]> {
    return this.readClaims().filter(c => c.sprint_number === sprintNumber);
  }

  async get(id: string): Promise<SprintClaim | undefined> {
    return this.readClaims().find(c => c.id === id);
  }

  private readClaims(): SprintClaim[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const data: ClaimsFile = JSON.parse(readFileSync(this.filePath, 'utf8'));
      return Array.isArray(data.claims) ? data.claims : [];
    } catch {
      return [];
    }
  }

  private writeClaims(claims: SprintClaim[]): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    const data: ClaimsFile = { claims };
    writeFileSync(this.filePath, JSON.stringify(data, null, 2) + '\n');
  }
}
