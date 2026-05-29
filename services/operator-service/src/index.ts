/** operator-service entry point. */
import { Store } from './store.js';
import { KeyManager } from './keys.js';
import { RequestService, ensureBootstrapAdmin } from './service.js';
import { InMemoryVaultInfra } from './infra.js';
import {
  onboardHandler,
  vaultCreateHandler,
  vaultAttachHandler,
  vaultDeleteHandler,
} from './handlers.js';
import type { HandlerMap } from './provisioner.js';
import { createClientTokenMinter } from './tokens.js';
import { buildApp } from './app.js';

const store = new Store(process.env.OPERATOR_DB_PATH ?? '/data/operator.db');
const keys = new KeyManager(store);
await keys.firstBootEnsure();
ensureBootstrapAdmin(
  store,
  process.env.OPERATOR_BOOTSTRAP_ADMIN ?? 'admin',
  process.env.OPERATOR_TENANT ?? 'default',
);

const infra = new InMemoryVaultInfra();
const handlers: HandlerMap = {
  onboard: onboardHandler(store),
  vault_create: vaultCreateHandler(infra),
  vault_attach: vaultAttachHandler(infra),
  vault_delete: vaultDeleteHandler(infra),
  teardown: vaultDeleteHandler(infra),
};

const service = new RequestService(store, handlers);
const mintClientToken = createClientTokenMinter(keys);
const app = buildApp({ service, keys, store, mintClientToken });

const port = Number(process.env.OPERATOR_PORT ?? '8090');
try {
  await app.listen({ port, host: '0.0.0.0' });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
