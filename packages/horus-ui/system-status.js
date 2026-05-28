// Pure derivation of the system-status payload from raw probe results. Kept
// I/O-free so it is unit-testable; server.js performs the fetches and feeds the
// results in.

/**
 * @typedef {Object} Probe
 * @property {boolean} reachable  did the request complete
 * @property {number} [httpStatus]
 * @property {any} [body]         parsed JSON body (best-effort)
 */

/**
 * @param {Object} input
 * @param {Probe} input.anvilProbe
 * @param {boolean} input.controlPlaneConfigured
 * @param {Probe|null} input.controlPlaneProbe
 * @param {boolean} input.agentEnabled
 */
export function buildSystemStatus({ anvilProbe, controlPlaneConfigured, controlPlaneProbe, agentEnabled }) {
  // ── Anvil ──────────────────────────────────────────────────────────────────
  // 200 → connected; 503 → degraded (GitSyncEngine sync conflict / not ready);
  // unreachable → unreachable.
  let anvil;
  if (!anvilProbe.reachable) {
    anvil = { status: 'unreachable' };
  } else if (anvilProbe.httpStatus === 503) {
    const detail =
      anvilProbe.body?.detail ||
      anvilProbe.body?.error ||
      anvilProbe.body?.message ||
      'sync conflict — Anvil notes repo needs attention';
    anvil = { status: 'degraded', detail };
  } else if (anvilProbe.httpStatus >= 200 && anvilProbe.httpStatus < 300) {
    anvil = { status: 'connected' };
  } else {
    anvil = { status: 'unreachable', detail: `HTTP ${anvilProbe.httpStatus}` };
  }

  // ── Typesense / Neo4j ───────────────────────────────────────────────────────
  // Reported via Anvil: Anvil depends on both being healthy to be healthy, so a
  // connected Anvil implies they are up. If Anvil's health body exposes explicit
  // sub-statuses, prefer those. Otherwise infer from the Anvil state.
  const dep = (name) => {
    const sub = anvilProbe.body?.dependencies?.[name] || anvilProbe.body?.[name];
    if (sub && typeof sub === 'object' && typeof sub.status === 'string') return { status: sub.status };
    if (sub === 'ok' || sub === 'healthy' || sub === true) return { status: 'connected' };
    if (anvil.status === 'connected') return { status: 'connected' };
    if (anvil.status === 'degraded') return { status: 'unknown' };
    return { status: 'unreachable' };
  };
  const typesense = dep('typesense');
  const neo4j = dep('neo4j');

  // ── Control plane ────────────────────────────────────────────────────────────
  let control_plane;
  if (!controlPlaneConfigured) {
    control_plane = { status: 'not_configured' };
  } else if (controlPlaneProbe?.reachable && controlPlaneProbe.httpStatus >= 200 && controlPlaneProbe.httpStatus < 300) {
    control_plane = { status: 'connected' };
  } else {
    control_plane = { status: 'unreachable' };
  }

  const mode = controlPlaneConfigured ? 'connected' : 'local-only';

  // Remote-backed tabs require a control plane; in local-only they are surfaced
  // as "not configured" (the user can upgrade via Settings).
  const remoteTab = controlPlaneConfigured ? 'available' : 'not_configured';

  return {
    mode,
    services: { anvil, typesense, neo4j, control_plane },
    tabs: {
      anvil: 'available',
      vault: remoteTab,
      forge: remoteTab,
      admin: remoteTab,
    },
    agent_chat: { enabled: !!agentEnabled },
  };
}
