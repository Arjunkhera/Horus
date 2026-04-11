import { promises as fs } from 'fs';
import path from 'path';
import { loadGlobalConfig } from '../config/global-config-loader.js';
import { expandPath } from '../config/path-utils.js';
import { WorkspaceMetadataStore } from './workspace-metadata-store.js';
import { emitReadGuardHook } from './mcp-settings-writer.js';

/**
 * Run startup migrations for all registered SDLC workspaces.
 *
 * Currently runs one migration:
 *   - read-guard: emits guard-source-reads.sh and the Read|Glob|Grep PreToolUse hook
 *     to any workspace that is missing the script. Introduced in story 086eedcb;
 *     this migration back-fills it for workspaces created before that feature shipped.
 *
 * The function is idempotent: the existence of guard-source-reads.sh acts as a
 * sentinel — if the file is already present the workspace is skipped.
 *
 * @param globalConfigPath  Optional path to forge.yaml (defaults to the standard location).
 */
export async function runStartupMigrations(globalConfigPath?: string): Promise<void> {
  try {
    await migrateReadGuardHook(globalConfigPath);
  } catch (err: any) {
    // Migrations must never crash the server — log and continue.
    process.stderr.write(
      JSON.stringify({
        level: 'warn',
        message: '[Forge] Startup migration failed',
        error: err?.message ?? String(err),
        timestamp: new Date().toISOString(),
      }) + '\n',
    );
  }
}

/**
 * For every active workspace that is missing guard-source-reads.sh, call
 * emitReadGuardHook() to write the script and register the hook.
 */
async function migrateReadGuardHook(globalConfigPath?: string): Promise<void> {
  const globalConfig = await loadGlobalConfig(globalConfigPath);

  const mountPath = expandPath(globalConfig.workspace.mount_path);
  const hostMountPath = globalConfig.workspace.host_workspaces_path
    ? globalConfig.workspace.host_workspaces_path
    : mountPath;

  const metaStore = new WorkspaceMetadataStore(globalConfig.workspace.store_path);
  const workspaces = await metaStore.list({ status: 'active' });

  for (const ws of workspaces) {
    const guardScript = path.join(ws.path, '.claude', 'scripts', 'guard-source-reads.sh');

    let missing = false;
    try {
      await fs.access(guardScript);
    } catch {
      missing = true;
    }

    if (!missing) {
      continue;
    }

    // Derive the host-side workspace path from the workspace name.
    const hostWorkspacePath = path.join(hostMountPath, ws.name);

    try {
      await emitReadGuardHook(ws.path, hostWorkspacePath);
      process.stderr.write(
        JSON.stringify({
          level: 'info',
          message: '[Forge] Migration: emitted read guard hook',
          workspace: ws.name,
          workspaceId: ws.id,
          timestamp: new Date().toISOString(),
        }) + '\n',
      );
    } catch (err: any) {
      process.stderr.write(
        JSON.stringify({
          level: 'warn',
          message: '[Forge] Migration: failed to emit read guard hook',
          workspace: ws.name,
          workspaceId: ws.id,
          error: err?.message ?? String(err),
          timestamp: new Date().toISOString(),
        }) + '\n',
      );
    }
  }
}
