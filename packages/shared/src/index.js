/**
 * @horus/shared — shared types and constants for Horus UI packages
 */

// ─── Data Shape IDs ──────────────────────────────────────────────────────────

/**
 * Shape identifiers used by the primitive registry to select a renderer.
 * @enum {string}
 */
export const DataShapes = {
  /** Flat array of items — title, status, priority, modified */
  FLAT_ARRAY: 'flat-array',
  /** Items pre-grouped by status field */
  GROUPED_BY_STATUS: 'grouped-by-status',
  /** Items with title, tags, metadata, and body preview */
  RICH_CARDS: 'rich-cards',
  /** Uniform fields, all columns equally important */
  TABULAR: 'tabular',
  /** A single item with full field set */
  SINGLE_ITEM: 'single-item',
  /** A single markdown document body */
  MARKDOWN_BODY: 'markdown-body',
}

// ─── Data Contract ────────────────────────────────────────────────────────────

/**
 * Standard data contract passed to all primitive renderers.
 *
 * @typedef {Object} DataContract
 * @property {string} query        - The original query string or view name
 * @property {'anvil'|'vault'|'forge'} source
 * @property {string} type         - Note type (story, task, journal, page, etc.)
 * @property {number} count        - Total items (may exceed items.length if paginated)
 * @property {DataItem[]} items
 * @property {string} shape        - One of DataShapes values
 */

/**
 * A single item in a data contract payload.
 *
 * @typedef {Object} DataItem
 * @property {string} id
 * @property {string} title
 * @property {string} [status]
 * @property {string} [priority]
 * @property {string[]} [tags]
 * @property {string} [modified]   - ISO 8601 datetime string
 * @property {string} [body]       - Markdown body (present for single-item / markdown-body shapes)
 * @property {Object.<string, any>} [rest] - Additional fields passed through
 */

// ─── Health ──────────────────────────────────────────────────────────────────

/**
 * @typedef {'healthy'|'degraded'|'down'|'unknown'} HealthStatus
 */

/**
 * @typedef {Object} ServiceHealth
 * @property {string} name                  - Service name (anvil, vault, forge)
 * @property {string} url                   - Base URL
 * @property {HealthStatus} status
 * @property {number|null} latency          - Response time in ms; null if unreachable
 */

/**
 * @typedef {Object} AggregateHealth
 * @property {HealthStatus} overall         - Worst of all service statuses
 * @property {ServiceHealth[]} services
 */

// ─── Config ──────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} ServicesConfig
 * @property {string} horusDataRoot
 * @property {string} anvilNotesPath
 * @property {string} vaultKnowledgePath
 * @property {string} forgeWorkspacesPath
 * @property {'docker'|'podman'} containerRuntime
 */

/**
 * @typedef {Object} LLMConfig
 * @property {'anthropic'|'openai'|'none'} provider
 * @property {string} [apiKey]
 */

/**
 * @typedef {Object} UserPreferences
 * @property {{ name: string }} user
 * @property {Object.<string, string>} primitives  - { [queryType]: primitiveId }
 * @property {Object.<string, any>}   settings     - Keyed by "{packageId}.{settingId}"
 */

// ─── Dashboards ──────────────────────────────────────────────────────────────

/**
 * Persisted config for a single pinned dashboard.
 *
 * @typedef {Object} DashboardConfig
 * @property {string} id
 * @property {string} title
 * @property {string} [icon]        - Emoji or icon identifier
 * @property {number} order         - Display order in sidebar (0-indexed)
 * @property {string} [artifactId]  - Linked artifact package ID, if any
 * @property {Object} [config]      - Artifact-specific config object
 */

/**
 * Root shape of `_system/ui/dashboards.json`
 *
 * @typedef {Object} DashboardsFile
 * @property {DashboardConfig[]} dashboards
 */
