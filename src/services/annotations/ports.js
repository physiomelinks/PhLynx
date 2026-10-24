/**
 * Ports for annotated quantities, and edges for accepted suggestions, in the workspace's port and coupling shapes.
 */

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
