/**
 * PrimitiveRegistry — maps DataShape IDs to renderer components.
 *
 * Usage:
 *   registry.register('flat-array', MyComponent, { dataShapes: ['flat-array'], defaultFor: 'flat-array' })
 *   const Component = registry.selectPrimitive('flat-array')
 */

export class PrimitiveRegistry {
  constructor() {
    /** @type {Map<string, { component: any, dataShapes: string[], defaultFor: string|null, configSchema: object|null }>} */
    this._entries = new Map()
  }

  /**
   * Register a primitive renderer.
   * @param {string} id
   * @param {any} component - React component
   * @param {{ dataShapes?: string[], defaultFor?: string, configSchema?: object }} opts
   */
  register(id, component, { dataShapes = [], defaultFor = null, configSchema = null } = {}) {
    this._entries.set(id, { component, dataShapes, defaultFor, configSchema })
    return this
  }

  /**
   * Select the best primitive for a given shape.
   * Priority: explicit user override > defaultFor match > first registered handler > null
   * @param {string} shape - DataShape ID
   * @param {string|null} [userOverride] - explicit primitive ID from user prefs
   * @returns {{ id: string, component: any } | null}
   */
  selectPrimitive(shape, userOverride = null) {
    if (userOverride && this._entries.has(userOverride)) {
      return { id: userOverride, component: this._entries.get(userOverride).component }
    }
    // defaultFor match
    for (const [id, entry] of this._entries) {
      if (entry.defaultFor === shape) return { id, component: entry.component }
    }
    // first registered that supports this shape
    for (const [id, entry] of this._entries) {
      if (entry.dataShapes.includes(shape)) return { id, component: entry.component }
    }
    return null
  }

  /**
   * Return all registered IDs that support a given shape.
   * @param {string} shape
   * @returns {Array<{ id: string, configSchema: object|null }>}
   */
  getPrimitivesForShape(shape) {
    return [...this._entries.entries()]
      .filter(([, e]) => e.dataShapes.includes(shape) || e.defaultFor === shape)
      .map(([id, e]) => ({ id, configSchema: e.configSchema }))
  }

  getAll() {
    return [...this._entries.keys()]
  }
}

/** Singleton registry — import and use directly in the app */
export const registry = new PrimitiveRegistry()

// ─── Built-in shape IDs ──────────────────────────────────────────────────────

export const SHAPE = {
  FLAT_ARRAY:        'flat-array',
  GROUPED_BY_STATUS: 'grouped-by-status',
  RICH_CARDS:        'rich-cards',
  TABULAR:           'tabular',
  SINGLE_ITEM:       'single-item',
  MARKDOWN_BODY:     'markdown-body',
}

// Placeholder stub components used until concrete renderers land in WI-10/11/16
const stub = (name) => function StubPrimitive({ data }) {
  return <pre style={{ color: 'var(--text-secondary)', fontSize: '12px' }}>[{name}] {JSON.stringify(data?.shape)}</pre>
}

registry
  .register(SHAPE.FLAT_ARRAY,        stub('FlatArray'),       { dataShapes: [SHAPE.FLAT_ARRAY],        defaultFor: SHAPE.FLAT_ARRAY })
  .register(SHAPE.GROUPED_BY_STATUS, stub('GroupedByStatus'), { dataShapes: [SHAPE.GROUPED_BY_STATUS], defaultFor: SHAPE.GROUPED_BY_STATUS })
  .register(SHAPE.RICH_CARDS,        stub('RichCards'),       { dataShapes: [SHAPE.RICH_CARDS],        defaultFor: SHAPE.RICH_CARDS })
  .register(SHAPE.TABULAR,           stub('Tabular'),         { dataShapes: [SHAPE.TABULAR],           defaultFor: SHAPE.TABULAR })
  .register(SHAPE.SINGLE_ITEM,       stub('SingleItem'),      { dataShapes: [SHAPE.SINGLE_ITEM],       defaultFor: SHAPE.SINGLE_ITEM })
  .register(SHAPE.MARKDOWN_BODY,     stub('MarkdownBody'),    { dataShapes: [SHAPE.MARKDOWN_BODY],     defaultFor: SHAPE.MARKDOWN_BODY })
