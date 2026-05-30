/**
 * @horus/gateway-core — shared Fastify gateway primitives.
 *
 * Reverse-proxy + SSE pass-through + structured error envelope, extracted from
 * anvil-router's proven patterns (3c4917cb). Consumed by horus-service; general
 * enough for anvil-router to adopt when Track A merges.
 */

export {
  type ErrorBody,
  type ErrorEnvelope,
  buildErrorBody,
  sendError,
  getRequestId,
  UpstreamResolutionError,
} from './errors.js';

export {
  type HttpMethod,
  type RestProxyRouteOptions,
  registerRestProxyRoute,
} from './proxy.js';

export {
  type SseProxyRouteOptions,
  registerSseProxyRoute,
} from './sse.js';
