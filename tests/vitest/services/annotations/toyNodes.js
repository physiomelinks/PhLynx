import { buildCouplingContext } from '../../../../src/services/annotations/couple.js'
import { roleOf } from '../../../../src/services/annotations/match.js'
import { portFor } from '../../../../src/services/annotations/ports.js'
import { TOY_MODULES, loadToy } from './toyModel.js'

const mathRefOf = (name) => `${TOY_MODULES[name]}.cellml:${TOY_MODULES[name]}`

/**
 * The toy model as workspace nodes bound to their ApiCoords, with a coupling context.
 *
 * @returns {Promise<{ toy: Object, apiCoords: Object, sidecarFor: Function, node: Function, port: Function,
 *   context: Function }>} node(name, ports?, data?) makes a bound node; port(name, variable) the annotated port
 *   for a sidecar variable; context(nodes?) a coupling context.
 */
export async function loadToyNodes() {
  const toy = await loadToy()
  const apiCoords = { instances: toy.instances, coords: toy.coords, scopes: toy.scopes }
  const sidecarFor = (mathRef) => [...toy.sidecars.values()].find((sidecar) => sidecar.mathRef === mathRef) ?? null

  const node = (name, ports = [], data = {}) => {
    const instance = toy.instances.find((candidate) => candidate.name === name)
    return {
      id: `node_${name}`,
      position: { x: 0, y: 0 },
      data: {
        name,
        mathRef: mathRefOf(name),
        ports,
        ...(instance ? { apiCoord: { subject: instance.subject, coordIri: instance.coordIri, name } } : {}),
        ...data,
      },
    }
  }

  const port = (name, variable) => {
    const sidecar = sidecarFor(mathRefOf(name))
    const entry = sidecar.variables.find((candidate) => candidate.variable === variable)
    if (!entry) throw new Error(`No ${variable} in ${name}'s sidecar`)
    return portFor({ ...entry, role: roleOf(entry), mathRef: sidecar.mathRef })
  }

  const context = (nodes) => buildCouplingContext({ apiCoords, sidecarFor, nodes })

  return { toy, apiCoords, sidecarFor, node, port, context }
}
