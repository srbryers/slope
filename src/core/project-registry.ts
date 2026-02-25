// SLOPE — Multi-Project Registry
// File-based project registry for managing multiple SLOPE projects.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { SlopeConfig } from './config.js';

/** Registry for managing multiple SLOPE project configurations */
export interface ProjectRegistry {
  getProject(projectId: string): Promise<SlopeConfig | null>;
  listProjects(): Promise<Array<{ id: string; name: string }>>;
  saveProject(projectId: string, config: SlopeConfig): Promise<void>;
  removeProject(projectId: string): Promise<boolean>;
}

interface ProjectsFile {
  projects: Record<string, SlopeConfig & { projectName?: string }>;
}

const PROJECTS_FILE = '.slope/projects.json';

/** File-based ProjectRegistry — stores all project configs in a single JSON file */
export class FileProjectRegistry implements ProjectRegistry {
  private filePath: string;

  constructor(cwd: string = process.cwd()) {
    this.filePath = join(cwd, PROJECTS_FILE);
  }

  private load(): ProjectsFile {
    if (!existsSync(this.filePath)) {
      return { projects: {} };
    }
    try {
      return JSON.parse(readFileSync(this.filePath, 'utf8')) as ProjectsFile;
    } catch {
      return { projects: {} };
    }
  }

  private save(data: ProjectsFile): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(this.filePath, JSON.stringify(data, null, 2) + '\n');
  }

  async getProject(projectId: string): Promise<SlopeConfig | null> {
    const data = this.load();
    return data.projects[projectId] ?? null;
  }

  async listProjects(): Promise<Array<{ id: string; name: string }>> {
    const data = this.load();
    return Object.entries(data.projects).map(([id, config]) => ({
      id,
      name: config.projectName ?? config.projectId ?? id,
    }));
  }

  async saveProject(projectId: string, config: SlopeConfig): Promise<void> {
    const data = this.load();
    data.projects[projectId] = config;
    this.save(data);
  }

  async removeProject(projectId: string): Promise<boolean> {
    const data = this.load();
    if (!(projectId in data.projects)) {
      return false;
    }
    delete data.projects[projectId];
    this.save(data);
    return true;
  }
}
