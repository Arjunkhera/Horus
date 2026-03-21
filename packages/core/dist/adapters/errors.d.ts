/**
 * Base error for all Forge errors.
 */
export declare class ForgeError extends Error {
    readonly code: string;
    readonly suggestion?: string | undefined;
    readonly filePath?: string | undefined;
    constructor(code: string, message: string, suggestion?: string | undefined, filePath?: string | undefined);
}
/**
 * Thrown when an artifact cannot be found in the registry.
 */
export declare class ArtifactNotFoundError extends ForgeError {
    constructor(type: string, id: string, registryPath?: string);
}
/**
 * Thrown when metadata fails validation or cannot be parsed.
 */
export declare class InvalidMetadataError extends ForgeError {
    constructor(filePath: string, detail: string);
}
/**
 * Thrown when a circular dependency is detected.
 */
export declare class CircularDependencyError extends ForgeError {
    constructor(cycle: string[]);
}
/**
 * Thrown when a version constraint cannot be satisfied.
 */
export declare class VersionMismatchError extends ForgeError {
    constructor(id: string, requested: string, available: string[]);
}
/**
 * Thrown when a DataAdapter encounters an error during operation.
 * Used by CompositeAdapter to wrap and report failures across multiple sources.
 *
 * @example
 * throw new AdapterError('git-registry', 'Clone failed: repository not found', 'Check the registry URL in forge.yaml');
 */
export declare class AdapterError extends ForgeError {
    constructor(adapterName: string, detail: string, suggestion?: string);
}
/**
 * Thrown when all adapters in a CompositeAdapter fail to find an artifact.
 *
 * @example
 * throw new AllAdaptersFailedError('skill', 'developer', ['local', 'git-remote']);
 */
export declare class AllAdaptersFailedError extends ForgeError {
    constructor(type: string, id: string, sourcesTried: string[]);
}
/**
 * Thrown when a compiler target is not supported.
 */
export declare class UnsupportedTargetError extends ForgeError {
    constructor(target: string);
}
//# sourceMappingURL=errors.d.ts.map