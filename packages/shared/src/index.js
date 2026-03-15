/**
 * @horus/shared — shared types and constants for Horus UI packages
 *
 * Data shape IDs for the primitive registry.
 * @type {Record<string, string>}
 */
export const DataShapes = {
  FLAT_ARRAY: 'flat-array',
  GROUPED_BY_STATUS: 'grouped-by-status',
  RICH_CARDS: 'rich-cards',
  TABULAR: 'tabular',
  SINGLE_ITEM: 'single-item',
  MARKDOWN_BODY: 'markdown-body',
}

/**
 * Overall health status values.
 * @typedef {'healthy'|'degraded'|'down'} HealthStatus
 */

/**
 * @typedef {Object} ServiceHealth
 * @property {string} name
 * @property {string} url
 * @property {HealthStatus} status
 * @property {number|null} latency - Response time in ms, null if unreachable
 */

/**
 * @typedef {Object} AggregateHealth
 * @property {HealthStatus} overall
 * @property {ServiceHealth[]} services
 */

/**
 * Standard data contract passed to all primitives.
 *
 * @typedef {Object} DataContract
 * @property {string} query - The original query or view name
 * @property {'anvil'|'vault'|'forge'} source
 * @property {string} type - Note type (story, task, journal, etc.)
 * @property {number} count
 * @property {DataItem[]} items
 * @property {string} shape - One of DataShapes values
 */

/**
 * @typedef {Object} DataItem
 * @property {string} id
 * @property {string} title
 * @property {string} [status]
 * @property {string} [priority]
 * @property {string[]} [tags]
 * @property {string} [modified]
 */

/**
 * @typedef {Object} DashboardConfig
 * @property {string} id
 * @property {string} title
 * @property {string} [icon]
 * @property {number} order
 * @property {string} [artifactId]
 * @property {object} [config]
 */
