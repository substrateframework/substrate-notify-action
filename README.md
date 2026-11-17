# Substrate Notification Action

A GitHub Action that notifies Substrate when a workflow completes. This action is triggered by `workflow_run` events and sends authenticated webhook notifications to the Substrate API.

## Features

- ✅ Sends notifications when monitored workflows complete
- ✅ HMAC-SHA256 signature authentication
- ✅ Automatic retries with exponential backoff for transient failures
- ✅ Respects `Retry-After` headers from the server
- ✅ Treats both 202 Accepted and 409 Conflict as successful delivery
- ✅ Secure: enforces HTTPS, never logs secrets
- ✅ Fresh timestamp and signature generated for each retry attempt

## Prerequisites

1. **Substrate API deployment**: You need a running Substrate API instance
2. **Webhook secret**: A shared HMAC secret (≥32 characters, cryptographically random) configured in both:
   - Your GitHub repository secrets (e.g., `SUBSTRATE_WEBHOOK_SECRET`)
   - Your Substrate API deployment (environment variable)

## Usage

Create a workflow that triggers on `workflow_run` events:

```yaml
# .github/workflows/notify-substrate.yml
name: Notify Substrate

on:
  workflow_run:
    workflows: ["CI", "Tests", "Build"]  # Names of workflows to monitor
    types: [completed]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: substrateframework/substrate-notify-action@v1
        with:
          api-url: ${{ secrets.SUBSTRATE_API_URL }}
          secret: ${{ secrets.SUBSTRATE_WEBHOOK_SECRET }}
```

## Inputs

| Input | Required | Description |
|-------|----------|-------------|
| `api-url` | Yes | Full URL to the Substrate webhook endpoint<br/>Example: `https://api.substrate.dev/webhooks/github/workflow-complete` |
| `secret` | Yes | Shared HMAC secret for request signing (store in GitHub Secrets) |

## Security

### HTTPS Requirement

The Action **requires HTTPS** for all API URLs except `localhost` and `127.0.0.1` (for local testing only).

### Secret Handling

- The shared secret is **never logged** by the Action
- The HMAC signature is **never logged** by the Action
- Store the secret in GitHub Secrets, not in workflow files
- Use a cryptographically random secret ≥32 characters

### ⚠️ **CRITICAL SECURITY WARNING** ⚠️

**Do NOT check out or execute untrusted pull request code in the notification workflow.**

The notification workflow has access to the webhook secret through its inputs. If you add steps that checkout code from a pull request or run arbitrary code, that code could access the secret.

**Safe** (only runs the action):
```yaml
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: substrateframework/substrate-notify-action@v1
        with:
          api-url: ${{ secrets.SUBSTRATE_API_URL }}
          secret: ${{ secrets.SUBSTRATE_WEBHOOK_SECRET }}
```

**UNSAFE** (checks out PR code with secret access):
```yaml
on:
  workflow_run:
    workflows: ["CI"]
    types: [completed]

jobs:
  notify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4  # ⚠️ DANGEROUS
      - run: ./some-script.sh       # ⚠️ Could access secrets
      - uses: substrateframework/substrate-notify-action@v1
        with:
          api-url: ${{ secrets.SUBSTRATE_API_URL }}
          secret: ${{ secrets.SUBSTRATE_WEBHOOK_SECRET }}
```

## How It Works

1. **Event Validation**: Verifies the workflow is triggered by `workflow_run` with action `completed`
2. **Payload Extraction**: Reads workflow completion data from `github.event.workflow_run`
3. **Signature Generation**: Creates HMAC-SHA256 signature of `{timestamp}.{body}`
4. **HTTP Request**: POSTs to the Substrate API with signature headers
5. **Retry Logic**: Retries on network errors, timeouts, 429, and 5xx responses
6. **Success**: Returns when server responds with 202 or 409

### Retry Behavior

- **Total attempts**: 3 (first attempt + 2 retries)
- **Retry delays**: 1 second, then 2 seconds
- **Respects Retry-After**: Honors server's retry delay (capped at 30 seconds)
- **Fresh signatures**: Each retry generates a new timestamp and signature
- **Retryable errors**: Network failures, timeouts, HTTP 429, HTTP 5xx
- **Non-retryable errors**: HTTP 400-403, HTTP 404-499 (except 429)

### Success Conditions

Both of these responses are treated as successful delivery:
- **202 Accepted**: Notification accepted for processing
- **409 Conflict**: Duplicate notification (already processed)

## API Contract

The action sends a JSON payload matching the Substrate webhook API contract:

```json
{
  "repository_url": "https://github.com/org/repo",
  "commit_sha": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0",
  "ref": "refs/heads/main",
  "workflow_run_id": "1234567890",
  "workflow_run_url": "https://github.com/org/repo/actions/runs/1234567890",
  "conclusion": "success",
  "updated_at": "2026-11-06T12:34:56Z",
  "event_name": "push",
  "workflow_name": "CI"
}
```

### Headers

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-Substrate-Signature` | Lowercase hex HMAC-SHA256 signature |
| `X-Substrate-Timestamp` | Unix timestamp (seconds) used in signature |

### Signature Algorithm

```
timestamp = current_unix_time_seconds
body = compact_json(payload)
signing_payload = "{timestamp}.{body}"
signature = hmac_sha256(secret, signing_payload).hexdigest()
```

## Limitations

### head_branch Null

The action will fail with a clear error if `github.event.workflow_run.head_branch` is `null`. This is a known GitHub API limitation for certain workflow configurations (e.g., workflows triggered by tags instead of branches).

The action **does not fabricate** ref values. If a valid branch ref cannot be constructed, the action fails explicitly.

### Branch Refs Only

The `ref` field assumes branches (`refs/heads/*`). Tags (`refs/tags/*`) and other ref types are not handled by the simple `head_branch → ref` mapping.

## Versioning

- **Recommended**: Use `@v1` to automatically get the latest v1.x.x release
  ```yaml
  uses: substrateframework/substrate-notify-action@v1
  ```

- **Specific version**: Pin to an exact version for maximum stability
  ```yaml
  uses: substrateframework/substrate-notify-action@v1.0.0
  ```

## Development

### Local Setup

```bash
# Install dependencies
npm install

# Run tests
npm test

# Build bundled dist/index.js
npm run build
```

### Running Tests

```bash
# All tests
npm test

# Watch mode
npm test -- --watch

# Coverage
npm test -- --coverage
```

### Building

The action uses `@vercel/ncc` to bundle dependencies into a single `dist/index.js` file:

```bash
npm run build
```

The bundled `dist/index.js` is committed to the repository so consumers don't need to install dependencies.

## License

MIT

## Contributing

Issues and pull requests are welcome at [https://github.com/substrateframework/substrate-notify-action](https://github.com/substrateframework/substrate-notify-action)

## Support

- [Documentation](https://github.com/substrateframework/substrate-notify-action)
- [Issues](https://github.com/substrateframework/substrate-notify-action/issues)
- [Substrate Framework](https://github.com/substrateframework)
