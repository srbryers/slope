import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { sprintIdKey, sprintIdsEqual } from '../../core/index.js';
import type { SprintClaim, SprintClaimInput, SprintIdInput, SprintRegistry } from '../../core/index.js';

interface ClaimsFile {
  claims: SprintClaim[];
}

/** @deprecated Use `SlopeStore` via `resolveStore()` instead. Will be removed in v1.1. */
export class FileRegistry implements SprintRegistry {
  private filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  async claim(input: SprintClaimInput): Promise<SprintClaim> {
    const claims = this.readClaims();
    const sprint = sprintIdKey(input.sprint_number);
    if (sprint === null) throw new TypeError(`Invalid sprint id: ${String(input.sprint_number)}`);
    const claim: SprintClaim = {
      ...input,
      sprint_number: sprint,
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

  async list(sprintNumber: SprintIdInput): Promise<SprintClaim[]> {
    return this.readClaims().filter(c => sprintIdsEqual(c.sprint_number, sprintNumber));
  }

  async get(id: string): Promise<SprintClaim | undefined> {
    return this.readClaims().find(c => c.id === id);
  }

  private readClaims(): SprintClaim[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const data: ClaimsFile = JSON.parse(readFileSync(this.filePath, 'utf8'));
      if (!Array.isArray(data.claims)) return [];
      return data.claims.flatMap((claim) => {
        const sprint = sprintIdKey(claim.sprint_number);
        return sprint === null ? [] : [{ ...claim, sprint_number: sprint }];
      });
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
