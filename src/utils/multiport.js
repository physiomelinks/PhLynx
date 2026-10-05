/**
 * Multiport types per port variable.
 *
 * A port's multiportType is 'None', 'True', 'Sum' or 'Multiply' for every variable, or a list with one
 * entry per variable ('True', 'sum' or 'multiply', any case), as in circulatory_autogen. Its
 * multiplyFactor is the factor of every Multiply variable, or a list aligned with its variables.
 *
 * - None: a plain link, on a port that takes one connection. A port never mixes None with the other
 *   types: beside them, None reads as True.
 * - True: a plain link shared with every connected module.
 * - Sum: the sum, over every connection, of the neighbour's paired variable. A variable sums through
 *   one port only (see sharedSumConflicts).
 * - Multiply: reaches the neighbour's paired variable times its factor.
 *
 * Imports nothing, so config.js, cellml.js and boundaryValues.js can all use it.
 */
const TYPES = { none: 'None', true: 'True', sum: 'Sum', multiply: 'Multiply' }

const isPlain = (type) => type === 'None' || type === 'True'
const unmixed = (types) => (types.every((type) => type === 'None') ? types : types.map((type) => (type === 'None' ? 'True' : type)))

/** One multi_port value's type, ignoring case; undefined when unknown. */
function typeOf(value) {
  if (value === true) return 'True'
  if (value === false || value == null) return 'None'
  return typeof value === 'string' ? TYPES[value.toLowerCase()] : undefined
}

/**
 * A multi_port value as stored on a port: anything unknown is 'None', and a list is copied as written
 * unless its entries all agree, when it is that one value.
 */
export function parseMultiport(value) {
  if (!Array.isArray(value)) return typeOf(value) ?? 'None'
  const types = value.map(typeOf)
  return types[0] && types.every((type) => type === types[0]) ? types[0] : [...value]
}

/**
 * Each port variable's multiport type, a whole-port value applying to every variable.
 *
 * @throws {Error} when a list does not have one known entry per variable.
 */
export function variableTypes(port) {
  const variables = port.variables ?? []
  const value = port.multiportType
  if (!Array.isArray(value)) return variables.map(() => typeOf(value) ?? 'None')
  if (value.length !== variables.length) {
    throw new Error(`Port "${port.label}" has ${value.length} multiport entries for ${variables.length} variables.`)
  }
  return unmixed(
    value.map((entry, i) => {
      const type = typeOf(entry)
      if (!type) throw new Error(`Port "${port.label}" has an unknown multiport ${JSON.stringify(entry)} for "${variables[i]}".`)
      return type
    })
  )
}

/**
 * The factor scaling a port's i-th variable, 1 when unset.
 *
 * @throws {Error} when the factor is not a number.
 */
export function multiplyFactor(port, i) {
  const value = Array.isArray(port.multiplyFactor) ? port.multiplyFactor[i] : port.multiplyFactor
  const factor = value == null || value === '' ? 1 : Number(value)
  if (!Number.isFinite(factor)) {
    throw new Error(`Port "${port.label}" variable "${port.variables[i]}" needs a numeric multiply factor.`)
  }
  return factor
}

/**
 * Why a coupling's ports can't be exported, as readable messages; empty when they can. Variables pair by
 * position, and a pair can't be Sum on both sides, or Multiply on both sides.
 */
export function couplingConflicts(sourcePort, targetPort) {
  let sourceTypes, targetTypes
  try {
    sourceTypes = variableTypes(sourcePort)
    targetTypes = variableTypes(targetPort)
  } catch (error) {
    return [error.message]
  }
  if (sourceTypes.length !== targetTypes.length && ![...sourceTypes, ...targetTypes].every(isPlain)) {
    return [`Ports "${sourcePort.label}" and "${targetPort.label}" need the same number of variables to sum or multiply.`]
  }
  return sourceTypes.flatMap((type, i) =>
    type === targetTypes[i] && !isPlain(type)
      ? [`"${sourcePort.variables[i]}" and "${targetPort.variables[i]}" are both ${type} variables.`]
      : []
  )
}

/**
 * Why edges can't be exported because a node's variable sums through more than one port, by edge id.
 * Only connected ports count; a coupling whose ports are malformed is left to couplingConflicts.
 *
 * @param {Object[]} edges - Edges with source, target and data.couplings.
 * @param {(nodeId: string) => string} [nameOf] - A node's name for the messages.
 * @returns {Map<string, string[]>}
 */
export function sharedSumConflicts(edges, nameOf = (id) => id) {
  const sums = new Map() // `nodeId::variable` → { nodeId, varName, labels, edgeIds }
  for (const edge of edges) {
    for (const { sourcePort, targetPort } of edge.data?.couplings ?? []) {
      for (const [nodeId, port] of [[edge.source, sourcePort], [edge.target, targetPort]]) {
        let types
        try {
          types = variableTypes(port)
        } catch {
          continue
        }
        types.forEach((type, i) => {
          const varName = port.variables[i]
          if (type !== 'Sum' || !varName) return
          const key = `${nodeId}::${varName}`
          if (!sums.has(key)) sums.set(key, { nodeId, varName, labels: new Set(), edgeIds: new Set() })
          sums.get(key).labels.add(port.label)
          sums.get(key).edgeIds.add(edge.id)
        })
      }
    }
  }
  const conflicts = new Map()
  for (const { nodeId, varName, labels, edgeIds } of sums.values()) {
    if (labels.size < 2) continue
    const ports = [...labels].map((label) => `"${label}"`).join(' and ')
    const message = `"${nameOf(nodeId)}" sums "${varName}" through ports ${ports}; a variable can be summed through one port only.`
    for (const id of edgeIds) conflicts.set(id, [...(conflicts.get(id) ?? []), message])
  }
  return conflicts
}

// ── Editing ─────────────────────────────────────────────────────────────────

const CYCLE = ['True', 'Sum', 'Multiply']
const LIST_ENTRY = { True: 'True', Sum: 'sum', Multiply: 'multiply' }

// Lenient, for the editors: a missing or unknown entry reads as None.
const spread = (port) =>
  unmixed(
    (port.variables ?? []).map(
      (_, i) => typeOf(Array.isArray(port.multiportType) ? port.multiportType[i] : port.multiportType) ?? 'None'
    )
  )
const factorAt = (port, i) => (Array.isArray(port.multiplyFactor) ? port.multiplyFactor[i] : port.multiplyFactor)
const factorsOf = (port) => (port.variables ?? []).map((_, i) => factorAt(port, i) ?? null)

/**
 * Stores per-variable types and factors, as one whole-port value wherever every variable agrees. A port
 * with no Multiply variable keeps a whole-port factor.
 */
function setTypes(port, types, factors) {
  port.multiportType = types.every((type) => type === types[0]) ? types[0] : types.map((type) => LIST_ENTRY[type])
  const used = factors.filter((_, i) => types[i] === 'Multiply')
  if (new Set(used).size > 1) {
    port.multiplyFactor = factors.map((factor, i) => (types[i] === 'Multiply' ? factor : null))
  } else if (used.length || Array.isArray(port.multiplyFactor)) {
    port.multiplyFactor = used.length ? used[0] : 1
  }
}

/** Whether a port takes several connections, which its variables are then True, Sum or Multiply. */
export const isMultiport = (port) => Array.isArray(port.multiportType) || parseMultiport(port.multiportType) !== 'None'

/** Makes a port take several connections, every variable True, or one, every variable None. */
export function setMultiport(port, multiport) {
  port.multiportType = multiport ? 'True' : 'None'
}

/** The multiport type a port variable's chip shows. */
export const variableMultiportType = (port, name) => spread(port)[port.variables.indexOf(name)] ?? 'None'

/** A port's Multiply variables, each of which needs a factor. */
export const multiplyVariables = (port) => port.variables.filter((name) => variableMultiportType(port, name) === 'Multiply')

/** The factor a Multiply variable is scaled by. */
export const variableFactor = (port, name) => factorAt(port, port.variables.indexOf(name))

/** Sets the factor one Multiply variable is scaled by. */
export function setVariableFactor(port, name, factor) {
  const factors = factorsOf(port)
  factors[port.variables.indexOf(name)] = factor
  setTypes(port, spread(port), factors)
}

/** Moves one variable of a multiport to its next type: True → Sum → Multiply → True. */
export function cycleMultiportType(port, name) {
  const i = port.variables.indexOf(name)
  const types = spread(port)
  const factors = factorsOf(port)
  types[i] = CYCLE[(CYCLE.indexOf(types[i]) + 1) % CYCLE.length]
  if (types[i] === 'Multiply') factors[i] = 1
  setTypes(port, types, factors)
}

/**
 * Sets a port's variables, each kept variable keeping its type and factor; an added one is True on a
 * multiport and None otherwise.
 *
 * @param {Object} port
 * @param {string[]} variables
 * @param {(name: string) => string} [previousName] - A variable's name before a rename.
 */
export function setPortVariables(port, variables, previousName = (name) => name) {
  const types = spread(port)
  const added = isMultiport(port) ? 'True' : 'None'
  const from = variables.map((name) => (port.variables ?? []).indexOf(previousName(name)))
  const factors = from.map((j) => (j < 0 ? null : (factorAt(port, j) ?? null)))
  port.variables = variables
  if (variables.length) setTypes(port, from.map((j) => (j < 0 ? added : types[j])), factors)
}

/**
 * Puts back a port's earlier variables (an undo). Each keeps the type and factor it has now, if it is
 * still on the port, and otherwise gets back its earlier ones.
 *
 * @param {Object} port
 * @param {Object} earlier - The port's earlier { variables, multiportType, multiplyFactor }.
 * @param {(name: string) => string} [currentName] - An earlier variable's name now, after a rename.
 */
export function restorePortVariables(port, earlier, currentName = (name) => name) {
  const now = { types: spread(port), factors: factorsOf(port) }
  const before = { types: spread(earlier), factors: factorsOf(earlier) }
  const from = earlier.variables.map((name) => port.variables.indexOf(currentName(name)))
  const types = from.map((j, i) => (j < 0 ? before.types[i] : now.types[j]))
  const factors = from.map((j, i) => (j < 0 ? before.factors[i] : now.factors[j]))
  const multiport = isMultiport(port)
  port.variables = earlier.variables
  if (!port.variables.length) return
  setTypes(port, multiport ? unmixed(types) : types.map(() => 'None'), factors)
}
