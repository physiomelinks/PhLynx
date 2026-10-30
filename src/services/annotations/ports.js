/**
 * Ports for annotated quantities, and edges for accepted suggestions, in the workspace's port and coupling shapes.
 */

import { roleOf } from './match.js'

const MULTIPORT_BY_ROLE = { owner: 'True', reader: 'None', aggregator: 'Sum', contributor: 'None' }

/**
 * The multiport type a port with this role gets: an owner shares, an aggregator sums, the others link once.
 *
 * @param {string} role
 * @returns {'True'|'Sum'|'None'}
 */
export function multiportTypeFor(role) {
  return MULTIPORT_BY_ROLE[role] ?? 'None'
}

/**
 * The port carrying one annotated quantity. The label stays empty: the annotation identifies the port.
 *
 * @param {{ instance?: string, variable: string, subject: string, property: string, species: string[],
 *   location: string, role: string, mathRef: string }} quantity - From quantitiesFor, or a coupling side.
 * @returns {{ portType: 'general_ports', label: '', variables: string[], multiportType: string,
 *   annotation: object }}
 */
export function portFor(quantity) {
  return {
    portType: 'general_ports',
    label: '',
    variables: [quantity.variable],
    multiportType: multiportTypeFor(quantity.role),
    annotation: {
      subject: quantity.subject,
      variable: quantity.variable,
      property: quantity.property,
      species: [...(quantity.species ?? [])],
      location: quantity.location,
      role: quantity.role,
      source: { kind: 'sidecar', mathRef: quantity.mathRef },
    },
  }
}

/**
 * Whether a port carries its own math's sidecar annotation, as reconcileAnnotatedPorts manages.
 *
 * @param {Object} port
 * @returns {boolean}
 */
export const isSidecarPort = (port) => !!port?.annotation?.subject && port.annotation.source?.kind === 'sidecar'

const isCompleteEntry = (entry) => !!(entry.subject && entry.property && entry.location)
const portVariable = (port) => port.variables?.[0] ?? port.annotation.variable

/**
 * Refreshes a sidecar port from its entry, keeping its type, label and other fields. The multiport type follows
 * the role only when the role changes.
 *
 * @param {Object} port
 * @param {Object} entry - A complete sidecar entry.
 * @param {string} mathRef
 * @returns {Object}
 */
function refreshPort(port, entry, mathRef) {
  const fresh = portFor({ ...entry, role: roleOf(entry), mathRef })
  const isRoleChanged = port.annotation.role !== fresh.annotation.role
  return {
    ...port,
    variables: fresh.variables,
    multiportType: isRoleChanged ? fresh.multiportType : port.multiportType,
    annotation: { ...port.annotation, ...fresh.annotation },
  }
}

/**
 * Brings a node's sidecar ports in line with its math's sidecar: each complete entry (subject, property and
 * location) gets exactly one sidecar port. A port is matched by subject, else by variable, so a renamed math or
 * variable keeps its port. Mirrored and label ports are left as they are; partial entries get no port.
 *
 * @param {Array<Object>} ports - The node's ports; not changed.
 * @param {Object|null} sidecar - From parseSidecar; null when the math has none. An unreadable one changes nothing.
 * @param {Object} options
 * @param {string} options.mathRef - The node's math.
 * @param {Iterable<string>} [options.variables] - The math's variable names; entries for others get no port.
 * @returns {{ ports: Array<Object>, added: Array<Object>, removed: Array<Object>,
 *   changed: Array<{ before: Object, after: Object }> }}
 */
export function reconcileAnnotatedPorts(ports, sidecar, { mathRef, variables } = {}) {
  const current = ports ?? []
  if (sidecar?.unreadable) return { ports: current, added: [], removed: [], changed: [] }
  const known = variables ? new Set(variables) : null
  const entries = (sidecar?.variables ?? []).filter(
    (entry) => isCompleteEntry(entry) && (!known || known.has(entry.variable))
  )

  const claimed = new Map()
  const unclaimed = new Set(entries)
  const sidecarPorts = current.filter(isSidecarPort)
  for (const port of sidecarPorts) {
    const entry = [...unclaimed].find((candidate) => candidate.subject === port.annotation.subject)
    if (entry) {
      claimed.set(port, entry)
      unclaimed.delete(entry)
    }
  }
  for (const port of sidecarPorts) {
    if (claimed.has(port)) continue
    const entry = [...unclaimed].find((candidate) => candidate.variable === portVariable(port))
    if (entry) {
      claimed.set(port, entry)
      unclaimed.delete(entry)
    }
  }

  const removed = []
  const changed = []
  const kept = current.flatMap((port) => {
    if (!isSidecarPort(port)) return [port]
    const entry = claimed.get(port)
    if (!entry) {
      removed.push(port)
      return []
    }
    const after = refreshPort(port, entry, mathRef)
    if (JSON.stringify(after) === JSON.stringify(port)) return [port]
    changed.push({ before: port, after })
    return [after]
  })
  const added = entries
    .filter((entry) => unclaimed.has(entry))
    .map((entry) => portFor({ ...entry, role: roleOf(entry), mathRef }))
  return { ports: [...kept, ...added], added, removed, changed }
}

/**
 * Edges for suggestions, one per suggestion whose two instances have nodes.
 *
 * @param {Array<{ sourceName: string, targetName: string, couplings: Array<{ source: object, target: object }> }>}
 *   suggestions - From suggestCouplings.
 * @param {Map<string, { id: string }>|Object<string, { id: string }>} nodesByName - Nodes by instance name.
 * @returns {Array<{ id: string, source: string, target: string, data: { couplings: Array<{ sourcePort: object,
 *   targetPort: object }> } }>}
 */
export function couplingsToEdges(suggestions, nodesByName) {
  const nodeFor = (name) => (nodesByName instanceof Map ? nodesByName.get(name) : nodesByName?.[name])
  const edges = []
  for (const suggestion of suggestions) {
    const source = nodeFor(suggestion.sourceName)
    const target = nodeFor(suggestion.targetName)
    if (!source || !target) continue
    edges.push({
      id: `${source.id}--${target.id}`,
      source: source.id,
      target: target.id,
      data: {
        couplings: suggestion.couplings.map((coupling) => ({
          sourcePort: portFor(coupling.source),
          targetPort: portFor(coupling.target),
        })),
      },
    })
  }
  return edges
}
