/**
 * Repo registry routes.
 *
 * POST   /repos                   — Register a repo
 * GET    /repos/:org/:name        — Read repo metadata
 * PATCH  /repos/:org/:name        — Update (deep-merge) repo metadata
 * DELETE /repos/:org/:name        — Remove repo
 * GET    /repos                   — List / search repos
 * GET    /repos/resolve           — Resolve by name or URL
 */

import type { FastifyInstance } from 'fastify';
import type { RepoStorage } from '../storage/repo-storage.js';
import type { RepoSearchClient } from '../search/repo-search.js';
import type { AuthStrategy } from '../auth/types.js';
import { CreateRepoInputSchema, PatchRepoInputSchema } from '../types/repo-metadata.js';
import { deepMergeRepo } from '../utils/deep-merge.js';

export interface RepoDeps {
  repoStorage: RepoStorage;
  repoSearch: RepoSearchClient | null;
  auth: AuthStrategy;
}

interface OrgNameParams {
  org: string;
  name: string;
}

export function registerRepoRoutes(app: FastifyInstance, deps: RepoDeps): void {
  const { repoStorage, repoSearch, auth } = deps;

  // ── POST /repos ────────────────────────────────────────────────────────────
  app.post<{ Body: unknown }>('/repos', async (request, reply) => {
    const decision = auth.authorize(request.serviceUser ?? null, 'publish', {
      type: 'repo',
      id: '*',
      version: '*',
    });
    if (decision === 'deny') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Write access denied' });
    }

    const parsed = CreateRepoInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.errors.map((e) => e.message).join('; '),
      });
    }

    const { org, name } = parsed.data;
    if (await repoStorage.exists(org, name)) {
      return reply.status(409).send({
        error: 'REPO_EXISTS',
        message: `${org}/${name} already registered`,
      });
    }

    const now = new Date().toISOString();
    const metadata = { ...parsed.data, registeredAt: now, updatedAt: now };
    await repoStorage.write(org, name, metadata);
    if (repoSearch) await repoSearch.index(metadata);

    return reply.status(201).send(metadata);
  });

  // ── GET /repos/resolve ─────────────────────────────────────────────────────
  // Must be registered before /repos/:org/:name to avoid `:org` capturing "resolve"
  app.get<{ Querystring: { name?: string; url?: string } }>(
    '/repos/resolve',
    async (request, reply) => {
      const decision = auth.authorize(request.serviceUser ?? null, 'read', {
        type: 'repo',
        id: '*',
        version: '*',
      });
      if (decision === 'deny') {
        return reply.status(403).send({ error: 'FORBIDDEN', message: 'Read access denied' });
      }

      const { name, url } = request.query;
      if (!name && !url) {
        return reply.status(400).send({
          error: 'VALIDATION_ERROR',
          message: 'At least one of ?name or ?url is required',
        });
      }

      if (!repoSearch) {
        return reply.status(503).send({
          error: 'SEARCH_UNAVAILABLE',
          message: 'Search is not configured on this instance',
        });
      }

      if (url) {
        const match = await repoSearch.resolveByUrl(url);
        if (!match) {
          return reply.status(404).send({ error: 'REPO_NOT_FOUND', message: 'No repo matches that URL' });
        }
        return reply.status(200).send({ match, ambiguous: false });
      }

      // name lookup
      const result = await repoSearch.resolveByName(name!);
      if (!result.match && !result.ambiguous) {
        return reply.status(404).send({ error: 'REPO_NOT_FOUND', message: `No repo named '${name}'` });
      }
      return reply.status(200).send(result);
    },
  );

  // ── GET /repos ─────────────────────────────────────────────────────────────
  app.get<{
    Querystring: {
      q?: string;
      org?: string;
      language?: string;
      framework?: string;
      tag?: string;
      limit?: string;
      offset?: string;
    };
  }>('/repos', async (request, reply) => {
    const decision = auth.authorize(request.serviceUser ?? null, 'read', {
      type: 'repo',
      id: '*',
      version: '*',
    });
    if (decision === 'deny') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Read access denied' });
    }

    const { q, org, language, framework, tag, limit: limitStr, offset: offsetStr } = request.query;
    const limit = limitStr ? parseInt(limitStr, 10) : 20;
    const offset = offsetStr ? parseInt(offsetStr, 10) : 0;

    if (!repoSearch) {
      // Fall back to storage listing when search is unavailable
      const all = await repoStorage.listAll();
      return reply.status(200).send({ query: q ?? '', total: all.length, repos: all.slice(offset, offset + limit) });
    }

    const result = await repoSearch.search({ query: q, org, language, framework, tag, limit, offset });
    return reply.status(200).send({ query: q ?? '', ...result });
  });

  // ── GET /repos/:org/:name ──────────────────────────────────────────────────
  app.get<{ Params: OrgNameParams }>('/repos/:org/:name', async (request, reply) => {
    const { org, name } = request.params;
    const decision = auth.authorize(request.serviceUser ?? null, 'read', {
      type: 'repo',
      id: `${org}/${name}`,
      version: '*',
    });
    if (decision === 'deny') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Read access denied' });
    }

    const metadata = await repoStorage.read(org, name);
    if (!metadata) {
      return reply.status(404).send({ error: 'REPO_NOT_FOUND', message: `${org}/${name} not found` });
    }
    return reply.status(200).send(metadata);
  });

  // ── PATCH /repos/:org/:name ────────────────────────────────────────────────
  app.patch<{ Params: OrgNameParams; Body: unknown }>('/repos/:org/:name', async (request, reply) => {
    const { org, name } = request.params;
    const decision = auth.authorize(request.serviceUser ?? null, 'publish', {
      type: 'repo',
      id: `${org}/${name}`,
      version: '*',
    });
    if (decision === 'deny') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Write access denied' });
    }

    const parsed = PatchRepoInputSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'VALIDATION_ERROR',
        message: parsed.error.errors.map((e) => e.message).join('; '),
      });
    }

    const existing = await repoStorage.read(org, name);
    if (!existing) {
      return reply.status(404).send({ error: 'REPO_NOT_FOUND', message: `${org}/${name} not found` });
    }

    const merged = deepMergeRepo(existing, parsed.data);
    await repoStorage.write(org, name, merged);
    if (repoSearch) await repoSearch.index(merged);

    return reply.status(200).send(merged);
  });

  // ── DELETE /repos/:org/:name ───────────────────────────────────────────────
  app.delete<{ Params: OrgNameParams }>('/repos/:org/:name', async (request, reply) => {
    const { org, name } = request.params;
    const decision = auth.authorize(request.serviceUser ?? null, 'publish', {
      type: 'repo',
      id: `${org}/${name}`,
      version: '*',
    });
    if (decision === 'deny') {
      return reply.status(403).send({ error: 'FORBIDDEN', message: 'Write access denied' });
    }

    const existed = await repoStorage.delete(org, name);
    if (!existed) {
      return reply.status(404).send({ error: 'REPO_NOT_FOUND', message: `${org}/${name} not found` });
    }
    if (repoSearch) await repoSearch.remove(org, name);

    return reply.status(204).send();
  });
}
