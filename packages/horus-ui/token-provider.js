/**
 * Token provider for horus-ui connected-mode auth.
 *
 * Reads TOKEN_PROVIDER_KIND and TOKEN_PROVIDER_CONFIG from the environment.
 *
 * Supported kinds:
 *   static — returns TOKEN_PROVIDER_CONFIG as the bearer token verbatim.
 *   none   — returns an empty string (anonymous / no auth).
 *   (unset) — same as "none".
 *
 * Pattern mirrors packages/cli/src/lib/config.ts token_provider shape.
 * Additional kinds (oidc, etc.) can be added here without changing the interface.
 */

const kind = (process.env.TOKEN_PROVIDER_KIND || 'none').trim().toLowerCase();
const config = (process.env.TOKEN_PROVIDER_CONFIG || '').trim();

/**
 * Return the current bearer token string.
 * Returns an empty string when no auth is configured.
 *
 * @returns {string}
 */
export function getToken() {
  switch (kind) {
    case 'static':
      return config;
    case 'none':
    default:
      return '';
  }
}

/**
 * Return true when a non-empty token is available.
 * @returns {boolean}
 */
export function hasToken() {
  return getToken().length > 0;
}
