import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  createJwtKeyPair,
  createLocalJwkSet,
  createJwtVerifier,
  createPrincipalSigner,
  type CredentialVerifier,
  type Principal,
} from '@horus/auth';

export const TENANT = 'acme';

export interface AuthFixture {
  tokenVerifier: CredentialVerifier;
  principalSigner: (p: Principal) => Promise<string>;
  /** Mint an inbound client Authorization header value for a principal. */
  clientAuthHeader: (p: Principal) => Promise<string>;
  /** Verify a minted X-Horus-Principal token the way a backend would. */
  internalVerifier: CredentialVerifier;
}

export async function makeAuthFixture(tenant = TENANT): Promise<AuthFixture> {
  const clientKp = await createJwtKeyPair({ alg: 'ES256' });
  const internalKp = await createJwtKeyPair({ alg: 'ES256' });

  const tokenVerifier = createJwtVerifier({
    jwks: createLocalJwkSet([{ kid: clientKp.kid, publicJwk: clientKp.publicJwk }]),
    expectedTenant: tenant,
  });
  const clientSign = createPrincipalSigner({
    privateKey: clientKp.privateKey,
    kid: clientKp.kid,
    alg: 'ES256',
    ttlSeconds: 300,
  });
  const principalSigner = createPrincipalSigner({
    privateKey: internalKp.privateKey,
    kid: internalKp.kid,
    alg: 'ES256',
    ttlSeconds: 60,
  });
  const internalVerifier = createJwtVerifier({
    jwks: createLocalJwkSet([{ kid: internalKp.kid, publicJwk: internalKp.publicJwk }]),
    expectedTenant: tenant,
  });

  return {
    tokenVerifier,
    principalSigner,
    clientAuthHeader: async (p) => `Bearer ${await clientSign(p)}`,
    internalVerifier,
  };
}

export interface FakeUpstream {
  url: string;
  lastHeaders: IncomingMessage['headers'];
  lastUrl: string;
  close: () => void;
}

/** A fake backend that records the request and echoes a JSON body. */
export function startUpstream(): Promise<FakeUpstream> {
  const state: { lastHeaders: IncomingMessage['headers']; lastUrl: string } = {
    lastHeaders: {},
    lastUrl: '',
  };
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    state.lastHeaders = req.headers;
    state.lastUrl = req.url ?? '';
    if (req.url === '/health') {
      res.writeHead(200).end('ok');
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ url: req.url, method: req.method }));
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        get lastHeaders() {
          return state.lastHeaders;
        },
        get lastUrl() {
          return state.lastUrl;
        },
        close: () => server.close(),
      });
    });
  });
}
