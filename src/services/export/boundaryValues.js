/**
 * Decides which boundary condition values the flattened model uses, as circulatory_autogen does. A boundary
 * condition's value is a fallback: it is used only when nothing else in its coupled group supplies one. Pure (no
 * libcellml), so the rule can be tested on its own.
 *
 * A coupled group is the variables that direct port couplings make equivalent. A group is supplied when one of its
 * variables is computed (by its own math, or by a generated sum, multiply or unit conversion component), else when
 * a constant row sets it. A value the group doesn't use is ignored on export. A Sum variable nothing is connected to
 * sums over nothing: it is 0. Couplings pair variables by position, each with its own multiport type (see
 * utils/multiport.js).
 *
 * Only one thing may set a group: two computed variables, or two constants with different values, overdetermine it.
 * libCellML would reject such a model, or accept it as a DAE and drop one of the equations.
 */
import { AFFINE_UNIT_CONVERSIONS, VALUE_REQUIRED_TYPES } from '../../utils/constants'
import { isBlank } from '../../utils/variables'
import { variableTypes } from '../../utils/multiport'

const keyOf = (nodeId, name) => `${nodeId}::${name}`
// How a generated component computes a variable from its inputs, for messages.
const GENERATED = { sum: 'the sum of', multiply: 'scaled from', conversion: 'converted from' }
const isPlain = (type) => type === 'None' || type === 'True'
// Row types whose value export may emit.
const VALUE_TYPES = new Set([...VALUE_REQUIRED_TYPES, 'boundary_condition'])

/**
 * Finds the variable an affine unit conversion computes between two coupled variables, mirroring
 * createAffineConversionComponent in utils/cellml.js.
 *
 * @param {{key: string, units: string}} source
 * @param {{key: string, units: string}} target
 * @returns {string|null|undefined} The computed key, null for a plain equivalence, or undefined
 *   when no conversion applies.
 */
function affineOutputKey(source, target) {
  const sourceConversion = AFFINE_UNIT_CONVERSIONS[source.units]
  const targetConversion = AFFINE_UNIT_CONVERSIONS[target.units]
  if (!sourceConversion && !targetConversion) return undefined
  if (sourceConversion && targetConversion) {
    const scale = sourceConversion.scale / targetConversion.scale
    const offset = (sourceConversion.offset - targetConversion.offset) / targetConversion.scale
    return scale === 1 && offset === 0 ? null : target.key
  }
  // The affine-unit side is derived from the base-unit side.
  return sourceConversion ? source.key : target.key
}

/**
 * Resolves which boundary condition rows initialise the flattened model, and which values it ignores.
 *
 * @param {Array} nodes - Workspace nodes with `data.name` and `data.variables` rows.
 * @param {Array} edges - Workspace edges with `data.couplings`.
 * @param {(mathRef: string) => (Object|null)} [getMathAnalysis] - libraryStore.getMathAnalysis. With it, a `variable`
 *   row counts towards `overdetermined` only when its math computes it, since a saved row may still call an input
 *   `variable` (see reconcileRows). Without it, or for math it can't analyse, every `variable` row counts.
 * @returns {{supplied: Map<string, Set<string>>, missing: Map<string, Set<string>>, conflicts: string[],
 *   emptySums: Map<string, Set<string>>, unsupplied: Set<string>, ignored: Map<string, Set<string>>,
 *   bcOnly: Array<{keys: string[], label: string}>, overdetermined: Array<{keys: string[], message: string}>,
 *   status: Map<string, Map<string, {state: string, from: string[]}>>}}
 *   Each map but `status` goes from node id to row names:
 *   - `supplied`: boundary conditions whose values to use; `missing`: those nothing supplies;
 *   - `emptySums`: Sum variables nothing is connected to, which are set to 0;
 *   - `ignored`: rows whose value export drops, because something else supplies the variable;
 *   - `conflicts`: groups given several different values; `unsupplied`: the `nodeId::name` of every boundary
 *     condition in a group nothing else supplies;
 *   - `bcOnly`: groups of boundary conditions coupled only to each other, which nothing computes;
 *   - `overdetermined`: groups set more than once, by several computed variables or constants with different values,
 *     each with the keys of all its variables;
 *   - `status`: node id to row name to where the row's variable gets its value, with `from` the `instance.name` labels
 *     of the variables involved. `connected`: a connection supplies it, from those variables; `shares`: the row
 *     supplies the variables it's coupled to; `own`: a boundary condition nothing is connected to uses its own value;
 *     `missing`: such a boundary condition has none; `bcOnly`: coupled only to other boundary conditions;
 *     `conflict`: in a group given different values; `overdetermined`: in a group set more than once, with `from` what
 *     else sets it. Rows coupled to nothing, other than boundary conditions, and empty
 *     sums have no status.
 */
export function resolveBoundaryValues(nodes, edges, getMathAnalysis = null) {
  const rows = new Map()
  for (const node of nodes) {
    for (const row of node.data?.variables ?? []) {
      rows.set(keyOf(node.id, row.name), { nodeId: node.id, nodeName: node.data.name, row })
    }
  }

  const parent = new Map()
  const find = (key) => {
    if (!parent.has(key)) parent.set(key, key)
    let root = key
    while (parent.get(root) !== root) root = parent.get(root)
    parent.set(key, root)
    return root
  }
  const join = (a, b) => parent.set(find(a), find(b))
  const computed = new Set()
  // Each variable a generated component computes, to the variables it computes it from, and how.
  const computedFrom = new Map()
  const computedBy = new Map()
  // The equations generated components give each variable: one summation, even over nothing, but one per Multiply or
  // conversion.
  const equations = new Map()
  const rejected = new Set()
  const compute = (key, fromKey, kind) => {
    computed.add(key)
    if (!computedFrom.has(key)) computedFrom.set(key, new Set())
    computedFrom.get(key).add(fromKey)
    if (!computedBy.has(key)) computedBy.set(key, kind)
    if (!equations.has(key)) equations.set(key, new Set())
    equations.get(key).add(kind === 'sum' ? kind : `${kind}:${fromKey}`)
  }

  for (const edge of edges) {
    for (const { sourcePort, targetPort } of edge.data?.couplings ?? []) {
      const sourceVariables = sourcePort?.variables ?? []
      const targetVariables = targetPort?.variables ?? []
      const sourceTypes = variableTypes(sourcePort ?? {})
      const targetTypes = variableTypes(targetPort ?? {})

      const count = Math.min(sourceTypes.length, targetTypes.length)
      for (let i = 0; i < count; i++) {
        if (!sourceVariables[i] || !targetVariables[i]) continue
        const source = { key: keyOf(edge.source, sourceVariables[i]) }
        const target = { key: keyOf(edge.target, targetVariables[i]) }
        // Export rejects a pair summed or multiplied on both ends (see couplingConflicts), and says so itself.
        if (sourceTypes[i] === targetTypes[i] && !isPlain(sourceTypes[i])) rejected.add(source.key).add(target.key)

        // A sum's result and a multiply's output are computed by generated components.
        if (sourceTypes[i] === 'Sum') compute(source.key, target.key, 'sum')
        if (targetTypes[i] === 'Sum') compute(target.key, source.key, 'sum')
        // A Multiply output feeding a Sum is one of its terms, not a second equation.
        if (sourceTypes[i] === 'Multiply' && targetTypes[i] !== 'Sum') compute(target.key, source.key, 'multiply')
        if (targetTypes[i] === 'Multiply' && sourceTypes[i] !== 'Sum') compute(source.key, target.key, 'multiply')
        if (!isPlain(sourceTypes[i]) || !isPlain(targetTypes[i])) continue

        source.units = rows.get(source.key)?.row.units
        target.units = rows.get(target.key)?.row.units
        const affineOutput = affineOutputKey(source, target)
        if (affineOutput) compute(affineOutput, affineOutput === source.key ? target.key : source.key, 'conversion')
        else join(source.key, target.key)
      }
    }
  }

  // Sum variables nothing is connected to; each sums over nothing, so is computed as 0.
  const emptySums = new Map()
  const addTo = (map, { nodeId, row }) => {
    if (!map.has(nodeId)) map.set(nodeId, new Set())
    map.get(nodeId).add(row.name)
  }
  for (const node of nodes) {
    for (const port of node.data?.ports ?? []) {
      let types
      try {
        types = variableTypes(port)
      } catch (error) {
        throw new Error(`"${node.data.name}" port "${port.label}": ${error.message}`)
      }
      types.forEach((type, i) => {
        const key = keyOf(node.id, port.variables[i])
        const member = rows.get(key)
        // A computed row's own math already sets it.
        if (type !== 'Sum' || computed.has(key) || !member || member.row.type === 'variable') return
        computed.add(key)
        equations.set(key, new Set(['sum']))
        addTo(emptySums, member)
      })
    }
  }

  const groups = new Map()
  for (const key of rows.keys()) {
    const root = find(key)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(key)
  }

  const supplied = new Map()
  const missing = new Map()
  const ignored = new Map()
  const conflicts = []
  const unsupplied = new Set()
  const bcOnly = []
  const overdetermined = []
  const status = new Map()
  const nodeNames = new Map(nodes.map((node) => [node.id, node.data?.name ?? node.id]))
  const label = ({ nodeName, row }) => `${nodeName}.${row.name}`
  const labelOf = (key) => {
    const [nodeId, name] = key.split('::')
    return `${nodeNames.get(nodeId) ?? nodeId}.${name}`
  }
  const hasValue = ({ row }) => row.type === 'global_constant' || !isBlank(row.value)
  const ignoreValues = (members) =>
    members.filter((member) => VALUE_TYPES.has(member.row.type) && hasValue(member)).forEach((member) => addTo(ignored, member))
  const setStatus = ({ nodeId, row }, state, from = []) => {
    if (!status.has(nodeId)) status.set(nodeId, new Map())
    status.get(nodeId).set(row.name, { state, from })
  }
  // What each node's math computes as a state or by assignment, or null when that isn't known.
  const mathComputed = new Map(
    nodes.map((node) => {
      const analysis = getMathAnalysis && node.data?.mathRef ? getMathAnalysis(node.data.mathRef) : null
      return [node.id, analysis ? new Set([...(analysis.stateVariables ?? []), ...(analysis.assigned ?? [])]) : null]
    })
  )
  /** Whether a member's own math sets it. */
  const ownMath = ({ nodeId, row }) => row.type === 'variable' && (mathComputed.get(nodeId)?.has(row.name) ?? true)
  /** How many equations set a member: its own math's, and each generated component's. */
  const equationsOf = (member) => (equations.get(member.key)?.size ?? 0) + ownMath(member)
  const listed = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0])
  /** Describes how a computed member is set: by its own math, a generated component, or both. */
  const describeComputed = (member) => {
    const ways = []
    if (ownMath(member)) ways.push('its own math')
    if (computedBy.has(member.key)) {
      ways.push(`${GENERATED[computedBy.get(member.key)]} ${[...computedFrom.get(member.key)].map(labelOf).join(', ')}`)
    } else if (emptySums.get(member.nodeId)?.has(member.row.name)) {
      ways.push('a sum with nothing connected, so 0')
    }
    return ways.length > 1 || !ownMath(member) ? `${label(member)} (${ways.join(' and ')})` : label(member)
  }

  for (const keys of groups.values()) {
    const members = keys.map((key) => ({ key, ...rows.get(key) }))
    const othersOf = (member, among = members) => among.filter((other) => other !== member).map(label)
    /** Reports a group set more than once, marking each member that sets it. */
    const overdetermine = (setters, message) => {
      overdetermined.push({ keys, message })
      setters.forEach((member) => setStatus(member, 'overdetermined', othersOf(member, setters)))
    }
    const shareWithOthers = (member) => {
      const others = othersOf(member)
      if (others.length) setStatus(member, 'shares', others)
    }

    // Something computes the group, so no value is used.
    const suppliers = members.filter(({ key, row }) => computed.has(key) || row.type === 'variable')
    if (suppliers.length) {
      ignoreValues(members)
      // A member its own math and generated components compute counts once for each.
      const setters = suppliers.filter((member) => equationsOf(member) > 0)
      const equationCount = setters.reduce((count, member) => count + equationsOf(member), 0)
      if (equationCount > 1 && !suppliers.some(({ key }) => rejected.has(key))) {
        const described = setters.map(describeComputed)
        const times = equationCount > 2 ? 'more than once' : 'twice'
        const verb = described.length === 1 ? `is computed ${times}` : `are ${described.length > 2 ? 'all' : 'both'} computed`
        overdetermine(setters, `${listed(described)} ${verb}; only one module can set a connected variable.`)
        continue
      }
      for (const member of members) {
        if (member.row.type === 'variable') shareWithOthers(member)
        else if (computedFrom.has(member.key)) setStatus(member, 'connected', [...computedFrom.get(member.key)].map(labelOf))
        // An empty sum is set to 0, which emptySums reports.
        else if (!computed.has(member.key)) setStatus(member, 'connected', othersOf(member, suppliers))
      }
      continue
    }

    const boundaries = members.filter(({ row }) => row.type === 'boundary_condition')
    const valued = members.filter((member) => VALUE_REQUIRED_TYPES.has(member.row.type) && hasValue(member))
    // Constants each initialise the group; as with boundary conditions, those agreeing on a value settle it once. A
    // global constant's value is the library's, so only one of the same name agrees with it.
    const valueOf = ({ row }) => (row.type === 'global_constant' ? `global ${row.name}` : String(row.value).trim())
    if (new Set(valued.map(valueOf)).size > 1) {
      const described = valued.map((member) =>
        member.row.type === 'global_constant' ? `${label(member)} (global)` : `${label(member)}=${valueOf(member)}`
      )
      overdetermine(valued, `${listed(described)} are connected but set to different values; give them one value, or let one module compute it.`)
      continue
    }
    const [kept, ...duplicates] = valued
    ignoreValues(duplicates)
    duplicates.forEach((member) => setStatus(member, 'connected', [label(kept)]))

    const setters = members.filter((member) => VALUE_REQUIRED_TYPES.has(member.row.type) && !duplicates.includes(member))
    setters.forEach(shareWithOthers)
    if (!boundaries.length) continue

    // A constant row sets the group.
    if (setters.length) {
      ignoreValues(boundaries)
      boundaries.forEach((member) => setStatus(member, 'connected', setters.map(label)))
      continue
    }

    boundaries.forEach(({ key }) => unsupplied.add(key))
    if (boundaries.length > 1) {
      bcOnly.push({ keys: boundaries.map(({ key }) => key), label: boundaries.map(label).join(', ') })
    }

    const withValues = boundaries.filter(hasValue)
    if (!withValues.length) {
      boundaries.forEach((member) => {
        addTo(missing, member)
        setStatus(member, boundaries.length > 1 ? 'bcOnly' : 'missing', othersOf(member))
      })
      continue
    }

    const distinct = new Set(withValues.map(({ row }) => String(row.value).trim()))
    if (distinct.size > 1) {
      conflicts.push(withValues.map((member) => `${label(member)}=${String(member.row.value).trim()}`).join(', '))
      boundaries.forEach((member) => setStatus(member, 'conflict', othersOf(member)))
      continue
    }

    // The group's variables are equivalent, so one initial value settles them all.
    addTo(supplied, withValues[0])
    ignoreValues(withValues.slice(1))
    boundaries.forEach((member) => setStatus(member, boundaries.length > 1 ? 'bcOnly' : 'own', othersOf(member)))
  }

  return { supplied, missing, conflicts, emptySums, unsupplied, ignored, bcOnly, overdetermined, status }
}
