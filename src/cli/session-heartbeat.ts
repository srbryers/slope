import { realpathSync } from 'node:fs';
import {
  currentGitBranch,
  resolveRepoSourceCwd,
  resolveRepoStateCwd,
} from '../core/index.js';
import type { SlopeSession, SlopeStore } from '../core/index.js';

type HeartbeatStore = Pick<
  SlopeStore,
  'getActiveSessions' | 'updateSession' | 'updateHeartbeat'
>;

export class SessionCheckoutMismatchError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly recordedCheckout: string,
    public readonly callerCheckout: string,
  ) {
    super(
      `Session "${sessionId}" belongs to ${recordedCheckout}, not ${callerCheckout}. ` +
      'Run heartbeat from the recorded checkout or start a new session.',
    );
    this.name = 'SessionCheckoutMismatchError';
  }
}

function sameCheckout(left: string, right: string): boolean {
  try {
    return realpathSync(left) === realpathSync(right);
  } catch {
    return left === right;
  }
}

/** Refresh liveness and checkout identity without changing the session's role. */
export async function reconcileSessionHeartbeat(
  store: HeartbeatStore,
  sessionId: string,
  cwd: string,
): Promise<SlopeSession | undefined> {
  const sessions = await store.getActiveSessions();
  const session = sessions.find(candidate => candidate.session_id === sessionId);
  const sourceCwd = resolveRepoSourceCwd(cwd);
  const stateCwd = resolveRepoStateCwd(cwd);

  if (
    session?.worktree_path &&
    !sameCheckout(session.worktree_path, sourceCwd)
  ) {
    throw new SessionCheckoutMismatchError(
      sessionId,
      session.worktree_path,
      sourceCwd,
    );
  }

  const branch = currentGitBranch(sourceCwd);
  const linkedCheckout = !sameCheckout(sourceCwd, stateCwd);
  const shouldScopeWorktree = linkedCheckout && !session?.worktree_path;

  if (branch || shouldScopeWorktree) {
    return store.updateSession(sessionId, {
      ...(branch ? { branch } : {}),
      ...(shouldScopeWorktree ? { worktree_path: sourceCwd } : {}),
    });
  }

  await store.updateHeartbeat(sessionId);
  return session;
}
