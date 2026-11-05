import { buildCouplingContext } from '../../../../src/services/annotations/couple.js'
import { PLACEMENT_SOURCE } from '../../../../src/services/annotations/locationSources.js'
import { roleOf } from '../../../../src/services/annotations/match.js'
import { portFor } from '../../../../src/services/annotations/ports.js'
import { getBuiltInTemplate } from '../../../../src/services/bioView/builtInTemplates.js'
import { TOY_MODULES, loadToy } from './toyModel.js'

const mathRefOf = (name) => `${TOY_MODULES[name]}.cellml:${TOY_MODULES[name]}`

/** The template instance the toy instances are placed on. */
export const TOY_TEMPLATE_INSTANCE = 'bt-toy'

/** The site of the epithelial-cell template each toy instance is placed at. */
export const TOY_PLACEMENTS = {
  outside: 'apical-fluid',
  cell: 'cell',
  wall: 'cell.membrane',
  porter_in: 'cell.apical',
  porter_out: 'cell.basolateral',
  vessel: 'basolateral-fluid',
}

/** What the placement source reads: one epithelial-cell template instance. */
export const TOY_TEMPLATES = {
  instances: [{ id: TOY_TEMPLATE_INSTANCE, template: 'epithelial-cell', at: { x: 0, y: 0 } }],
  definitions: new Map([['epithelial-cell', getBuiltInTemplate('epithelial-cell')]]),
}

/**
 * The toy model as workspace nodes placed on an epithelial-cell template, with a coupling context.
 *
 * @returns {Promise<{ toy: Object, sidecarFor: Function, node: Function, unplaced: Function, port: Function,
 *   context: Function }>} node(name, ports?, data?) makes a node placed at its TOY_PLACEMENTS site; unplaced(…) the
 *   same node with no place; port(name, variable) the annotated port for a side-car variable; context(nodes?) a
 *   coupling context with the placement source.
 */
export async function loadToyNodes() {
  const toy = await loadToy()
  const sidecarFor = (mathRef) => [...toy.sidecars.values()].find((sidecar) => sidecar.mathRef === mathRef) ?? null

  const node = (name, ports = [], data = {}) => ({
    id: `node_${name}`,
    position: { x: 0, y: 0 },
    data: {
      name,
      mathRef: mathRefOf(name),
      ports,
      ...(TOY_PLACEMENTS[name] ? { bioView: { site: `${TOY_TEMPLATE_INSTANCE}/${TOY_PLACEMENTS[name]}` } } : {}),
      ...data,
    },
  })

  const unplaced = (name, ports = [], data = {}) => node(name, ports, { bioView: undefined, ...data })

  const port = (name, variable) => {
    const sidecar = sidecarFor(mathRefOf(name))
    const entry = sidecar.variables.find((candidate) => candidate.variable === variable)
    if (!entry) throw new Error(`No ${variable} in ${name}'s side-car`)
    return portFor({ ...entry, role: roleOf(entry), mathRef: sidecar.mathRef })
  }

  const context = (nodes) => buildCouplingContext({ sidecarFor, nodes, source: PLACEMENT_SOURCE, data: TOY_TEMPLATES })

  return { toy, sidecarFor, node, unplaced, port, context }
}
