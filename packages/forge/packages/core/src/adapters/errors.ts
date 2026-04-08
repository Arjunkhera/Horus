/**
 * Base error for all Forge errors.
 */
export class ForgeError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly suggestion?: string,
    public readonly filePath?: string,
  ) {
    super(message);
    this.name = 'ForgeError';
  }
}

/**
 * Thrown when an artifact cannot be found in the registry.
 */
export class ArtifactNotFoundError extends ForgeError {
  constructor(type: string, id: string, registryPath?: string) {
    super(
      'ARTIFACT_NOT_FOUND',
      `Artifact '${type}:${id}' was not found in the registry`,
      `Run 'forge search ${id}' to find available artifacts, or check that the registry path is correct`,
      registryPath,
    );
    this.name = 'ArtifactNotFoundError';
  }
}

/**
 * Thrown when metadata fails validation or cannot be parsed.
 */
export class InvalidMetadataError extends ForgeError {
  constructor(filePath: string, detail: string) {
    super(
      'INVALID_METADATA',
      `Invalid metadata in ${filePath}: ${detail}`,
      `Check that ${filePath} is valid YAML and matches the expected schema`,
      filePath,
    );
    this.name = 'InvalidMetadataError';
  }
}

/**
 * Thrown when a circular dependency is detected.
 */
export class CircularDependencyError extends ForgeError {
  constructor(cycle: string[]) {
    super(
      'CIRCULAR_DEPENDENCY',
      `Circular dependency detected: ${cycle.join(' → ')}`,
      'Remove or break the circular dependency chain in your artifact definitions',
    );
    this.name = 'CircularDependencyError';
  }
}

/**
 * Thrown when a version constraint cannot be satisfied.
 */
export class VersionMismatchError extends ForgeError {
  constructor(id: string, requested: string, available: string[]) {
    super(
      'VERSION_MISMATCH',
      `No version of '${id}' satisfies '${requested}'. Available: ${available.join(', ')}`,
      `Update forge.yaml to use a compatible version range, or upgrade the artifact in the registry`,
    );
    this.name = 'VersionMismatchError';
  }
}

/**
 * Thrown when a DataAdapter encounters an error during operation.
 * Used by CompositeAdapter to wrap and report failures across multiple sources.
 *
 * @example
 * throw new AdapterError('git-registry', 'Clone failed: repository not found', 'Check the registry URL in forge.yaml');
 */
export class AdapterError extends ForgeError {
  constructor(adapterName: string, detail: string, suggestion?: string) {
    super(
      'ADAPTER_ERROR',
      `Adapter '${adapterName}' failed: ${detail}`,
      suggestion ?? `Check that the '${adapterName}' registry is accessible and properly configured`,
    );
    this.name = 'AdapterError';
  }
}

/**
 * Thrown when all adapters in a CompositeAdapter fail to find an artifact.
 *
 * @example
 * throw new AllAdaptersFailedError('skill', 'developer', ['local', 'git-remote']);
 */
export class AllAdaptersFailedError extends ForgeError {
  constructor(type: string, id: string, sourcesTried: string[]) {
    super(
      'ALL_ADAPTERS_FAILED',
      `Artifact '${type}:${id}' not found in any registry. Sources tried: ${sourcesTried.join(', ')}`,
      `Run 'forge search ${id}' to check availability, or add a registry that contains this artifact`,
    );
    this.name = 'AllAdaptersFailedError';
  }
}

/**
 * Thrown when a workspace-config tries to extend a parent that itself extends another config.
 * Multi-level workspace inheritance is not supported (single-level only).
 */
export class InheritanceDepthError extends ForgeError {
  constructor(parent: string, grandparent: string) {
    super(
      'INHERITANCE_DEPTH',
      `Multi-level workspace inheritance is not supported. '${parent}' also extends '${grandparent}'.`,
      'Remove the extends field from the parent workspace-config, or flatten the inheritance chain',
    );
    this.name = 'InheritanceDepthError';
  }
}

/**
 * Thrown when a compiler target is not supported.
 */
export class UnsupportedTargetError extends ForgeError {
  constructor(target: string) {
    super(
      'UNSUPPORTED_TARGET',
      `Compiler target '${target}' is not supported`,
      `Supported targets: claude-code, cursor, plugin. Check forge.yaml 'target' field`,
    );
    this.name = 'UnsupportedTargetError';
  }
}

/**
 * Thrown when attempting to publish a version that already exists.
 */
export class VersionConflictError extends ForgeError {
  constructor(type: string, id: string, version: string) {
    super(
      'VERSION_CONFLICT',
      `Version '${version}' of '${type}:${id}' already exists in the registry`,
      `Bump the version in metadata.yaml before publishing, or use a different version identifier`,
    );
    this.name = 'VersionConflictError';
  }
}

/**
 * Thrown when a publish operation fails due to missing or insufficient auth credentials.
 */
export class PublishAuthError extends ForgeError {
  constructor(detail: string) {
    super(
      'PUBLISH_AUTH_ERROR',
      `Publish authentication failed: ${detail}`,
      `Ensure the tokenEnv config points to a valid environment variable containing a token with write access`,
    );
    this.name = 'PublishAuthError';
  }
}

/**
 * Thrown when git push fails during a publish operation.
 */
export class PublishPushError extends ForgeError {
  constructor(detail: string) {
    super(
      'PUBLISH_PUSH_ERROR',
      `Publish push failed: ${detail}`,
      `Check that you have write access to the remote repository and the branch is not protected`,
    );
    this.name = 'PublishPushError';
  }
}

/**
 * Thrown when publish validation fails (invalid metadata or semver).
 */
export class PublishValidationError extends ForgeError {
  constructor(detail: string) {
    super(
      'PUBLISH_VALIDATION_ERROR',
      `Publish validation failed: ${detail}`,
      `Fix the validation errors in your artifact metadata before publishing`,
    );
    this.name = 'PublishValidationError';
  }
}
