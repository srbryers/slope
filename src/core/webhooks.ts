// SLOPE — CI Webhook Integration
// Parse GitHub webhook payloads into SLOPE events and CI signals.

import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseTestOutput } from './ci-signals.js';
import type { SlopeEvent, CISignal } from './types.js';

export interface WebhookResult {
  /** Ready for store.insertEvent() — null if event not relevant */
  event: Omit<SlopeEvent, 'id' | 'timestamp'> | null;
  /** Parsed CI signal from test output — null if not found */
  ciSignal: CISignal | null;
  /** What happened in the webhook */
  action: string;
}

/**
 * Validate a GitHub webhook signature using HMAC-SHA256.
 * Uses crypto.timingSafeEqual to prevent timing attacks.
 */
export function validateGitHubWebhookSignature(
  payload: string,
  signatureHeader: string,
  secret: string,
): boolean {
  const parts = signatureHeader.split('=');
  if (parts.length !== 2 || parts[0] !== 'sha256') return false;
  const hash = parts[1];
  if (!hash) return false;

  const computed = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

  // Both sides must be the same length for timingSafeEqual
  if (computed.length !== hash.length) return false;

  return timingSafeEqual(
    Buffer.from(computed, 'utf8'),
    Buffer.from(hash, 'utf8'),
  );
}

/**
 * Handle a GitHub check_run webhook payload.
 * Extracts CI signals from check_run.output.text when available.
 */
export function handleCheckRunWebhook(
  payload: unknown,
  opts?: { sprintNumber?: number; sessionId?: string },
): WebhookResult {
  const data = payload as Record<string, unknown>;
  const action = (data.action as string) ?? 'unknown';
  const checkRun = data.check_run as Record<string, unknown> | undefined;

  if (!checkRun) {
    return { event: null, ciSignal: null, action: `check_run.${action}` };
  }

  const name = (checkRun.name as string) ?? 'unknown';
  const status = (checkRun.status as string) ?? 'unknown';
  const conclusion = (checkRun.conclusion as string) ?? null;

  // Only process completed check runs
  if (action !== 'completed') {
    return { event: null, ciSignal: null, action: `check_run.${action}` };
  }

  // Try to parse CI signals from output text
  let ciSignal: CISignal | null = null;
  const output = checkRun.output as Record<string, unknown> | undefined;
  const outputText = output?.text as string | undefined;
  if (outputText) {
    ciSignal = parseTestOutput(outputText);
    // Only keep signal if it parsed something meaningful
    if (ciSignal.test_total === 0 && ciSignal.suites_total === 0) {
      ciSignal = null;
    }
  }

  const eventData: Record<string, unknown> = {
    source: 'github_webhook',
    webhook_event: 'check_run',
    check_name: name,
    status,
    conclusion,
  };
  if (ciSignal) {
    eventData.ci_signal = ciSignal;
  }

  const event: Omit<SlopeEvent, 'id' | 'timestamp'> = {
    type: conclusion === 'failure' ? 'failure' : 'decision',
    data: eventData,
    session_id: opts?.sessionId,
    sprint_number: opts?.sprintNumber,
  };

  return {
    event,
    ciSignal,
    action: `check_run.${action}.${conclusion ?? status}`,
  };
}

/**
 * Handle a GitHub workflow_run webhook payload.
 * Maps workflow conclusions to SLOPE event types.
 */
export function handleWorkflowRunWebhook(
  payload: unknown,
  opts?: { sprintNumber?: number; sessionId?: string },
): WebhookResult {
  const data = payload as Record<string, unknown>;
  const action = (data.action as string) ?? 'unknown';
  const workflowRun = data.workflow_run as Record<string, unknown> | undefined;

  if (!workflowRun) {
    return { event: null, ciSignal: null, action: `workflow_run.${action}` };
  }

  const name = (workflowRun.name as string) ?? 'unknown';
  const status = (workflowRun.status as string) ?? 'unknown';
  const conclusion = (workflowRun.conclusion as string) ?? null;
  const branch = (workflowRun.head_branch as string) ?? undefined;
  const runNumber = (workflowRun.run_number as number) ?? undefined;

  // Only process completed workflow runs
  if (action !== 'completed') {
    return { event: null, ciSignal: null, action: `workflow_run.${action}` };
  }

  const eventData: Record<string, unknown> = {
    source: 'github_webhook',
    webhook_event: 'workflow_run',
    workflow_name: name,
    status,
    conclusion,
    branch,
    run_number: runNumber,
  };

  const event: Omit<SlopeEvent, 'id' | 'timestamp'> = {
    type: conclusion === 'failure' ? 'failure' : 'decision',
    data: eventData,
    session_id: opts?.sessionId,
    sprint_number: opts?.sprintNumber,
  };

  return {
    event,
    ciSignal: null,  // workflow_run doesn't include test output directly
    action: `workflow_run.${action}.${conclusion ?? status}`,
  };
}
