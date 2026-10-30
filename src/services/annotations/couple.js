/**
 * Annotated ports on workspace nodes: locating a port's quantity from its node's ApiCoord binding, the
 * compatibility of two annotated ports, the mirrored annotation a copied port gets, and the annotated couplings
 * between two bound nodes. Pure: the caller passes the parsed instance files and sidecars as a context.
 */

import { GO } from './iris.js'
import { locate } from './locate.js'
import { pairing, resolveFacing, roleOf, suggestCouplings } from './match.js'
import { multiportTypeFor, portFor } from './ports.js'

const COMPLEMENTARY_ROLES = { owner: 'reader', reader: 'owner', aggregator: 'contributor', contributor: 'aggregator' }
// The sidecar locations a copied annotation may take, most specific to the instance first.
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
 * @param {{ instances: Array, coords: Map, scopes: Map }|null} [options.apiCoords] - The merged instance files.
 * @param {(mathRef: string) => Object|null} [options.sidecarFor] - A math's parsed sidecar.
 * @param {Array<Object>} [options.nodes] - Workspace nodes; their bound coords decide what a basolateral facet
 *   faces. Without them the instance files' instances do.
 * @returns {{ coords: Map, scopes: Map, sidecarFor: Function, instances: Array<{ name: string, label?: string,
 *   coord: Object }> }}
 */
export function buildCouplingContext({ apiCoords = null, sidecarFor = () => null, nodes } = {}) {
  const coords = apiCoords?.coords ?? new Map()
  const context = { coords, scopes: apiCoords?.scopes ?? new Map(), sidecarFor, instances: [] }
  context.instances = nodes
    ? nodes.flatMap((node) => {
        const coord = coordOf(node, context)
        // Matched by node id; named in messages by the instance's name.
        return coord ? [{ name: node.id, label: node.data?.name ?? node.id, coord }] : []
      })
    : (apiCoords?.instances ?? []).map(({ name, coord }) => ({ name, coord }))
  return context
}

/**
 * The coordinate a node is bound to, if its instance file is loaded.
 *
 * @param {Object} node
 * @param {Object} context - From buildCouplingContext.
 * @returns {Object|null}
 */
export function coordOf(node, context) {
  const coordIri = node?.data?.apiCoord?.coordIri
  return (coordIri && context?.coords?.get(coordIri)) || null
}

// The sidecar entry a sidecar-sourced annotation came from, as the sidecar is now.
function sidecarEntry(annotation, node, context) {
  if (annotation.source?.kind !== 'sidecar') return null
  const mathRef = annotation.source.mathRef ?? node?.data?.mathRef
  const sidecar = mathRef ? context?.sidecarFor?.(mathRef) : null
  return sidecar?.variables.find((entry) => entry.subject === annotation.subject) ?? null
}

/**
 * The located quantity an annotated port carries on its node, as the matcher reads it. A sidecar-sourced port
 * reads the sidecar as it is now when it is parsed, else its own copy.
 *
 * @param {Object} port
 * @param {Object} node
 * @param {Object} context - From buildCouplingContext.
 * @returns {Object|null} Null for an unannotated port.
 */
export function quantityOfPort(port, node, context) {
  const annotation = port?.annotation
  if (!annotation?.subject) return null
  const entry = sidecarEntry(annotation, node, context)
  const { property, location } = entry ?? annotation
  const species = [...new Set(entry?.species ?? annotation.species ?? [])].sort()
  const role = entry || !annotation.role ? roleOf({ property, location }) : annotation.role
  const coord = coordOf(node, context)
  const locations = annotation.absoluteLocation
    ? [annotation.absoluteLocation]
    : coord && location
      ? locate(coord, location, context)
      : []
  const quantity = {
    instance: node?.id,
    variable: port.variables?.[0] ?? annotation.variable,
    subject: annotation.subject,
    property,
    species,
    location,
    role,
    mathRef: annotation.source?.mathRef ?? node?.data?.mathRef,
    locations,
  }
  return resolveFacing([quantity], context?.instances ?? [])[0]
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

const contributionOf = (port) => port?.annotation?.contribution ?? 0

/**
 * The annotation a new port on one node gets to couple with an annotated partner: the complementary role, the
 * same property and species, and a location that resolves, from the node's coord, to the partner's place. When
 * no location does, or the node has no coord, it keeps the partner's resolved place.
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
  const coord = coordOf(node, context)

  let place = null
  for (const location of coord ? RELATIVE_LOCATIONS : []) {
    if (roleOf({ property: partner.property, location }) !== role) continue
    const candidate = resolveFacing(
      [{ ...copy, location, locations: locate(coord, location, context) }],
      context?.instances ?? []
    )[0]
    const pair = pairing(partner, candidate)
    if (pair && (!place || (place.confidence === 'low' && pair.confidence === 'high'))) {
      place = { location, confidence: pair.confidence }
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

/**
 * Whether a node may take part in annotated coupling: bound to a loaded coord, on a math with a parsed sidecar.
 *
 * @param {Object} node
 * @param {Object} context - From buildCouplingContext.
 * @returns {boolean}
 */
export function isLocatedNode(node, context) {
  return !!coordOf(node, context) && !!context?.sidecarFor?.(node?.data?.mathRef)
}

/**
 * The annotated couplings the matcher suggests between two located nodes, in the edge's direction, with the
 * ports they use: an annotated port already on a node is reused, otherwise a new one is made.
 *
 * @param {Object} sourceNode
 * @param {Object} targetNode
 * @param {Array<Object>} nodes - Every workspace node, located or not.
 * @param {Object} context - From buildCouplingContext.
 * @returns {{ couplings: Array<{ sourcePort: Object, targetPort: Object }>, addedPorts: Map<string, Array<Object>> }}
 *   addedPorts holds each node's new ports, to add to its data.
 */
export function annotatedCouplingsBetween(sourceNode, targetNode, nodes, context) {
  const empty = { couplings: [], addedPorts: new Map() }
  if (!isLocatedNode(sourceNode, context) || !isLocatedNode(targetNode, context)) return empty
  const located = nodes.filter((node) => isLocatedNode(node, context))
  const instances = located.map((node) => ({
    name: node.id,
    label: node.data?.name ?? node.id,
    coord: coordOf(node, context),
    sidecar: context.sidecarFor(node.data.mathRef),
  }))
  const heldConstant = new Set(
    located.filter((node) => node.data.annotationOverlay?.heldConstant).map((node) => node.id)
  )
  const { suggestions } = suggestCouplings(instances, { coords: context.coords, scopes: context.scopes, heldConstant })
  const suggestion = suggestions.find(
    ({ sourceName, targetName }) =>
      (sourceName === sourceNode.id && targetName === targetNode.id) ||
      (sourceName === targetNode.id && targetName === sourceNode.id)
  )
  if (!suggestion) return empty

  const reversed = suggestion.sourceName !== sourceNode.id
  const couplings = suggestion.couplings.map((coupling) =>
    reversed ? { source: coupling.target, target: coupling.source } : coupling
  )
  return portsForCouplings(sourceNode, targetNode, couplings)
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
 * @param {Array<{ source: Object, target: Object }>} couplings - Quantities in the edge's direction, as in a
 *   suggestion's couplings.
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
