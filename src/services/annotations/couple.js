/**
 * Annotated ports on workspace nodes: a port's quantity, the compatibility of two annotated ports, the mirrored
 * annotation a copied port gets, and the ports for annotated couplings. Pure: the caller passes the parsed
 * side-cars as a context.
 */

import { GO } from './iris.js'
import { pairing, roleOf } from './match.js'
import { variableNamesOf } from './nodeData.js'
import { multiportTypeFor, portFor } from './ports.js'

const COMPLEMENTARY_ROLES = { owner: 'reader', reader: 'owner', aggregator: 'contributor', contributor: 'aggregator' }
// The side-car locations a copied annotation may take, most specific to the instance first.
const RELATIVE_LOCATIONS = [
  'self',
  `self+${GO.plasmaMembrane}`,
  GO.cytoplasm,
  GO.plasmaMembrane,
  GO.extracellularRegion,
]

/**
 * Builds the context the functions here read.
 *
 * @param {Object} options
 * @param {(mathRef: string) => Object|null} [options.sidecarFor] - A math's parsed side-car.
 * @param {Array<Object>} [options.nodes] - Workspace nodes.
 * @returns {{ sidecarFor: Function, nodes: Array<Object> }}
 */
export function buildCouplingContext({ sidecarFor = () => null, nodes } = {}) {
  return { sidecarFor, nodes: nodes ?? [] }
}

/**
 * The places a node's annotated quantities resolve against; none until placement is known.
 *
 * @param {Object} node
 * @param {Object} context - From buildCouplingContext.
 * @returns {Array<Object>}
 */
export function placesOf(node, context) {
  return []
}

// The side-car entry a side-car-sourced annotation came from, as the side-car is now.
function sidecarEntry(annotation, node, context) {
  if (annotation.source?.kind !== 'sidecar') return null
  const mathRef = annotation.source.mathRef ?? node?.data?.mathRef
  const sidecar = mathRef ? context?.sidecarFor?.(mathRef) : null
  return sidecar?.variables.find((entry) => entry.subject === annotation.subject) ?? null
}

/**
 * The quantity an annotated port carries on its node. A side-car-sourced port reads the side-car as it is now
 * when it is parsed, else its own copy.
 *
 * @param {Object} port
 * @param {Object} node
 * @param {Object} context - From buildCouplingContext.
 * @returns {Object|null} Null for an unannotated port, or one on a variable its node's math lacks.
 */
export function quantityOfPort(port, node, context) {
  const annotation = port?.annotation
  if (!annotation?.subject) return null
  const known = variableNamesOf(node?.data)
  if (known && (port.variables ?? []).some((name) => name && !known.includes(name))) return null
  const entry = sidecarEntry(annotation, node, context)
  const { property, location } = entry ?? annotation
  const species = [...new Set(entry?.species ?? annotation.species ?? [])].sort()
  const role = entry || !annotation.role ? roleOf({ property, location }) : annotation.role
  return {
    instance: node?.id,
    variable: port.variables?.[0] ?? annotation.variable,
    subject: annotation.subject,
    property,
    species,
    location,
    role,
    mathRef: annotation.source?.mathRef ?? node?.data?.mathRef,
    locations: annotation.absoluteLocation ? [annotation.absoluteLocation] : [],
  }
}

/**
 * Whether two annotated ports on two nodes couple: same property and species, complementary roles and the same
 * place once located.
 *
 * @param {Object} portA
 * @param {Object} nodeA
 * @param {Object} portB
 * @param {Object} nodeB
 * @param {Object} context - From buildCouplingContext.
 * @returns {boolean}
 */
export function annotatedCompatible(portA, nodeA, portB, nodeB, context) {
  const qa = quantityOfPort(portA, nodeA, context)
  const qb = quantityOfPort(portB, nodeB, context)
  return !!qa && !!qb && pairing(qa, qb) !== null
}

/**
 * Whether two annotated ports on two nodes carry the same property and species in complementary roles, leaving
 * their places aside.
 *
 * @param {Object} portA
 * @param {Object} nodeA
 * @param {Object} portB
 * @param {Object} nodeB
 * @param {Object} context - From buildCouplingContext.
 * @returns {boolean}
 */
export function annotationsAgree(portA, nodeA, portB, nodeB, context) {
  const qa = quantityOfPort(portA, nodeA, context)
  const qb = quantityOfPort(portB, nodeB, context)
  if (!qa || !qb || qa.property !== qb.property || COMPLEMENTARY_ROLES[qa.role] !== qb.role) return false
  return qa.species.length === qb.species.length && qa.species.every((term, index) => term === qb.species[index])
}

const contributionOf = (port) => port?.annotation?.contribution ?? 0

/**
 * The annotation a new port on one node gets to couple with an annotated partner: the complementary role, the
 * same property and species, and a location that resolves, from the node's places, to the partner's place. When
 * no location does, or the node is not placed, it keeps the partner's resolved place.
 *
 * @param {Object} partnerPort
 * @param {Object} partnerNode
 * @param {Object} node - The node the copy goes on.
 * @param {Object} context - From buildCouplingContext.
 * @param {Array<Object>} [ports] - The node's ports, so a second copy of one subject gets the next contribution.
 * @returns {Object|null} Null when the partner is unannotated.
 */
export function mirrorAnnotation(partnerPort, partnerNode, node, context, ports = []) {
  const partner = quantityOfPort(partnerPort, partnerNode, context)
  if (!partner) return null
  const role = COMPLEMENTARY_ROLES[partner.role]
  const copy = { instance: node?.id, property: partner.property, species: partner.species, role }

  let place = null
  for (const location of placesOf(node, context).length ? RELATIVE_LOCATIONS : []) {
    if (roleOf({ property: partner.property, location }) !== role) continue
    const pair = pairing(partner, { ...copy, location, locations: [] })
    if (pair) {
      place = { location }
      break
    }
  }
  const resolved = partner.locations.find((entry) => !entry.unresolved)

  const subject = partnerPort.annotation.subject
  const taken = ports.filter((port) => port?.annotation?.subject === subject).map(contributionOf)
  const contribution = taken.length ? Math.max(...taken) + 1 : 0
  return {
    subject,
    variable: '',
    ...(contribution ? { contribution } : {}),
    property: partner.property,
    species: [...partner.species],
    location: place?.location ?? null,
    ...(!place && resolved ? { absoluteLocation: JSON.parse(JSON.stringify(resolved)) } : {}),
    role,
    source: {
      kind: 'copied',
      mathRef: node?.data?.mathRef ?? null,
      copiedFrom: { subject, mathRef: partner.mathRef ?? null, instance: partnerNode?.data?.name ?? partnerNode?.id },
    },
  }
}

/**
 * A new, empty port carrying a mirrored annotation, for the user to pick its variable.
 *
 * @param {Object} annotation - From mirrorAnnotation.
 * @param {string} [portType='general_ports']
 * @returns {Object}
 */
export function mirroredPort(annotation, portType = 'general_ports') {
  return { portType, label: '', variables: [], multiportType: multiportTypeFor(annotation.role), annotation }
}

// Port types that can carry a coupling out of the edge's source, and into its target from a general port.
const SOURCE_SIDE_TYPES = new Set(['exit_ports', 'general_ports'])
const TARGET_SIDE_TYPES = new Set(['entrance_ports', 'general_ports', 'exit_ports'])

/**
 * The ports for annotated couplings on an edge: an annotated port already on a node with the same subject (first
 * contribution), and of a type that may sit at its end of the edge, is reused; otherwise a new general port is
 * made. A reused exit port at the target only pairs with a general port at the source (see edges.js).
 *
 * @param {Object} sourceNode - The edge's source.
 * @param {Object} targetNode - The edge's target.
 * @param {Array<{ source: Object, target: Object }>} couplings - Quantities in the edge's direction.
 * @returns {{ couplings: Array<{ sourcePort: Object, targetPort: Object }>, addedPorts: Map<string, Array<Object>> }}
 *   addedPorts holds each node's new ports, to add to its data.
 */
export function portsForCouplings(sourceNode, targetNode, couplings) {
  const addedPorts = new Map()
  const portOn = (node, quantity, isUsable) => {
    const added = addedPorts.get(node.id) ?? []
    const existing = [...(node.data.ports ?? []), ...added].find(
      (port) => port.annotation?.subject === quantity.subject && !contributionOf(port) && isUsable(port)
    )
    if (existing) return existing
    const port = portFor(quantity)
    addedPorts.set(node.id, [...(addedPorts.get(node.id) ?? []), port])
    return port
  }
  const result = couplings.map((coupling) => {
    const sourcePort = portOn(sourceNode, coupling.source, (port) => SOURCE_SIDE_TYPES.has(port.portType))
    const targetPort = portOn(
      targetNode,
      coupling.target,
      (port) =>
        TARGET_SIDE_TYPES.has(port.portType) && (port.portType !== 'exit_ports' || sourcePort.portType === 'general_ports')
    )
    return { sourcePort, targetPort }
  })
  return { couplings: result, addedPorts }
}
