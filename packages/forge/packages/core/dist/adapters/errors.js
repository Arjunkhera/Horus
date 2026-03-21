"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UnsupportedTargetError = exports.AllAdaptersFailedError = exports.AdapterError = exports.VersionMismatchError = exports.CircularDependencyError = exports.InvalidMetadataError = exports.ArtifactNotFoundError = exports.ForgeError = void 0;
/**
 * Base error for all Forge errors.
 */
class ForgeError extends Error {
    code;
    suggestion;
    filePath;
    constructor(code, message, suggestion, filePath) {
        super(message);
        this.code = code;
        this.suggestion = suggestion;
        this.filePath = filePath;
        this.name = 'ForgeError';
    }
}
exports.ForgeError = ForgeError;
/**
 * Thrown when an artifact cannot be found in the registry.
 */
class ArtifactNotFoundError extends ForgeError {
    constructor(type, id, registryPath) {
        super('ARTIFACT_NOT_FOUND', `Artifact '${type}:${id}' was not found in the registry`, `Run 'forge search ${id}' to find available artifacts, or check that the registry path is correct`, registryPath);
        this.name = 'ArtifactNotFoundError';
    }
}
exports.ArtifactNotFoundError = ArtifactNotFoundError;
/**
 * Thrown when metadata fails validation or cannot be parsed.
 */
class InvalidMetadataError extends ForgeError {
    constructor(filePath, detail) {
        super('INVALID_METADATA', `Invalid metadata in ${filePath}: ${detail}`, `Check that ${filePath} is valid YAML and matches the expected schema`, filePath);
        this.name = 'InvalidMetadataError';
    }
}
exports.InvalidMetadataError = InvalidMetadataError;
/**
 * Thrown when a circular dependency is detected.
 */
class CircularDependencyError extends ForgeError {
    constructor(cycle) {
        super('CIRCULAR_DEPENDENCY', `Circular dependency detected: ${cycle.join(' → ')}`, 'Remove or break the circular dependency chain in your artifact definitions');
        this.name = 'CircularDependencyError';
    }
}
exports.CircularDependencyError = CircularDependencyError;
/**
 * Thrown when a version constraint cannot be satisfied.
 */
class VersionMismatchError extends ForgeError {
    constructor(id, requested, available) {
        super('VERSION_MISMATCH', `No version of '${id}' satisfies '${requested}'. Available: ${available.join(', ')}`, `Update forge.yaml to use a compatible version range, or upgrade the artifact in the registry`);
        this.name = 'VersionMismatchError';
    }
}
exports.VersionMismatchError = VersionMismatchError;
/**
 * Thrown when a DataAdapter encounters an error during operation.
 * Used by CompositeAdapter to wrap and report failures across multiple sources.
 *
 * @example
 * throw new AdapterError('git-registry', 'Clone failed: repository not found', 'Check the registry URL in forge.yaml');
 */
class AdapterError extends ForgeError {
    constructor(adapterName, detail, suggestion) {
        super('ADAPTER_ERROR', `Adapter '${adapterName}' failed: ${detail}`, suggestion ?? `Check that the '${adapterName}' registry is accessible and properly configured`);
        this.name = 'AdapterError';
    }
}
exports.AdapterError = AdapterError;
/**
 * Thrown when all adapters in a CompositeAdapter fail to find an artifact.
 *
 * @example
 * throw new AllAdaptersFailedError('skill', 'developer', ['local', 'git-remote']);
 */
class AllAdaptersFailedError extends ForgeError {
    constructor(type, id, sourcesTried) {
        super('ALL_ADAPTERS_FAILED', `Artifact '${type}:${id}' not found in any registry. Sources tried: ${sourcesTried.join(', ')}`, `Run 'forge search ${id}' to check availability, or add a registry that contains this artifact`);
        this.name = 'AllAdaptersFailedError';
    }
}
exports.AllAdaptersFailedError = AllAdaptersFailedError;
/**
 * Thrown when a compiler target is not supported.
 */
class UnsupportedTargetError extends ForgeError {
    constructor(target) {
        super('UNSUPPORTED_TARGET', `Compiler target '${target}' is not supported`, `Supported targets: claude-code, cursor, plugin. Check forge.yaml 'target' field`);
        this.name = 'UnsupportedTargetError';
    }
}
exports.UnsupportedTargetError = UnsupportedTargetError;
//# sourceMappingURL=errors.js.map