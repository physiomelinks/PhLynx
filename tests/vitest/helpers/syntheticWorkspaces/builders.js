/**
 * Builders shared by the synthetic workspaces: minimal CellML, the nodes, edges and store entries of format
 * 1.0.0 on, and the merge that puts a version's cases into one file.
 */

export const UNITS_FILE = 'units.cellml'

const UNITS_MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <units name="mM"><unit prefix="milli" units="mole"/><unit units="litre" exponent="-1"/></units>
  <units name="mV"><unit prefix="milli" units="volt"/></units>
</model>`

/** The legacy store's units file. */
export const legacyUnits = () => ({ filename: UNITS_FILE, model: UNITS_MODEL })

/** The units file of format 1.0.0 on. */
export const units = () => ({ componentFile: UNITS_FILE, model: UNITS_MODEL })

/**
 * Builds a CellML component.
 *
 * @param {string} name
 * @param {Array<[string, string, string?]>} variables - Name, units and initial value, if any.
 * @param {string} [math] - Its MathML.
 * @returns {string}
 */
export function component(name, variables, math = '') {
  const declarations = variables.map(
    ([variable, units, initial]) =>
      `    <variable name="${variable}" units="${units}"${initial == null ? '' : ` initial_value="${initial}"`} interface="public"/>`
  )
  return [`  <component name="${name}">`, ...declarations, ...(math ? [math] : []), '  </component>'].join('\n')
}

/**
 * Builds a CellML model.
 *
 * @param {string} name
 * @param {Array<string>} components - From `component`.
 * @returns {string}
 */
export const model = (name, components) => `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="${name}">
${components.join('\n')}
</model>`

const mathml = (...equations) => `    <math xmlns="http://www.w3.org/1998/Math/MathML">
${equations.map((equation) => `      ${equation}`).join('\n')}
    </math>`

// dx/dt = -k * x.
const DECAY_MATH = mathml(
  '<apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply></apply>'
)

/**
 * Builds a decay component, dx/dt = -k * x, as math before 1.1.0 held it: with numeric initial values.
 *
 * @param {string} name
 * @param {{x?: ?string, k?: ?string}} [initialValues] - null for none.
 * @returns {string}
 */
export const decay = (name, { x = '1.5', k = '0.5' } = {}) =>
  component(
    name,
    [
      ['t', 'second'],
      ['x', 'metre', x],
      ['k', 'per_second', k],
    ],
    DECAY_MATH
  )

/**
 * Builds a decay component as math from 1.1.0 on holds it: x starts from x_init, and nothing has a value.
 *
 * @param {string} name
 * @returns {string}
 */
export const separatedDecay = (name) =>
  component(
    name,
    [
      ['t', 'second'],
      ['x', 'metre', 'x_init'],
      ['x_init', 'metre'],
      ['k', 'per_second'],
    ],
    DECAY_MATH
  )

/**
 * Builds a component computing `out = gain * in`.
 *
 * @param {string} name
 * @param {string} gainName
 * @returns {string}
 */
export const gain = (name, gainName) =>
  component(
    name,
    [
      ['in', 'mM'],
      ['out', 'mM'],
      [gainName, 'dimensionless'],
    ],
    mathml(`<apply><eq/><ci>out</ci><apply><times/><ci>${gainName}</ci><ci>in</ci></apply></apply>`)
  )

/** A store `availableMath` entry: one component in a model of its own, as the library keeps it. */
export const mathEntry = (mathRef, componentXml) => [mathRef, model('PhLynxComponent', [componentXml])]

/** A node's parameter row. */
export const row = (name, units, type, value = '', extra = {}) => ({
  name,
  units,
  access: 'access',
  value,
  type,
  data_reference: null,
  ...extra,
})

/** A node or module port. */
export const port = (portType, label, variables, multiportType = 'None') => ({ portType, label, variables, multiportType })

const handleUid = (nodeId, side) => `${nodeId}-${side}`

/**
 * Builds a node's handles: a connection site on the right for edges out, one on the left for edges in, and a
 * ghost on top.
 *
 * @param {string} nodeId
 * @returns {Array<Object>}
 */
const handles = (nodeId) => [
  { uid: handleUid(nodeId, 'right'), side: 'right', name: '', variant: 'default', type: 'source' },
  { uid: handleUid(nodeId, 'left'), side: 'left', name: '', variant: 'default', type: 'target' },
  { uid: handleUid(nodeId, 'top'), side: 'top', name: '', variant: 'ghost' },
]

/**
 * Builds a node of format 1.0.0 on.
 *
 * @param {string} id
 * @param {string} name
 * @param {{mathRef: string, moduleRef: string, variables?: Array, ports?: Array}} data
 * @returns {Object}
 */
export const instanceNode = (id, name, { mathRef, moduleRef, variables = [], ports = [] }) => ({
  id,
  type: 'instanceNode',
  initialized: false,
  position: { x: 0, y: 0 },
  data: { name, mathRef, moduleRef, variables, ports, handles: handles(id) },
  style: { opacity: 1 },
})

/**
 * Builds an edge of format 1.0.0 on, from the source's right handle to the target's left one.
 *
 * @param {string} source - Node id.
 * @param {string} target - Node id.
 * @param {Array<{sourcePort: Object, targetPort: Object}>} couplings
 * @returns {Object}
 */
export const edge = (source, target, couplings) => ({
  id: `${source}--${target}`,
  type: 'smoothstep',
  source,
  target,
  sourceHandle: `handle_${handleUid(source, 'right')}`,
  targetHandle: `handle_${handleUid(target, 'left')}`,
  data: { couplings },
  label: '',
  markerEnd: 'arrowclosed',
  style: { strokeWidth: 5 },
  sourceX: 0,
  sourceY: 0,
  targetX: 0,
  targetY: 0,
})

/**
 * Builds the store entries of a library module and its math's collection, for format 1.0.0 on.
 *
 * @param {string} moduleRef
 * @param {string} mathRef
 * @param {{ports?: Array, variables?: Array, isStub?: boolean}} [fields]
 * @returns {Object} A part, for mergeParts.
 */
export const libraryModule = (moduleRef, mathRef, { ports = [], variables = [], isStub } = {}) => ({
  store: {
    availableModules: [[moduleRef, { moduleRef, mathRef, ports, variables, ...(isStub && { isStub }) }]],
    availableCollections: [[mathRef, [moduleRef]]],
  },
})

const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Merges parts of a workspace: arrays are appended to, objects merged, and other values replaced.
 *
 * @param {...Object} parts
 * @returns {Object} A new object.
 */
export function mergeParts(...parts) {
  const merged = {}
  for (const part of parts) {
    for (const [key, value] of Object.entries(part)) {
      const existing = merged[key]
      if (Array.isArray(existing) && Array.isArray(value)) merged[key] = [...existing, ...value]
      else if (isPlainObject(existing) && isPlainObject(value)) merged[key] = mergeParts(existing, value)
      else merged[key] = structuredClone(value)
    }
  }
  return merged
}
