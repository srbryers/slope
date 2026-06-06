import { sprintCommand } from './sprint.js';

export async function resumeCommand(args: string[]): Promise<void> {
  await sprintCommand(['resume', '--portable', ...args]);
}
