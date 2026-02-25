import { describe, it, expect } from 'vitest';
import {
  validateGitHubWebhookSignature,
  handleCheckRunWebhook,
  handleWorkflowRunWebhook,
} from '../../src/core/webhooks.js';
import { createHmac } from 'node:crypto';

describe('validateGitHubWebhookSignature', () => {
  const secret = 'test-secret-123';

  function sign(payload: string): string {
    const hash = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    return `sha256=${hash}`;
  }

  it('validates a correct signature', () => {
    const payload = '{"action":"completed"}';
    const signature = sign(payload);
    expect(validateGitHubWebhookSignature(payload, signature, secret)).toBe(true);
  });

  it('rejects an incorrect signature', () => {
    const payload = '{"action":"completed"}';
    expect(validateGitHubWebhookSignature(payload, 'sha256=badbadbad', secret)).toBe(false);
  });

  it('rejects signature with wrong prefix', () => {
    const payload = '{"action":"completed"}';
    const hash = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');
    expect(validateGitHubWebhookSignature(payload, `sha1=${hash}`, secret)).toBe(false);
  });

  it('rejects empty signature', () => {
    expect(validateGitHubWebhookSignature('{}', '', secret)).toBe(false);
  });

  it('rejects signature without equals sign', () => {
    expect(validateGitHubWebhookSignature('{}', 'sha256', secret)).toBe(false);
  });

  it('validates with different payloads', () => {
    const p1 = '{"a":1}';
    const p2 = '{"a":2}';
    const sig1 = sign(p1);

    expect(validateGitHubWebhookSignature(p1, sig1, secret)).toBe(true);
    expect(validateGitHubWebhookSignature(p2, sig1, secret)).toBe(false);
  });

  it('rejects signature with different length hash', () => {
    expect(validateGitHubWebhookSignature('{}', 'sha256=abc', secret)).toBe(false);
  });
});

describe('handleCheckRunWebhook', () => {
  it('returns null event for non-completed actions', () => {
    const result = handleCheckRunWebhook({
      action: 'created',
      check_run: { name: 'tests', status: 'in_progress' },
    });

    expect(result.event).toBeNull();
    expect(result.action).toBe('check_run.created');
  });

  it('returns event for completed check run', () => {
    const result = handleCheckRunWebhook({
      action: 'completed',
      check_run: {
        name: 'CI Tests',
        status: 'completed',
        conclusion: 'success',
      },
    });

    expect(result.event).toBeTruthy();
    expect(result.event!.type).toBe('decision');
    expect(result.event!.data.check_name).toBe('CI Tests');
    expect(result.event!.data.conclusion).toBe('success');
    expect(result.action).toBe('check_run.completed.success');
  });

  it('maps failure conclusion to failure event type', () => {
    const result = handleCheckRunWebhook({
      action: 'completed',
      check_run: {
        name: 'CI Tests',
        status: 'completed',
        conclusion: 'failure',
      },
    });

    expect(result.event!.type).toBe('failure');
    expect(result.action).toBe('check_run.completed.failure');
  });

  it('parses CI signal from output text', () => {
    const result = handleCheckRunWebhook({
      action: 'completed',
      check_run: {
        name: 'Tests',
        status: 'completed',
        conclusion: 'success',
        output: {
          text: `
 Test Files  12 passed (12)
      Tests  411 passed (411)
   Duration  467ms
          `,
        },
      },
    });

    expect(result.ciSignal).toBeTruthy();
    expect(result.ciSignal!.runner).toBe('vitest');
    expect(result.ciSignal!.test_passed).toBe(411);
    expect(result.ciSignal!.suites_passed).toBe(12);
    expect(result.event!.data.ci_signal).toBeTruthy();
  });

  it('returns null ciSignal when output has no test data', () => {
    const result = handleCheckRunWebhook({
      action: 'completed',
      check_run: {
        name: 'Lint',
        status: 'completed',
        conclusion: 'success',
        output: { text: 'All checks passed' },
      },
    });

    expect(result.ciSignal).toBeNull();
  });

  it('passes through sprint and session options', () => {
    const result = handleCheckRunWebhook(
      {
        action: 'completed',
        check_run: { name: 'tests', status: 'completed', conclusion: 'success' },
      },
      { sprintNumber: 5, sessionId: 'sess-1' },
    );

    expect(result.event!.sprint_number).toBe(5);
    expect(result.event!.session_id).toBe('sess-1');
  });

  it('handles missing check_run', () => {
    const result = handleCheckRunWebhook({ action: 'completed' });
    expect(result.event).toBeNull();
    expect(result.action).toBe('check_run.completed');
  });
});

describe('handleWorkflowRunWebhook', () => {
  it('returns null event for non-completed actions', () => {
    const result = handleWorkflowRunWebhook({
      action: 'requested',
      workflow_run: { name: 'CI', status: 'queued' },
    });

    expect(result.event).toBeNull();
    expect(result.action).toBe('workflow_run.requested');
  });

  it('returns event for completed workflow', () => {
    const result = handleWorkflowRunWebhook({
      action: 'completed',
      workflow_run: {
        name: 'Build and Test',
        status: 'completed',
        conclusion: 'success',
        head_branch: 'main',
        run_number: 42,
      },
    });

    expect(result.event).toBeTruthy();
    expect(result.event!.type).toBe('decision');
    expect(result.event!.data.workflow_name).toBe('Build and Test');
    expect(result.event!.data.branch).toBe('main');
    expect(result.event!.data.run_number).toBe(42);
    expect(result.action).toBe('workflow_run.completed.success');
  });

  it('maps failure conclusion to failure event type', () => {
    const result = handleWorkflowRunWebhook({
      action: 'completed',
      workflow_run: {
        name: 'CI',
        status: 'completed',
        conclusion: 'failure',
      },
    });

    expect(result.event!.type).toBe('failure');
  });

  it('always returns null ciSignal (workflow_run has no test output)', () => {
    const result = handleWorkflowRunWebhook({
      action: 'completed',
      workflow_run: {
        name: 'CI',
        status: 'completed',
        conclusion: 'success',
      },
    });

    expect(result.ciSignal).toBeNull();
  });

  it('handles missing workflow_run', () => {
    const result = handleWorkflowRunWebhook({ action: 'completed' });
    expect(result.event).toBeNull();
  });
});
