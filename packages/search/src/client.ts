import Typesense from 'typesense';
import type { SearchConfig } from './config.js';

/**
 * Create a Typesense client instance from a SearchConfig.
 */
export function createClient(config: SearchConfig): Typesense.Client {
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
