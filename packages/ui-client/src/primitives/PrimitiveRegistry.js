import { ListPrimitive } from './renderers/ListPrimitive'
import { TablePrimitive } from './renderers/TablePrimitive'

export class PrimitiveRegistry {
  constructor() { this._entries = new Map() }
  register(id, component, { dataShapes = [], defaultFor = null, configSchema = null } = {}) {
    this._entries.set(id, { component, dataShapes, defaultFor, configSchema })
    return this
  }
  selectPrimitive(shape, userOverride = null) {
    if (userOverride && this._entries.has(userOverride)) return { id: userOverride, component: this._entries.get(userOverride).component }
    for (const [id, e] of this._entries) if (e.defaultFor === shape) return { id, component: e.component }
    for (const [id, e] of this._entries) if (e.dataShapes.includes(shape)) return { id, component: e.component }
    return null
  }
  getPrimitivesForShape(shape) {
    return [...this._entries.entries()].filter(([, e]) => e.dataShapes.includes(shape) || e.defaultFor === shape).map(([id, e]) => ({ id, configSchema: e.configSchema }))
  }
  getAll() { return [...this._entries.keys()] }
}

export const SHAPE = {
  FLAT_ARRAY: 'flat-array', GROUPED_BY_STATUS: 'grouped-by-status',
  RICH_CARDS: 'rich-cards', TABULAR: 'tabular',
  SINGLE_ITEM: 'single-item', MARKDOWN_BODY: 'markdown-body',
}

export const registry = new PrimitiveRegistry()

registry
  .register(SHAPE.FLAT_ARRAY, ListPrimitive, { dataShapes: [SHAPE.FLAT_ARRAY], defaultFor: SHAPE.FLAT_ARRAY })
  .register(SHAPE.TABULAR, TablePrimitive,   { dataShapes: [SHAPE.TABULAR],    defaultFor: SHAPE.TABULAR })
