/** horus-service entry point. */
import { buildServer } from './app.js';
import { loadConfig } from './config.js';

const config = await loadConfig();
const server = buildServer({
  tokenVerifier: config.tokenVerifier,
  principalSigner: config.principalSigner,
  upstreams: config.upstreams,
  logger: true,
});

try {
  const address = await server.listen({ port: config.port, host: config.host });
  server.log.info(`horus-service listening on ${address}`);
} catch (err) {
  server.log.error(err);
  process.exit(1);
}
