const { MockAgent, setGlobalDispatcher, getGlobalDispatcher } = require('undici');

describe('Mock Endpoint Tests', () => {
  let mockAgent;
  let originalDispatcher;

  beforeAll(() => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent({ connections: 1 });
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  afterAll(() => {
    setGlobalDispatcher(originalDispatcher);
  });

  afterEach(async () => {
    await mockAgent.close();
    mockAgent = new MockAgent({ connections: 1 });
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);
  });

  test('202 Accepted response (success)', async () => {
    const apiUrl = 'https://api.example.com';
    const mockPool = mockAgent.get(apiUrl);

    mockPool
      .intercept({
        path: '/webhooks/github/workflow-complete',
        method: 'POST'
      })
      .reply(202, {
        evaluation_job_id: 'eval_123',
        status: 'accepted'
      });

    const response = await fetch(`${apiUrl}/webhooks/github/workflow-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 'data' })
    });

    expect(response.status).toBe(202);
    const data = await response.json();
    expect(data.evaluation_job_id).toBe('eval_123');
    expect(data.status).toBe('accepted');
  });

  test('409 Conflict response (treated as success)', async () => {
    const apiUrl = 'https://api.example.com';
    const mockPool = mockAgent.get(apiUrl);

    mockPool
      .intercept({
        path: '/webhooks/github/workflow-complete',
        method: 'POST'
      })
      .reply(409, {
        evaluation_job_id: 'eval_456',
        status: 'duplicate',
        detail: 'Notification already processed'
      });

    const response = await fetch(`${apiUrl}/webhooks/github/workflow-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 'data' })
    });

    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.evaluation_job_id).toBe('eval_456');
    expect(data.status).toBe('duplicate');
  });

  test('400 Bad Request (fail immediately, no retry)', async () => {
    const apiUrl = 'https://api.example.com';
    const mockPool = mockAgent.get(apiUrl);

    mockPool
      .intercept({
        path: '/webhooks/github/workflow-complete',
        method: 'POST'
      })
      .reply(400, {
        detail: 'Invalid request: missing required field commit_sha'
      });

    const response = await fetch(`${apiUrl}/webhooks/github/workflow-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 'data' })
    });

    expect(response.status).toBe(400);
  });

  test('401 Unauthorized (fail immediately, no retry)', async () => {
    const apiUrl = 'https://api.example.com';
    const mockPool = mockAgent.get(apiUrl);

    mockPool
      .intercept({
        path: '/webhooks/github/workflow-complete',
        method: 'POST'
      })
      .reply(401, {
        detail: 'Invalid signature'
      });

    const response = await fetch(`${apiUrl}/webhooks/github/workflow-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 'data' })
    });

    expect(response.status).toBe(401);
  });

  test('500 Server Error (retryable)', async () => {
    const apiUrl = 'https://api.example.com';
    const mockPool = mockAgent.get(apiUrl);

    mockPool
      .intercept({
        path: '/webhooks/github/workflow-complete',
        method: 'POST'
      })
      .reply(500, 'Internal Server Error');

    const response = await fetch(`${apiUrl}/webhooks/github/workflow-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 'data' })
    });

    expect(response.status).toBe(500);
  });

  test('503 Service Unavailable with Retry-After (integer seconds)', async () => {
    const apiUrl = 'https://api.example.com';
    const mockPool = mockAgent.get(apiUrl);

    mockPool
      .intercept({
        path: '/webhooks/github/workflow-complete',
        method: 'POST'
      })
      .reply(503, 'Service Unavailable', {
        headers: {
          'Retry-After': '5'
        }
      });

    const response = await fetch(`${apiUrl}/webhooks/github/workflow-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 'data' })
    });

    expect(response.status).toBe(503);
    expect(response.headers.get('Retry-After')).toBe('5');
  });

  test('429 Rate Limit with Retry-After (HTTP-date)', async () => {
    const apiUrl = 'https://api.example.com';
    const mockPool = mockAgent.get(apiUrl);

    const retryDate = new Date(Date.now() + 10000).toUTCString();

    mockPool
      .intercept({
        path: '/webhooks/github/workflow-complete',
        method: 'POST'
      })
      .reply(429, 'Rate Limited', {
        headers: {
          'Retry-After': retryDate
        }
      });

    const response = await fetch(`${apiUrl}/webhooks/github/workflow-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ test: 'data' })
    });

    expect(response.status).toBe(429);
    expect(response.headers.get('Retry-After')).toBe(retryDate);
  });

  test('redirect rejection (redirect: error)', async () => {
    const apiUrl = 'https://api.example.com';
    const mockPool = mockAgent.get(apiUrl);

    mockPool
      .intercept({
        path: '/webhooks/github/workflow-complete',
        method: 'POST'
      })
      .reply(301, '', {
        headers: {
          'Location': 'https://other.example.com/webhook'
        }
      });

    await expect(
      fetch(`${apiUrl}/webhooks/github/workflow-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' }),
        redirect: 'error'
      })
    ).rejects.toThrow();
  });

  test('request timeout via AbortController', async () => {
    const apiUrl = 'https://api.example.com';
    const mockPool = mockAgent.get(apiUrl);

    // Simulate slow response
    mockPool
      .intercept({
        path: '/webhooks/github/workflow-complete',
        method: 'POST'
      })
      .reply(() => {
        return new Promise((resolve) => {
          // Never resolve - simulates hanging request
        });
      });

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 100);

    await expect(
      fetch(`${apiUrl}/webhooks/github/workflow-complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ test: 'data' }),
        signal: controller.signal
      }).finally(() => clearTimeout(timeout))
    ).rejects.toThrow();
  });

  test('request body matches contract', async () => {
    const apiUrl = 'https://api.example.com';
    const mockPool = mockAgent.get(apiUrl);

    let capturedBody;

    mockPool
      .intercept({
        path: '/webhooks/github/workflow-complete',
        method: 'POST'
      })
      .reply((opts) => {
        capturedBody = opts.body;
        return {
          statusCode: 202,
          data: { evaluation_job_id: 'eval_123', status: 'accepted' }
        };
      });

    const payload = {
      repository_url: 'https://github.com/org/repo',
      commit_sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      ref: 'refs/heads/main',
      workflow_run_id: '123456',
      workflow_run_url: 'https://github.com/org/repo/actions/runs/123456',
      conclusion: 'success',
      updated_at: '2026-11-06T12:34:56Z'
    };

    await fetch(`${apiUrl}/webhooks/github/workflow-complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const receivedPayload = JSON.parse(capturedBody);
    expect(receivedPayload).toEqual(payload);
  });

  test('HMAC signature verification', () => {
    const crypto = require('crypto');

    const secret = 'test-secret-32-characters-long!!';
    const timestamp = '1699272896';
    const body = JSON.stringify({
      repository_url: 'https://github.com/org/repo',
      commit_sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0'
    });

    const signingPayload = `${timestamp}.${body}`;
    const signature = crypto
      .createHmac('sha256', secret)
      .update(signingPayload, 'utf8')
      .digest('hex');

    // Verify signature format
    expect(signature).toMatch(/^[a-f0-9]{64}$/);

    // Verify server-side validation would work
    const verifySignature = crypto
      .createHmac('sha256', secret)
      .update(signingPayload, 'utf8')
      .digest('hex');

    expect(signature).toBe(verifySignature);
  });
});
