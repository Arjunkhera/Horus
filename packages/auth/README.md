# @horus/auth

Transport-agnostic JWT credential library for Horus services. Provides key-pair generation, local JWKS management, token issuance with auto-refresh, offline verification, and a structural tenant-isolation floor.

## JWT / JWKS Contract

All tokens are asymmetrically signed (RS256 or ES256). The protected header carries `alg` and `kid`. The payload carries:

| Claim   | Type   | Description                    |
|---------|--------|--------------------------------|
| `tenant`| string | Logical tenant / realm         |
| `user`  | string | User identifier                |
| `role`  | string | Caller role (`admin`, etc.)    |
| `iat`   | number | Issued-at (epoch seconds)      |
| `exp`   | number | Expiry (epoch seconds)         |

Verification is always **offline**: keys are held in an in-memory `LocalJwkSet`. The verifier resolves the signing key by `kid` and never calls `fetch`.

## Public API

```ts
import {
  createJwtKeyPair,     // generate RS256/ES256 key pair
  createLocalJwkSet,   // build an in-memory JWKS (supports live key rotation via .addKey)
  createJwtProvider,   // CredentialProvider: issues + caches Bearer tokens, auto-refreshes near expiry
  createJwtVerifier,   // CredentialVerifier: verifies Bearer tokens offline, enforces expectedTenant
  hardenedVerifier,    // wraps any CredentialVerifier plugin with a structural tenant floor
  type Principal,
  type CredentialProvider,
  type CredentialVerifier,
} from '@horus/auth';
```

### Key rotation

```ts
const a = await createJwtKeyPair({ alg: 'RS256' });
const b = await createJwtKeyPair({ alg: 'ES256' });

const jwks = createLocalJwkSet([{ kid: a.kid, publicJwk: a.publicJwk }]);
// Add a new key without evicting the old one:
jwks.addKey({ kid: b.kid, publicJwk: b.publicJwk });
// Tokens signed by either key verify successfully.
```

## Fastify → registry-service integration shim

The `@horus/auth/shim/fastify-registry` integration shim maps a `Principal` to the registry-service `ServiceUser` shape and provides a ready-to-use Fastify preHandler.

```ts
import {
  principalToServiceUser,
  makeAuthPreHandler,
} from '@horus/auth/shim/fastify-registry';
import { createJwtVerifier, createLocalJwkSet } from '@horus/auth';

// 1. Build verifier (offline, bound to your tenant)
const jwks = createLocalJwkSet([{ kid, publicJwk }]);
const verifier = createJwtVerifier({ jwks, expectedTenant: 'my-tenant' });

// 2. Attach the preHandler to your Fastify route or plugin
fastify.addHook('preHandler', makeAuthPreHandler(verifier));

// 3. Access the resolved identity in handlers
fastify.get('/protected', (req, reply) => {
  const user: ServiceUser | undefined = (req as any).serviceUser;
  if (!user) return reply.status(401).send();
  // user.userId, user.name, user.role ('admin' | 'anonymous')
});
```

### ServiceUser mapping

`principalToServiceUser(principal)` converts a `Principal` to a `ServiceUser`:

| Principal.role | ServiceUser.role |
|----------------|-----------------|
| `'admin'`      | `'admin'`       |
| anything else  | `'anonymous'`   |

The `ServiceUser` type mirrors the registry-service definition:

```ts
interface ServiceUser {
  userId: string;
  name: string;
  role: 'admin' | 'anonymous';
}
```
