import { ForgeError } from '../adapters/errors.js';

export class RepoNotFoundError extends ForgeError {
  constructor(org: string, name: string) {
    super('REPO_NOT_FOUND', `Repo '${org}/${name}' not found in registry`);
    this.name = 'RepoNotFoundError';
  }
}

export class RepoExistsError extends ForgeError {
  constructor(org: string, name: string) {
    super('REPO_EXISTS', `Repo '${org}/${name}' is already registered`);
    this.name = 'RepoExistsError';
  }
}

export class RepoAmbiguousError extends ForgeError {
  readonly candidates: Array<{ org: string; name: string; canonicalUrl: string }>;

  constructor(
    name: string,
    candidates: Array<{ org: string; name: string; canonicalUrl: string }>,
  ) {
    super(
      'REPO_AMBIGUOUS',
      `Repo name '${name}' is ambiguous — found in ${candidates.length} orgs: ${candidates.map((c) => c.org).join(', ')}`,
    );
    this.name = 'RepoAmbiguousError';
    this.candidates = candidates;
  }
}
