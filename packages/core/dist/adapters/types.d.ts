import type { ArtifactType, ArtifactBundle, ArtifactMeta } from '../models/index.js';
/**
 * Storage-agnostic interface for registry access.
 * Implementations can target filesystem, git, HTTP, etc.
 * @example
 * const adapter: DataAdapter = new FilesystemAdapter('./registry');
 * const skills = await adapter.list('skill');
 */
export interface DataAdapter {
    /**
     * List all artifacts of the given type.
     * Returns empty array (with warning) if directory missing.
     */
    list(type: ArtifactType): Promise<ArtifactMeta[]>;
    /**
     * Read a full artifact bundle (metadata + content).
     * @throws {ArtifactNotFoundError} if artifact doesn't exist
     */
    read(type: ArtifactType, id: string): Promise<ArtifactBundle>;
    /**
     * Check if an artifact exists without reading content.
     */
    exists(type: ArtifactType, id: string): Promise<boolean>;
    /**
     * Write an artifact to the store (for publishing).
     * Creates directories as needed.
     */
    write(type: ArtifactType, id: string, bundle: ArtifactBundle): Promise<void>;
    /**
     * Read a resource file from an artifact's directory by relative path.
     * Used for plugin resource files (e.g., resources/rules/global-rules.md).
     * Returns null if the file doesn't exist.
     * Optional — not all adapters support this.
     */
    readResourceFile?(type: ArtifactType, id: string, relativePath: string): Promise<string | null>;
}
//# sourceMappingURL=types.d.ts.map