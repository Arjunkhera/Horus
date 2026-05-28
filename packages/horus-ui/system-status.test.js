import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemStatus } from './system-status.js';

test('local-only: control plane not configured, remote tabs not configured', () => {
  const s = buildSystemStatus({
    anvilProbe: { reachable: true, httpStatus: 200, body: {} },
    controlPlaneConfigured: false,
    controlPlaneProbe: null,
    agentEnabled: false,
  });
  assert.equal(s.mode, 'local-only');
  assert.equal(s.services.anvil.status, 'connected');
  assert.equal(s.services.typesense.status, 'connected');
  assert.equal(s.services.neo4j.status, 'connected');
  assert.equal(s.services.control_plane.status, 'not_configured');
  assert.equal(s.tabs.anvil, 'available');
  assert.equal(s.tabs.vault, 'not_configured');
  assert.equal(s.tabs.forge, 'not_configured');
  assert.equal(s.tabs.admin, 'not_configured');
  assert.equal(s.agent_chat.enabled, false);
});

test('connected: reachable control plane → tabs available', () => {
  const s = buildSystemStatus({
    anvilProbe: { reachable: true, httpStatus: 200, body: {} },
    controlPlaneConfigured: true,
    controlPlaneProbe: { reachable: true, httpStatus: 200 },
    agentEnabled: true,
  });
  assert.equal(s.mode, 'connected');
  assert.equal(s.services.control_plane.status, 'connected');
  assert.equal(s.tabs.vault, 'available');
  assert.equal(s.agent_chat.enabled, true);
});

test('connected but control plane unreachable', () => {
  const s = buildSystemStatus({
    anvilProbe: { reachable: true, httpStatus: 200, body: {} },
    controlPlaneConfigured: true,
    controlPlaneProbe: { reachable: false },
    agentEnabled: true,
  });
  assert.equal(s.mode, 'connected');
  assert.equal(s.services.control_plane.status, 'unreachable');
});

test('anvil degraded (503 GitSyncEngine conflict) surfaces detail', () => {
  const s = buildSystemStatus({
    anvilProbe: { reachable: true, httpStatus: 503, body: { detail: 'git sync conflict' } },
    controlPlaneConfigured: false,
    controlPlaneProbe: null,
    agentEnabled: false,
  });
  assert.equal(s.services.anvil.status, 'degraded');
  assert.equal(s.services.anvil.detail, 'git sync conflict');
  // deps unknown when anvil is degraded
  assert.equal(s.services.typesense.status, 'unknown');
});

test('anvil unreachable → deps unreachable', () => {
  const s = buildSystemStatus({
    anvilProbe: { reachable: false },
    controlPlaneConfigured: false,
    controlPlaneProbe: null,
    agentEnabled: false,
  });
  assert.equal(s.services.anvil.status, 'unreachable');
  assert.equal(s.services.typesense.status, 'unreachable');
  assert.equal(s.services.neo4j.status, 'unreachable');
});

test('explicit dependency sub-status in anvil health body is preferred', () => {
  const s = buildSystemStatus({
    anvilProbe: {
      reachable: true,
      httpStatus: 200,
      body: { dependencies: { typesense: { status: 'degraded' }, neo4j: 'ok' } },
    },
    controlPlaneConfigured: false,
    controlPlaneProbe: null,
    agentEnabled: false,
  });
  assert.equal(s.services.typesense.status, 'degraded');
  assert.equal(s.services.neo4j.status, 'connected');
});
