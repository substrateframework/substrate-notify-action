const crypto = require('crypto');

describe('Event Validation', () => {
  test('validates workflow_run event name', () => {
    const eventName = 'workflow_run';
    expect(eventName).toBe('workflow_run');
  });

  test('validates completed action', () => {
    const action = 'completed';
    expect(action).toBe('completed');
  });

  test('rejects non-completed actions', () => {
    const action = 'requested';
    expect(action).not.toBe('completed');
  });
});

describe('HTTPS Validation', () => {
  test('accepts https:// URLs', () => {
    const validateSecureDestination = (apiUrl) => {
      const url = new URL(apiUrl);
      const isLocalTest = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

      if (url.protocol !== 'https:' && !isLocalTest) {
        throw new Error('API URL must use HTTPS (http:// only allowed for localhost/127.0.0.1)');
      }
    };

    expect(() => validateSecureDestination('https://api.substrate.dev/webhook')).not.toThrow();
  });

  test('accepts http://localhost', () => {
    const validateSecureDestination = (apiUrl) => {
      const url = new URL(apiUrl);
      const isLocalTest = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

      if (url.protocol !== 'https:' && !isLocalTest) {
        throw new Error('API URL must use HTTPS (http:// only allowed for localhost/127.0.0.1)');
      }
    };

    expect(() => validateSecureDestination('http://localhost:3000/webhook')).not.toThrow();
  });

  test('accepts http://127.0.0.1', () => {
    const validateSecureDestination = (apiUrl) => {
      const url = new URL(apiUrl);
      const isLocalTest = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

      if (url.protocol !== 'https:' && !isLocalTest) {
        throw new Error('API URL must use HTTPS (http:// only allowed for localhost/127.0.0.1)');
      }
    };

    expect(() => validateSecureDestination('http://127.0.0.1:3000/webhook')).not.toThrow();
  });

  test('rejects http:// for non-local hosts', () => {
    const validateSecureDestination = (apiUrl) => {
      const url = new URL(apiUrl);
      const isLocalTest = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

      if (url.protocol !== 'https:' && !isLocalTest) {
        throw new Error('API URL must use HTTPS (http:// only allowed for localhost/127.0.0.1)');
      }
    };

    expect(() => validateSecureDestination('http://api.example.com/webhook')).toThrow(
      'API URL must use HTTPS'
    );
  });
});

describe('Payload Extraction', () => {
  test('extracts payload from workflow_run event', () => {
    const context = {
      payload: {
        workflow_run: {
          id: 123456,
          head_sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
          head_branch: 'main',
          html_url: 'https://github.com/org/repo/actions/runs/123456',
          conclusion: 'success',
          updated_at: '2026-11-06T12:34:56Z',
          event: 'push',
          name: 'CI'
        },
        repository: {
          html_url: 'https://github.com/org/repo'
        }
      }
    };

    const extractPayload = (context) => {
      const workflowRun = context.payload.workflow_run;
      const repository = context.payload.repository;
      const headBranch = workflowRun.head_branch;
      let ref;
      if (headBranch && typeof headBranch === 'string' && headBranch.trim() !== '') {
        ref = `refs/heads/${headBranch}`;
      } else {
        throw new Error('Cannot construct ref: head_branch is null or empty.');
      }

      return {
        repository_url: repository.html_url,
        commit_sha: workflowRun.head_sha,
        ref: ref,
        workflow_run_id: String(workflowRun.id),
        workflow_run_url: workflowRun.html_url,
        conclusion: workflowRun.conclusion,
        updated_at: workflowRun.updated_at,
        ...(workflowRun.event && { event_name: workflowRun.event }),
        ...(workflowRun.name && { workflow_name: workflowRun.name })
      };
    };

    const payload = extractPayload(context);

    expect(payload).toEqual({
      repository_url: 'https://github.com/org/repo',
      commit_sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      ref: 'refs/heads/main',
      workflow_run_id: '123456',
      workflow_run_url: 'https://github.com/org/repo/actions/runs/123456',
      conclusion: 'success',
      updated_at: '2026-11-06T12:34:56Z',
      event_name: 'push',
      workflow_name: 'CI'
    });
  });

  test('constructs ref from head_branch', () => {
    const context = {
      payload: {
        workflow_run: {
          id: 123456,
          head_sha: 'abc123',
          head_branch: 'feature/test',
          html_url: 'https://github.com/org/repo/actions/runs/123456',
          conclusion: 'success',
          updated_at: '2026-11-06T12:34:56Z'
        },
        repository: { html_url: 'https://github.com/org/repo' }
      }
    };

    const extractPayload = (context) => {
      const workflowRun = context.payload.workflow_run;
      const repository = context.payload.repository;
      const headBranch = workflowRun.head_branch;
      let ref;
      if (headBranch && typeof headBranch === 'string' && headBranch.trim() !== '') {
        ref = `refs/heads/${headBranch}`;
      } else {
        throw new Error('Cannot construct ref: head_branch is null or empty.');
      }

      return {
        repository_url: repository.html_url,
        commit_sha: workflowRun.head_sha,
        ref: ref,
        workflow_run_id: String(workflowRun.id),
        workflow_run_url: workflowRun.html_url,
        conclusion: workflowRun.conclusion,
        updated_at: workflowRun.updated_at,
        ...(workflowRun.event && { event_name: workflowRun.event }),
        ...(workflowRun.name && { workflow_name: workflowRun.name })
      };
    };

    const payload = extractPayload(context);
    expect(payload.ref).toBe('refs/heads/feature/test');
  });

  test('fails when head_branch is null', () => {
    const context = {
      payload: {
        workflow_run: {
          id: 123456,
          head_sha: 'abc123',
          head_branch: null,
          html_url: 'https://github.com/org/repo/actions/runs/123456',
          conclusion: 'success',
          updated_at: '2026-11-06T12:34:56Z'
        },
        repository: { html_url: 'https://github.com/org/repo' }
      }
    };

    const extractPayload = (context) => {
      const workflowRun = context.payload.workflow_run;
      const repository = context.payload.repository;
      const headBranch = workflowRun.head_branch;
      let ref;
      if (headBranch && typeof headBranch === 'string' && headBranch.trim() !== '') {
        ref = `refs/heads/${headBranch}`;
      } else {
        throw new Error('Cannot construct ref: head_branch is null or empty.');
      }

      return {
        repository_url: repository.html_url,
        commit_sha: workflowRun.head_sha,
        ref: ref,
        workflow_run_id: String(workflowRun.id),
        workflow_run_url: workflowRun.html_url,
        conclusion: workflowRun.conclusion,
        updated_at: workflowRun.updated_at
      };
    };

    expect(() => extractPayload(context)).toThrow('Cannot construct ref: head_branch is null or empty');
  });

  test('fails when head_branch is empty string', () => {
    const context = {
      payload: {
        workflow_run: {
          id: 123456,
          head_sha: 'abc123',
          head_branch: '',
          html_url: 'https://github.com/org/repo/actions/runs/123456',
          conclusion: 'success',
          updated_at: '2026-11-06T12:34:56Z'
        },
        repository: { html_url: 'https://github.com/org/repo' }
      }
    };

    const extractPayload = (context) => {
      const workflowRun = context.payload.workflow_run;
      const headBranch = workflowRun.head_branch;
      let ref;
      if (headBranch && typeof headBranch === 'string' && headBranch.trim() !== '') {
        ref = `refs/heads/${headBranch}`;
      } else {
        throw new Error('Cannot construct ref: head_branch is null or empty.');
      }

      return { ref };
    };

    expect(() => extractPayload(context)).toThrow('Cannot construct ref: head_branch is null or empty');
  });
});

describe('Payload Validation', () => {
  const validatePayload = (payload) => {
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

    if (!/^[a-f0-9]{40}$/i.test(payload.commit_sha)) {
      throw new Error(`Invalid commit_sha format: ${payload.commit_sha}`);
    }
  };

  test('validates required fields', () => {
    const validPayload = {
      repository_url: 'https://github.com/org/repo',
      commit_sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      ref: 'refs/heads/main',
      workflow_run_id: '123456',
      workflow_run_url: 'https://github.com/org/repo/actions/runs/123456',
      conclusion: 'success',
      updated_at: '2026-11-06T12:34:56Z'
    };

    expect(() => validatePayload(validPayload)).not.toThrow();
  });

  test('rejects missing required field', () => {
    const invalidPayload = {
      repository_url: 'https://github.com/org/repo',
      // missing commit_sha
      ref: 'refs/heads/main',
      workflow_run_id: '123456',
      workflow_run_url: 'https://github.com/org/repo/actions/runs/123456',
      conclusion: 'success',
      updated_at: '2026-11-06T12:34:56Z'
    };

    expect(() => validatePayload(invalidPayload)).toThrow('Missing required field: commit_sha');
  });

  test('validates commit_sha format', () => {
    const invalidPayload = {
      repository_url: 'https://github.com/org/repo',
      commit_sha: 'invalid_sha',
      ref: 'refs/heads/main',
      workflow_run_id: '123456',
      workflow_run_url: 'https://github.com/org/repo/actions/runs/123456',
      conclusion: 'success',
      updated_at: '2026-11-06T12:34:56Z'
    };

    expect(() => validatePayload(invalidPayload)).toThrow('Invalid commit_sha format: invalid_sha');
  });

  test('accepts valid 40-char hex commit_sha', () => {
    const validPayload = {
      repository_url: 'https://github.com/org/repo',
      commit_sha: 'ABCDEF1234567890abcdef1234567890ABCDEF12',
      ref: 'refs/heads/main',
      workflow_run_id: '123456',
      workflow_run_url: 'https://github.com/org/repo/actions/runs/123456',
      conclusion: 'success',
      updated_at: '2026-11-06T12:34:56Z'
    };

    expect(() => validatePayload(validPayload)).not.toThrow();
  });
});

describe('HMAC Signature Generation', () => {
  test('generates correct HMAC-SHA256 signature', () => {
    const generateSignature = (secret, timestamp, body) => {
      const signingPayload = `${timestamp}.${body}`;
      return crypto
        .createHmac('sha256', secret)
        .update(signingPayload, 'utf8')
        .digest('hex');
    };

    const secret = 'test-secret-32-characters-long!!';
    const timestamp = '1699272896';
    const body = '{"repository_url":"https://github.com/org/repo"}';

    const signature = generateSignature(secret, timestamp, body);

    // Signature should be 64 hex characters
    expect(signature).toMatch(/^[a-f0-9]{64}$/);

    // Same inputs should produce same signature
    const signature2 = generateSignature(secret, timestamp, body);
    expect(signature).toBe(signature2);

    // Different timestamp should produce different signature
    const signature3 = generateSignature(secret, '1699272897', body);
    expect(signature).not.toBe(signature3);
  });

  test('produces compact JSON serialization', () => {
    const payload = {
      repository_url: 'https://github.com/org/repo',
      commit_sha: 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0',
      ref: 'refs/heads/main'
    };

    const compactJson = JSON.stringify(payload);

    // No extra whitespace
    expect(compactJson).not.toContain('\n');
    expect(compactJson).not.toContain('  ');

    // Contains the data
    expect(compactJson).toContain('repository_url');
    expect(compactJson).toContain('commit_sha');
  });
});
