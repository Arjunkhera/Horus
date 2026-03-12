import type { Runtime } from './runtime.js';
import type { ServiceName } from './constants.js';
import { SERVICES } from './constants.js';

// ── Types ───────────────────────────────────────────────────────────────────

export interface ServiceHealth {
  name: ServiceName;
  status: 'healthy' | 'starting' | 'unhealthy' | 'stopped' | 'unknown';
}

// ── Health check polling ────────────────────────────────────────────────────

/**
 * Check the health status of a single container.
 *
 * Podman may not populate .State.Health when no HEALTHCHECK is defined, so we
 * fall back to .State.Status ("running") which is always present.  Container
 * naming also varies between runtimes / compose versions (horus-svc-1 vs
 * horus_svc_1), so we try both conventions.
 */
async function checkContainerHealth(
  runtime: Runtime,
  service: ServiceName
): Promise<ServiceHealth> {
  // Try both naming conventions: Docker Compose v2 uses hyphens, older
  // podman-compose uses underscores.
  const candidates = [`horus-${service}-1`, `horus_${service}_1`];

  for (const containerName of candidates) {
    try {
      // 1. Try the HEALTHCHECK status first (populated by Docker, and by
      //    Podman when a HEALTHCHECK is defined).
      const healthStatus = await runtime.inspect(containerName, '{{.State.Health.Status}}');
      if (healthStatus && !healthStatus.includes('<nil>') && healthStatus.trim() !== '') {
        return { name: service, status: mapStatus(healthStatus) };
      }

      // 2. Fall back to container state — this is always present on both
      //    Docker and Podman and returns "running", "exited", etc.
      const stateStatus = await runtime.inspect(containerName, '{{.State.Status}}');
      if (stateStatus && stateStatus.trim() !== '') {
        return { name: service, status: mapStateStatus(stateStatus) };
      }
    } catch {
      // Container with this name doesn't exist — try next candidate.
      continue;
    }
  }

  return { name: service, status: 'stopped' };
}

function mapStatus(raw: string): ServiceHealth['status'] {
  switch (raw.trim().toLowerCase()) {
    case 'healthy':
      return 'healthy';
    case 'starting':
      return 'starting';
    case 'unhealthy':
      return 'unhealthy';
    default:
      return 'unknown';
  }
}

/**
 * Map a container .State.Status value (used as a fallback when no HEALTHCHECK
 * is present, which is the common case on Podman).
 */
function mapStateStatus(raw: string): ServiceHealth['status'] {
  switch (raw.trim().toLowerCase()) {
    case 'running':
      return 'healthy';
    case 'created':
    case 'restarting':
      return 'starting';
    case 'exited':
    case 'dead':
    case 'removing':
      return 'unhealthy';
    default:
      return 'unknown';
  }
}

/**
 * Check the health of all Horus services.
 */
export async function checkAllHealth(runtime: Runtime): Promise<ServiceHealth[]> {
  const results = await Promise.all(
    SERVICES.map((service) => checkContainerHealth(runtime, service))
  );
  return results;
}

/**
 * Poll until all services are healthy or a timeout is reached.
 *
 * @param runtime - Container runtime
 * @param onUpdate - Callback invoked with current health states on each poll cycle
 * @param timeoutMs - Maximum time to wait (default: 600000ms = 10 minutes)
 * @param intervalMs - Polling interval (default: 5000ms = 5 seconds)
 * @returns Final health states of all services
 * @throws If timeout is reached before all services are healthy
 */
export async function pollUntilHealthy(
  runtime: Runtime,
  onUpdate?: (states: ServiceHealth[]) => void,
  timeoutMs: number = 300_000,
  intervalMs: number = 5_000
): Promise<ServiceHealth[]> {
  const startTime = Date.now();

  while (true) {
    const states = await checkAllHealth(runtime);

    if (onUpdate) {
      onUpdate(states);
    }

    const allHealthy = states.every((s) => s.status === 'healthy');
    if (allHealthy) {
      return states;
    }

    const hasUnhealthy = states.some((s) => s.status === 'unhealthy');
    if (hasUnhealthy) {
      const unhealthyServices = states
        .filter((s) => s.status === 'unhealthy')
        .map((s) => s.name)
        .join(', ');
      throw new Error(
        `Services failed health check: ${unhealthyServices}\n` +
          `Run '${runtime.name} compose logs <service>' from ~/.horus/ to investigate.`
      );
    }

    const elapsed = Date.now() - startTime;
    if (elapsed >= timeoutMs) {
      const notReady = states
        .filter((s) => s.status !== 'healthy')
        .map((s) => `${s.name} (${s.status})`)
        .join(', ');
      throw new Error(
        `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for services: ${notReady}\n` +
          `Run '${runtime.name} compose logs' from ~/.horus/ to investigate.`
      );
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
