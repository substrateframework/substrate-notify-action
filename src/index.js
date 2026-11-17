const core = require('@actions/core');
const github = require('@actions/github');
const crypto = require('crypto');
const https = require('https');

async function run() {
  try {
    // 1. Validate event type AND action
    if (github.context.eventName !== 'workflow_run') {
      core.setFailed('This action must be triggered by workflow_run event');
      return;
    }

    const action = github.context.payload.action;
    if (action !== 'completed') {
      core.setFailed(`This action requires workflow_run action 'completed', got '${action}'`);
      return;
    }

    // 2. Get inputs and validate security
    const apiUrl = core.getInput('api-url', { required: true });
    const secret = core.getInput('secret', { required: true });

    validateSecureDestination(apiUrl);

    // 3. Extract payload from workflow_run event
    const payload = extractPayload(github.context);

    // 4. Validate required fields
    validatePayload(payload);

    // 5. Send notification with retries
    await sendNotification(apiUrl, secret, payload);

    core.info('✓ Notification delivered successfully');
  } catch (error) {
    core.setFailed(error.message);
  }
}

function validateSecureDestination(apiUrl) {
  // Require HTTPS for production destinations
  // Allow http://localhost and http://127.0.0.1 for local testing only
  const url = new URL(apiUrl);
  const isLocalTest = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

  if (url.protocol !== 'https:' && !isLocalTest) {
    throw new Error('API URL must use HTTPS (http:// only allowed for localhost/127.0.0.1)');
  }
}

function extractPayload(context) {
  const workflowRun = context.payload.workflow_run;
  const repository = context.payload.repository;

  if (!workflowRun) {
    throw new Error('workflow_run data not found in event payload');
  }

  // Construct ref from head_branch only if present
  // Do not fabricate - fail if cannot construct valid ref
  const headBranch = workflowRun.head_branch;
  let ref;
  if (headBranch && typeof headBranch === 'string' && headBranch.trim() !== '') {
    ref = `refs/heads/${headBranch}`;
  } else {
    throw new Error(
      'Cannot construct ref: head_branch is null or empty. ' +
      'This is a known GitHub limitation for certain workflow configurations.'
    );
  }

  return {
    repository_url: repository.html_url,
    commit_sha: workflowRun.head_sha,
    ref: ref,
    workflow_run_id: String(workflowRun.id),
    workflow_run_url: workflowRun.html_url,
    conclusion: workflowRun.conclusion,
    updated_at: workflowRun.updated_at,
    // Optional fields - only include if present
    ...(workflowRun.event && { event_name: workflowRun.event }),
    ...(workflowRun.name && { workflow_name: workflowRun.name })
  };
}

function validatePayload(payload) {
  const required = [
    'repository_url',
    'commit_sha',
    'ref',
    'workflow_run_id',
    'workflow_run_url',
    'conclusion',
    'updated_at'
  ];

  for (const field of required) {
    if (!payload[field]) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  // Validate commit_sha format (40 hex chars)
  if (!/^[a-f0-9]{40}$/i.test(payload.commit_sha)) {
    throw new Error(`Invalid commit_sha format: ${payload.commit_sha}`);
  }
}

async function sendNotification(apiUrl, secret, payload, attempt = 1) {
  const maxAttempts = 3; // 3 attempts = 2 retries (delays: 1s, 2s)
  const baseBackoffMs = 1000;

  try {
    // Generate fresh timestamp and signature for each attempt
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify(payload); // Compact JSON by default
    const signature = generateSignature(secret, timestamp, body);

    core.info(`Sending notification (attempt ${attempt}/${maxAttempts})...`);

    // Fetch with timeout (30 seconds)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    // Create HTTPS agent that accepts self-signed certificates (for MVP with self-signed certs)
    const agent = new https.Agent({ rejectUnauthorized: false });

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Substrate-Signature': signature,
        'X-Substrate-Timestamp': timestamp
      },
      body: body,
      signal: controller.signal,
      redirect: 'error',  // Reject redirects - don't forward signed request
      agent: agent  // Accept self-signed certificates
    }).finally(() => clearTimeout(timeoutId));

    // Success cases
    if (response.status === 202) {
      const data = await response.json();
      core.info(`Notification accepted: ${data.evaluation_job_id}`);
      return;
    }

    if (response.status === 409) {
      const data = await response.json();
      core.info(`Duplicate notification (already processed): ${data.evaluation_job_id}`);
      return;
    }

    // Non-retryable client errors
    if (response.status >= 400 && response.status < 500 && response.status !== 429) {
      const text = await response.text();
      throw new Error(`Request rejected (${response.status}): ${text}`);
    }

    // Retryable errors: 429 (rate limit), 5xx (server errors)
    if (attempt < maxAttempts && (response.status === 429 || response.status >= 500)) {
      // Calculate backoff: exponential with optional Retry-After header
      let delayMs = baseBackoffMs * Math.pow(2, attempt - 1); // Attempt 1: 1s, Attempt 2: 2s

      // Respect Retry-After if present and valid (integer seconds or HTTP-date)
      const retryAfter = response.headers.get('Retry-After');
      if (retryAfter && retryAfter.trim() !== '') {
        const retrySeconds = parseInt(retryAfter, 10);
        if (!isNaN(retrySeconds) && retrySeconds >= 0) {
          // Valid integer seconds format
          delayMs = retrySeconds * 1000;
        } else {
          // Try HTTP-date format (RFC 7231)
          const retryDate = new Date(retryAfter);
          if (!isNaN(retryDate.getTime())) {
            const nowMs = Date.now();
            const retryMs = retryDate.getTime();
            delayMs = Math.max(0, retryMs - nowMs);
          }
          // If neither format is valid, fall back to exponential backoff (delayMs unchanged)
        }
      }

      // Cap at 30 seconds (bounded retry policy)
      delayMs = Math.min(delayMs, 30000);

      core.warning(`Request failed with ${response.status}, retrying in ${delayMs}ms...`);
      await sleep(delayMs);
      return sendNotification(apiUrl, secret, payload, attempt + 1);
    }

    throw new Error(`Request failed after ${maxAttempts} attempts: ${response.status}`);

  } catch (error) {
    // Network errors and timeouts are retryable
    const isRetryable = (
      error.name === 'AbortError' || // Timeout
      error.name === 'FetchError' ||  // Network error
      error.code === 'ECONNREFUSED' ||
      error.code === 'ETIMEDOUT'
    );

    if (attempt < maxAttempts && isRetryable) {
      const delayMs = baseBackoffMs * Math.pow(2, attempt - 1);
      core.warning(`Network error, retrying in ${delayMs}ms: ${error.message}`);
      await sleep(delayMs);
      return sendNotification(apiUrl, secret, payload, attempt + 1);
    }

    throw error;
  }
}

function generateSignature(secret, timestamp, body) {
  const signingPayload = `${timestamp}.${body}`;
  return crypto
    .createHmac('sha256', secret)
    .update(signingPayload, 'utf8')
    .digest('hex');
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

run();
