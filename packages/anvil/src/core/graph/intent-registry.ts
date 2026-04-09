/**
 * Intent registry for the Anvil V2 Relations Graph.
 *
 * Intents define the semantic meaning of edges. Each intent has
 * a direction (directional or bidirectional) and an optional
 * inverse label used when displaying the edge from the target's
 * perspective.
 *
 * The registry ships with a set of MVP intents and supports
 * runtime registration of additional intents for extensibility.
 */

/** Definition of a registered intent. */
export interface IntentDefinition {
  /** Unique identifier for the intent (e.g. 'blocks', 'mentions'). */
  id: string
  /** Whether the intent is directional (A -> B) or bidirectional (A <-> B). */
  direction: 'directional' | 'bidirectional'
  /** Label used when displaying the edge from the target's perspective. Null for bidirectional intents. */
  inverseLabel: string | null
  /** Human-readable description of what this intent represents. */
  description: string
}

/** MVP intents shipped with the registry. */
const MVP_INTENTS: IntentDefinition[] = [
  {
    id: 'mentions',
    direction: 'bidirectional',
    inverseLabel: null,
    description: 'General association — these entities are connected',
  },
  {
    id: 'blocks',
    direction: 'directional',
    inverseLabel: 'blocked_by',
    description: 'Work item dependency — source blocks target',
  },
  {
    id: 'references',
    direction: 'directional',
    inverseLabel: 'referenced_by',
    description: 'Formal citation — source references target',
  },
  {
    id: 'parent_of',
    direction: 'directional',
    inverseLabel: 'child_of',
    description: 'Structural hierarchy — parent contains or owns the target',
  },
  {
    id: 'belongs_to',
    direction: 'directional',
    inverseLabel: 'contains',
    description: 'Membership — source is a member of or belongs to the target',
  },
]

/**
 * Registry of known intents.
 *
 * Initialised with {@link MVP_INTENTS} and allows additional
 * intents to be registered at runtime for extensibility.
 */
export class IntentRegistry {
  /** Internal map keyed by intent ID. */
  private intents: Map<string, IntentDefinition>

  constructor() {
    this.intents = new Map()
    for (const intent of MVP_INTENTS) {
      this.intents.set(intent.id, intent)
    }
  }

  /**
   * Look up an intent definition by its ID.
   *
   * @param id - The intent identifier.
   * @returns The intent definition, or `undefined` if not registered.
   */
  get(id: string): IntentDefinition | undefined {
    return this.intents.get(id)
  }

  /**
   * Check whether an intent ID is registered.
   *
   * @param id - The intent identifier to validate.
   * @returns `true` if the intent is registered.
   */
  validate(id: string): boolean {
    return this.intents.has(id)
  }

  /**
   * Resolve the display label for an intent given a direction context.
   *
   * For outgoing edges the intent ID itself is returned.
   * For incoming edges the inverse label is returned when available;
   * bidirectional intents (where inverseLabel is null) fall back to
   * the intent ID.
   *
   * @param intent - The intent identifier.
   * @param direction - Whether the queried entity is the source ('outgoing') or target ('incoming').
   * @returns The label string to display.
   * @throws {Error} If the intent is not registered.
   */
  getDisplayLabel(intent: string, direction: 'outgoing' | 'incoming'): string {
    const def = this.intents.get(intent)
    if (!def) {
      throw new Error(`Unknown intent: ${intent}`)
    }

    if (direction === 'outgoing') {
      return def.id
    }

    // Incoming: use inverse label when available, otherwise fall back to the intent ID.
    return def.inverseLabel ?? def.id
  }

  /**
   * Return all registered intent definitions.
   *
   * @returns A shallow copy of the registered intents array.
   */
  list(): IntentDefinition[] {
    return Array.from(this.intents.values())
  }

  /**
   * Register a new intent definition.
   *
   * @param intent - The intent definition to add.
   * @throws {Error} If an intent with the same ID is already registered.
   */
  register(intent: IntentDefinition): void {
    if (this.intents.has(intent.id)) {
      throw new Error(`Intent already registered: ${intent.id}`)
    }
    this.intents.set(intent.id, intent)
  }
}
