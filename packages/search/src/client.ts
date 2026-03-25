import Typesense from 'typesense';
import type { Client as TypesenseClient } from 'typesense';
import type { SearchConfig } from './config.js';

/**
 * The Typesense client type — exported so consumers don't need to depend on
 * the 'typesense' package directly.
 */
export type { TypesenseClient };

/**
 * Create a Typesense client instance from a SearchConfig.
 */
export function createClient(config: SearchConfig): TypesenseClient {
  return new Typesense.Client({
    nodes: [
      {
        host: config.host,
        port: config.port,
        protocol: config.protocol,
      },
    ],
    apiKey: config.apiKey,
    connectionTimeoutSeconds: 5,
  });
}
