import type { DataAdapter } from './types.js';
import type { ArtifactType, ArtifactBundle, ArtifactMeta } from '../models/index.js';
/**
 * Filesystem-based DataAdapter. Reads artifacts from a local directory tree.
 *
 * Expected layout:
 *   {root}/skills/{id}/metadata.yaml + SKILL.md
 *   {root}/agents/{id}/metadata.yaml + AGENT.md
 *   {root}/plugins/{id}/metadata.yaml
 *   {root}/workspace-configs/{id}/metadata.yaml + WORKSPACE.md (optional)
 *
 * @example
 * const adapter = new FilesystemAdapter('./registry');
 * const skills = await adapter.list('skill');
 */
export declare class FilesystemAdapter implements DataAdapter {
    private readonly root;
    constructor(root: string);
    private typeDir;
    private artifactDir;
    list(type: ArtifactType): Promise<ArtifactMeta[]>;
    read(type: ArtifactType, id: string): Promise<ArtifactBundle>;
    exists(type: ArtifactType, id: string): Promise<boolean>;
    write(type: ArtifactType, id: string, bundle: ArtifactBundle): Promise<void>;
    readResourceFile(type: ArtifactType, id: string, relativePath: string): Promise<string | null>;
}
//# sourceMappingURL=filesystem-adapter.d.ts.map