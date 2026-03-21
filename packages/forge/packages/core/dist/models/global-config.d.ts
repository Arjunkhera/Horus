import { z } from 'zod';
/**
 * Workspace settings section.
 */
export declare const WorkspaceSettingsSchema: z.ZodObject<{
    mount_path: z.ZodDefault<z.ZodString>;
    default_config: z.ZodDefault<z.ZodString>;
    retention_days: z.ZodDefault<z.ZodNumber>;
    /**
     * Host-side absolute path for the workspaces directory.
     * Only needed when Forge runs inside Docker and the workspaces volume is
     * bind-mounted from the host (e.g., ${HORUS_DATA_PATH}/workspaces).
     * Used to emit correct absolute paths into .claude/settings.local.json
     * so Claude Code on the host can resolve the wrapper script and URLs.
     */
    /**
     * Path to the workspace metadata store file (workspaces.json).
     * Defaults to ~/.forge/workspaces.json (suitable for standalone/host use).
     * Override to a volume-mounted path when running in Docker so metadata
     * survives container restarts (e.g., /data/workspaces/workspaces.json).
     */
    store_path: z.ZodDefault<z.ZodString>;
    host_workspaces_path: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    mount_path: string;
    default_config: string;
    retention_days: number;
    store_path: string;
    host_workspaces_path?: string | undefined;
}, {
    mount_path?: string | undefined;
    default_config?: string | undefined;
    retention_days?: number | undefined;
    store_path?: string | undefined;
    host_workspaces_path?: string | undefined;
}>;
export type WorkspaceSettings = z.infer<typeof WorkspaceSettingsSchema>;
/**
 * MCP endpoint entry.
 */
export declare const McpEndpointSchema: z.ZodObject<{
    url: z.ZodString;
    transport: z.ZodDefault<z.ZodEnum<["http", "stdio"]>>;
}, "strip", z.ZodTypeAny, {
    url: string;
    transport: "http" | "stdio";
}, {
    url: string;
    transport?: "http" | "stdio" | undefined;
}>;
export type McpEndpoint = z.infer<typeof McpEndpointSchema>;
/**
 * MCP endpoints section (maps endpoint names to their configurations).
 */
export declare const McpEndpointsSchema: z.ZodObject<{
    anvil: z.ZodOptional<z.ZodObject<{
        url: z.ZodString;
        transport: z.ZodDefault<z.ZodEnum<["http", "stdio"]>>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        transport: "http" | "stdio";
    }, {
        url: string;
        transport?: "http" | "stdio" | undefined;
    }>>;
    vault: z.ZodOptional<z.ZodObject<{
        url: z.ZodString;
        transport: z.ZodDefault<z.ZodEnum<["http", "stdio"]>>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        transport: "http" | "stdio";
    }, {
        url: string;
        transport?: "http" | "stdio" | undefined;
    }>>;
    forge: z.ZodOptional<z.ZodObject<{
        url: z.ZodString;
        transport: z.ZodDefault<z.ZodEnum<["http", "stdio"]>>;
    }, "strip", z.ZodTypeAny, {
        url: string;
        transport: "http" | "stdio";
    }, {
        url: string;
        transport?: "http" | "stdio" | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    anvil?: {
        url: string;
        transport: "http" | "stdio";
    } | undefined;
    vault?: {
        url: string;
        transport: "http" | "stdio";
    } | undefined;
    forge?: {
        url: string;
        transport: "http" | "stdio";
    } | undefined;
}, {
    anvil?: {
        url: string;
        transport?: "http" | "stdio" | undefined;
    } | undefined;
    vault?: {
        url: string;
        transport?: "http" | "stdio" | undefined;
    } | undefined;
    forge?: {
        url: string;
        transport?: "http" | "stdio" | undefined;
    } | undefined;
}>;
export type McpEndpoints = z.infer<typeof McpEndpointsSchema>;
/**
 * Host-facing MCP endpoints — the URLs Claude Code on the host machine uses
 * to reach MCP servers. Separate from mcp_endpoints (which holds container-
 * internal URLs when Forge runs in Docker).
 *
 * Set via FORGE_HOST_*_URL environment variables in docker-compose.
 */
export declare const HostEndpointsSchema: z.ZodObject<{
    anvil: z.ZodOptional<z.ZodString>;
    vault: z.ZodOptional<z.ZodString>;
    forge: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    anvil?: string | undefined;
    vault?: string | undefined;
    forge?: string | undefined;
}, {
    anvil?: string | undefined;
    vault?: string | undefined;
    forge?: string | undefined;
}>;
export type HostEndpoints = z.infer<typeof HostEndpointsSchema>;
/**
 * Repository configuration section.
 */
export declare const ReposConfigSchema: z.ZodObject<{
    scan_paths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    index_path: z.ZodDefault<z.ZodString>;
    /**
     * Host-side absolute path corresponding to the first scan_path.
     * Only needed when Forge runs inside Docker and the repos directory is
     * bind-mounted from the host (e.g., ${HOST_REPOS_PATH}:/data/repos).
     * When set, localPath in repo results is translated from the container
     * path to the equivalent host path so callers can access repos directly.
     */
    host_repos_path: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    scan_paths: string[];
    index_path: string;
    host_repos_path?: string | undefined;
}, {
    scan_paths?: string[] | undefined;
    index_path?: string | undefined;
    host_repos_path?: string | undefined;
}>;
export type ReposConfig = z.infer<typeof ReposConfigSchema>;
/**
 * Schema for the global Forge configuration (~/.forge/config.yaml).
 *
 * Global registries act as fallbacks — workspace-local registries
 * take priority, and global registries are appended as lower-priority
 * sources.
 *
 * @example
 * # ~/.forge/config.yaml
 * registries:
 *   - type: git
 *     name: team-registry
 *     url: https://github.com/myorg/forge-registry.git
 *     branch: main
 *     path: registry
 *
 * workspace:
 *   mount_path: ~/workspaces
 *   default_config: sdlc-default
 *   retention_days: 30
 *   host_workspaces_path: /Users/me/horus-data/workspaces  # host-side path (Docker only)
 *
 * mcp_endpoints:
 *   anvil:
 *     url: http://anvil:8100   # container-internal
 *     transport: http
 *
 * host_endpoints:              # host-facing ports (Docker only)
 *   anvil: http://localhost:8100
 *   vault: http://localhost:8300
 *   forge: http://localhost:8200
 *
 * repos:
 *   scan_paths:
 *     - ~/Repositories
 *   index_path: ~/.forge/repos.json
 */
/**
 * Tracks a globally installed plugin.
 */
export declare const GlobalPluginEntrySchema: z.ZodObject<{
    version: z.ZodString;
    installed_at: z.ZodString;
    files: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    version: string;
    files: string[];
    installed_at: string;
}, {
    version: string;
    installed_at: string;
    files?: string[] | undefined;
}>;
export type GlobalPluginEntry = z.infer<typeof GlobalPluginEntrySchema>;
/**
 * Claude Code permissions to write into workspace settings.local.json.
 * Prevents the local file from shadowing the user's global ~/.claude/settings.json
 * permissions (Claude Code treats local settings as authoritative when present).
 */
export declare const ClaudePermissionsSchema: z.ZodObject<{
    allow: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    deny: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    allow: string[];
    deny: string[];
}, {
    allow?: string[] | undefined;
    deny?: string[] | undefined;
}>;
export type ClaudePermissions = z.infer<typeof ClaudePermissionsSchema>;
export declare const GlobalConfigSchema: z.ZodObject<{
    registries: z.ZodDefault<z.ZodArray<z.ZodDiscriminatedUnion<"type", [z.ZodObject<{
        type: z.ZodLiteral<"filesystem">;
        name: z.ZodString;
        path: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: "filesystem";
        path: string;
    }, {
        name: string;
        type: "filesystem";
        path: string;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"git">;
        name: z.ZodString;
        url: z.ZodString;
        branch: z.ZodDefault<z.ZodString>;
        path: z.ZodDefault<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: "git";
        path: string;
        url: string;
        branch: string;
    }, {
        name: string;
        type: "git";
        url: string;
        path?: string | undefined;
        branch?: string | undefined;
    }>, z.ZodObject<{
        type: z.ZodLiteral<"http">;
        name: z.ZodString;
        url: z.ZodString;
        token: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        type: "http";
        url: string;
        token?: string | undefined;
    }, {
        name: string;
        type: "http";
        url: string;
        token?: string | undefined;
    }>]>, "many">>;
    workspace: z.ZodDefault<z.ZodObject<{
        mount_path: z.ZodDefault<z.ZodString>;
        default_config: z.ZodDefault<z.ZodString>;
        retention_days: z.ZodDefault<z.ZodNumber>;
        /**
         * Host-side absolute path for the workspaces directory.
         * Only needed when Forge runs inside Docker and the workspaces volume is
         * bind-mounted from the host (e.g., ${HORUS_DATA_PATH}/workspaces).
         * Used to emit correct absolute paths into .claude/settings.local.json
         * so Claude Code on the host can resolve the wrapper script and URLs.
         */
        /**
         * Path to the workspace metadata store file (workspaces.json).
         * Defaults to ~/.forge/workspaces.json (suitable for standalone/host use).
         * Override to a volume-mounted path when running in Docker so metadata
         * survives container restarts (e.g., /data/workspaces/workspaces.json).
         */
        store_path: z.ZodDefault<z.ZodString>;
        host_workspaces_path: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        mount_path: string;
        default_config: string;
        retention_days: number;
        store_path: string;
        host_workspaces_path?: string | undefined;
    }, {
        mount_path?: string | undefined;
        default_config?: string | undefined;
        retention_days?: number | undefined;
        store_path?: string | undefined;
        host_workspaces_path?: string | undefined;
    }>>;
    mcp_endpoints: z.ZodDefault<z.ZodObject<{
        anvil: z.ZodOptional<z.ZodObject<{
            url: z.ZodString;
            transport: z.ZodDefault<z.ZodEnum<["http", "stdio"]>>;
        }, "strip", z.ZodTypeAny, {
            url: string;
            transport: "http" | "stdio";
        }, {
            url: string;
            transport?: "http" | "stdio" | undefined;
        }>>;
        vault: z.ZodOptional<z.ZodObject<{
            url: z.ZodString;
            transport: z.ZodDefault<z.ZodEnum<["http", "stdio"]>>;
        }, "strip", z.ZodTypeAny, {
            url: string;
            transport: "http" | "stdio";
        }, {
            url: string;
            transport?: "http" | "stdio" | undefined;
        }>>;
        forge: z.ZodOptional<z.ZodObject<{
            url: z.ZodString;
            transport: z.ZodDefault<z.ZodEnum<["http", "stdio"]>>;
        }, "strip", z.ZodTypeAny, {
            url: string;
            transport: "http" | "stdio";
        }, {
            url: string;
            transport?: "http" | "stdio" | undefined;
        }>>;
    }, "strip", z.ZodTypeAny, {
        anvil?: {
            url: string;
            transport: "http" | "stdio";
        } | undefined;
        vault?: {
            url: string;
            transport: "http" | "stdio";
        } | undefined;
        forge?: {
            url: string;
            transport: "http" | "stdio";
        } | undefined;
    }, {
        anvil?: {
            url: string;
            transport?: "http" | "stdio" | undefined;
        } | undefined;
        vault?: {
            url: string;
            transport?: "http" | "stdio" | undefined;
        } | undefined;
        forge?: {
            url: string;
            transport?: "http" | "stdio" | undefined;
        } | undefined;
    }>>;
    host_endpoints: z.ZodOptional<z.ZodObject<{
        anvil: z.ZodOptional<z.ZodString>;
        vault: z.ZodOptional<z.ZodString>;
        forge: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        anvil?: string | undefined;
        vault?: string | undefined;
        forge?: string | undefined;
    }, {
        anvil?: string | undefined;
        vault?: string | undefined;
        forge?: string | undefined;
    }>>;
    repos: z.ZodDefault<z.ZodObject<{
        scan_paths: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        index_path: z.ZodDefault<z.ZodString>;
        /**
         * Host-side absolute path corresponding to the first scan_path.
         * Only needed when Forge runs inside Docker and the repos directory is
         * bind-mounted from the host (e.g., ${HOST_REPOS_PATH}:/data/repos).
         * When set, localPath in repo results is translated from the container
         * path to the equivalent host path so callers can access repos directly.
         */
        host_repos_path: z.ZodOptional<z.ZodString>;
    }, "strip", z.ZodTypeAny, {
        scan_paths: string[];
        index_path: string;
        host_repos_path?: string | undefined;
    }, {
        scan_paths?: string[] | undefined;
        index_path?: string | undefined;
        host_repos_path?: string | undefined;
    }>>;
    global_plugins: z.ZodDefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        version: z.ZodString;
        installed_at: z.ZodString;
        files: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        version: string;
        files: string[];
        installed_at: string;
    }, {
        version: string;
        installed_at: string;
        files?: string[] | undefined;
    }>>>;
    claude_permissions: z.ZodDefault<z.ZodObject<{
        allow: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
        deny: z.ZodDefault<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        allow: string[];
        deny: string[];
    }, {
        allow?: string[] | undefined;
        deny?: string[] | undefined;
    }>>;
}, "strip", z.ZodTypeAny, {
    registries: ({
        name: string;
        type: "filesystem";
        path: string;
    } | {
        name: string;
        type: "git";
        path: string;
        url: string;
        branch: string;
    } | {
        name: string;
        type: "http";
        url: string;
        token?: string | undefined;
    })[];
    workspace: {
        mount_path: string;
        default_config: string;
        retention_days: number;
        store_path: string;
        host_workspaces_path?: string | undefined;
    };
    mcp_endpoints: {
        anvil?: {
            url: string;
            transport: "http" | "stdio";
        } | undefined;
        vault?: {
            url: string;
            transport: "http" | "stdio";
        } | undefined;
        forge?: {
            url: string;
            transport: "http" | "stdio";
        } | undefined;
    };
    repos: {
        scan_paths: string[];
        index_path: string;
        host_repos_path?: string | undefined;
    };
    global_plugins: Record<string, {
        version: string;
        files: string[];
        installed_at: string;
    }>;
    claude_permissions: {
        allow: string[];
        deny: string[];
    };
    host_endpoints?: {
        anvil?: string | undefined;
        vault?: string | undefined;
        forge?: string | undefined;
    } | undefined;
}, {
    registries?: ({
        name: string;
        type: "filesystem";
        path: string;
    } | {
        name: string;
        type: "git";
        url: string;
        path?: string | undefined;
        branch?: string | undefined;
    } | {
        name: string;
        type: "http";
        url: string;
        token?: string | undefined;
    })[] | undefined;
    workspace?: {
        mount_path?: string | undefined;
        default_config?: string | undefined;
        retention_days?: number | undefined;
        store_path?: string | undefined;
        host_workspaces_path?: string | undefined;
    } | undefined;
    mcp_endpoints?: {
        anvil?: {
            url: string;
            transport?: "http" | "stdio" | undefined;
        } | undefined;
        vault?: {
            url: string;
            transport?: "http" | "stdio" | undefined;
        } | undefined;
        forge?: {
            url: string;
            transport?: "http" | "stdio" | undefined;
        } | undefined;
    } | undefined;
    host_endpoints?: {
        anvil?: string | undefined;
        vault?: string | undefined;
        forge?: string | undefined;
    } | undefined;
    repos?: {
        scan_paths?: string[] | undefined;
        index_path?: string | undefined;
        host_repos_path?: string | undefined;
    } | undefined;
    global_plugins?: Record<string, {
        version: string;
        installed_at: string;
        files?: string[] | undefined;
    }> | undefined;
    claude_permissions?: {
        allow?: string[] | undefined;
        deny?: string[] | undefined;
    } | undefined;
}>;
export type GlobalConfig = z.infer<typeof GlobalConfigSchema>;
//# sourceMappingURL=global-config.d.ts.map