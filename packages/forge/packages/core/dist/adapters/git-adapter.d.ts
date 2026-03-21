import type { DataAdapter } from './types.js';
import type { ArtifactType, ArtifactBundle, ArtifactMeta } from '../models/index.js';
/**
 * Configuration for a GitAdapter.
 *
 * @example
 * const config: GitAdapterConfig = {
 *   url: 'https://github.com/myorg/forge-registry.git',
 *   ref: 'main',
 *   registryPath: 'registry',
 * };
 */
export interface GitAdapterConfig {
    /** Git clone URL (HTTPS or SSH). */
    url: string;
    /** Branch, tag, or commit hash to checkout. Defaults to 'main'. */
    ref?: string;
    /** Subdirectory within the repo that contains the registry layout. Defaults to 'registry'. */
    registryPath?: string;
    /**
     * Directories to sparse-checkout. When set, only these paths are fetched.
     * @example ['skills/developer', 'agents/sdlc-agent']
     */
    sparse?: string[];
    /**
     * Base directory for the git cache.
     * Defaults to `~/.forge/cache/git/`.
     */
    cacheDir?: string;
    /**
     * Environment variable name that holds an HTTPS auth token.
     * When set, the adapter injects the token into the clone URL.
     * SSH keys are used by default when this is not set.
     */
    tokenEnv?: string;
}
/**
 * Git-based DataAdapter. Clones a remote repository and reads it
 * as a filesystem registry using {@link FilesystemAdapter}.
 *
 * On first access the repo is shallow-cloned into a local cache directory.
 * Subsequent accesses run `git fetch` + `git checkout` to update.
 *
 * @example
 * const adapter = new GitAdapter({
 *   url: 'https://github.com/myorg/registry.git',
 *   ref: 'main',
 * });
 * const skills = await adapter.list('skill');
 */
export declare class GitAdapter implements DataAdapter {
    private readonly url;
    private readonly ref;
    private readonly registryPath;
    private readonly sparse;
    private readonly cacheDir;
    private readonly tokenEnv;
    private delegate;
    private synced;
    constructor(config: GitAdapterConfig);
    /**
     * Returns the local cache directory path for this adapter.
     * Useful for debugging and testing.
     */
    getCacheDir(): string;
    list(type: ArtifactType): Promise<ArtifactMeta[]>;
    read(type: ArtifactType, id: string): Promise<ArtifactBundle>;
    exists(type: ArtifactType, id: string): Promise<boolean>;
    write(type: ArtifactType, id: string, bundle: ArtifactBundle): Promise<void>;
    /**
     * Ensure the repo is cloned/updated and return the FilesystemAdapter delegate.
     */
    private ensureCloned;
    private cacheExists;
    private resolveUrl;
    private cloneRepo;
    private fetchAndCheckout;
    private git;
}
//# sourceMappingURL=git-adapter.d.ts.map