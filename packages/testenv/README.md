# @horus/testenv — testenv/v1 Schema & Validator

Declarative manifest format (`testenv/v1`) for isolated, ephemeral test environments.
Repo-agnostic: no stack-specific assumptions. Per-repo specifics (provisioner commands,
service names, port numbers) are data in the manifest, not code in this package.

---

## Overview

A `.testenv/manifest.yaml` file describes how to spin up an isolated copy of a repo's
stack, run tests against it, and tear it down — with provable isolation invariants at
each step. The format is consumed by the runner core CLI and the `sdlc-testenv` executor
subagent. The run result / event log format is corpus-ready: a future CI regression gate
reuses it unchanged.

---

## The 6-Phase Spine

```
setup → launch → await_ready → connection → test → teardown
```

| Phase         | Purpose                                                                 |
|---------------|-------------------------------------------------------------------------|
| `setup`       | Clone code, build, prepare file layout. Phase-1 isolation checks here. |
| `launch`      | Bring up the stack (via `provisioner` command or explicit steps). Phase-2 checks. |
| `await_ready` | Poll until all services are healthy (timeout-bounded).                  |
| `connection`  | Emit the connection manifest (MCP settings, API base URLs, etc.).       |
| `test`        | Execute test actions (the do/check/proof units).                        |
| `teardown`    | Release the stack. Phase-6 detective isolation checks.                  |

---

## Isolation Invariants

Three enforcement points guarantee the test stack never disturbs a co-located live stack:

**Phase 1 — Preventive** (abort before touching anything shared):
- Disjoint docker project / network / volumes / port space / data directory
- All declared `requires.secrets` present in the environment

**Phase 2 — Structural** (verified after launch):
- Distinct docker project name
- All ports fully projected (no wildcards or overlay-merge)
- Connection manifest emitted with correctly suffixed MCP server names

**Phase 6 — Detective** (verified post-teardown):
- Live stack still running and unmodified
- Live data contains zero test artifacts
- No secret values in logs or temp files

---

## Test Actions — The Do/Check/Proof Unit

Each test action is a `{invoke, expect, evidence}` triple:

```yaml
- name: anvil-roundtrip
  invoke:
    tool: anvil_create_note
    args: { title: "check" }
  expect:
    returns: note_id
  evidence:
    capture: response
  needsStack: true
```

Three invocation flavors:

1. **Command** — `{ run: "curl -sf http://localhost:8080/health" }`
2. **MCP tool call** — `{ tool: "anvil_create_note", args: { title: "check" } }`
3. **HTTP request** — `{ http: "live-anvil/search?q=check" }`
4. **Ordered sequence** — `{ sequence: [{ name, invoke, expect }, ...] }`

Each action declares `needsStack: boolean`. When `false`, the runner skips
setup/launch/await_ready/teardown for that action (fast unit/type inner loop).

---

## Manifest Structure

```yaml
apiVersion: testenv/v1
repo: my-app

requires:
  secrets: [MY_API_KEY, DB_PASSWORD]   # env var NAMES only — values never logged
  profiles:
    laptop: { mem: 6g }
    cloud:  { mem: 12g }

phases:
  setup:
    steps:
      - run: git clone --no-hardlinks {src} {workdir}
      - run: npm install && npm run build
    assert:
      - type: path_exists
        path: {workdir}/dist
    isolationChecks:
      disjointDockerProject: true
      disjointPortSpace: true
      allRequiredSecretsPresent: true

  launch:
    provisioner: "docker compose -p my-app-test-{slot} up -d"
    assert:
      - type: containers_running
        count: 3
      - type: ports_disjoint_from_live
        value: true
    isolationChecks:
      distinctDockerProject: true
      fullyProjectedPorts: true
      connectionManifestEmitted: true

  await_ready:
    poll:
      - probe: "GET :{api_port}/health"
        expect: http_200
    timeout: 120

  connection:
    emit: "{slot}/settings.json"
    assert:
      - type: file_parses
        path: "{slot}/settings.json"
        format: json

  test:
    policy: fail-fast      # or run-all
    actions:
      - name: health-check
        invoke:
          run: curl -sf http://localhost:{api_port}/health
        expect:
          exitCode: 0
        evidence:
          capture: stdout
      - name: isolation-proof
        invoke:
          http: "live-api/search?q=test-artifact"
        expect:
          count: 0

  teardown:
    provisioner: "docker compose -p my-app-test-{slot} down -v"
    assert:
      - type: containers_remaining
        count: 0
      - type: live_stack_unmodified
        value: true
      - type: live_data_test_artifacts_zero
        value: true
      - type: no_secret_residue
        value: true
    isolationChecks:
      liveStackUnmodified: true
      liveDataTestArtifactsZero: true
      noSecretResidue: true
```

---

## Template Variables

Manifest strings may contain `{var}` placeholders resolved by the runner at execution time:

| Variable    | Description                                                        |
|-------------|--------------------------------------------------------------------|
| `{slot}`    | Unique slot identifier for this run (namespaces docker resources). |
| `{workdir}` | Working directory for the cloned code.                             |
| `{src}`     | Source repository path.                                            |
| `{profile}` | Active run profile name (e.g., `laptop`, `cloud`).                |

---

## Supported Assertion Types

| Type                           | Description                                                     |
|--------------------------------|-----------------------------------------------------------------|
| `path_exists`                  | File or directory exists at the given path.                     |
| `cmd_exit_zero`                | Command exits with code 0.                                      |
| `containers_running`           | Exactly N containers are running in the docker project.         |
| `containers_remaining`         | Exactly N containers remain after teardown.                     |
| `ports_disjoint_from_live`     | No port conflicts with the live stack.                          |
| `docker_project_name`          | Docker project name matches the given pattern.                  |
| `file_parses`                  | File is valid JSON or YAML.                                     |
| `env_vars_present`             | All listed env var names are set (non-empty).                   |
| `live_stack_unmodified`        | Live stack still running and unmodified post-teardown.          |
| `live_data_test_artifacts_zero`| Live data contains zero test artifacts.                         |
| `no_secret_residue`            | No secret values in logs or temp files.                         |
| `mcp_names_suffixed`           | All MCP server names in the connection manifest carry a suffix. |
| `fully_projected_ports`        | All ports explicitly mapped (no wildcards).                     |
| `http_ok`                      | HTTP GET returns a 2xx status.                                  |

---

## Run Result / Event Log Format

The runner emits a machine-readable `RunResult` at the end of each run.
The format is corpus-ready: a future CI regression gate consumes it unchanged.

Key fields:

```jsonc
{
  "resultVersion": "testenv/v1/result",
  "verdict": "pass",           // pass | fail | skip | error
  "runClass": "green",         // red | green | regression | adhoc
  "repo": "my-app",
  "profile": "laptop",
  "commit": "abc123",
  "specVersion": "def456",     // commit hash of .testenv at run time
  "startedAt": "...",
  "endedAt": "...",
  "totalDurationMs": 300000,
  "phases": [...],             // per-phase results
  "actions": [...],            // per-action results (test phase)
  "events": [...]              // full structured event log
}
```

`runClass` supports the TDD red→green proof-of-work cycle:
- `red` — pre-implementation run (expected failures)
- `green` — post-implementation run (expected passes)
- `regression` — CI gate run against committed test suite
- `adhoc` — manual/exploratory run

---

## Usage

```typescript
import { validateManifest, assertManifest } from '@horus/testenv';
import { parse } from 'yaml';
import { readFileSync } from 'node:fs';

const raw = parse(readFileSync('.testenv/manifest.yaml', 'utf8'));

// Option 1: graceful error handling
const result = validateManifest(raw);
if (result.ok) {
  console.log('Valid manifest:', result.data);
} else {
  for (const err of result.errors) {
    console.error(`[${err.path}] ${err.message}`);
  }
}

// Option 2: fail-fast (throws on invalid)
const manifest = assertManifest(raw);
```

---

## Development

```bash
pnpm install
pnpm build    # tsup ESM build
pnpm test     # vitest unit tests
pnpm typecheck
```
