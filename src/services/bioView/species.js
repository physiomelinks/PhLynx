/**
 * The species network of the physiological view's species mode: the species each compartment holds, which
 * proteins they are coupled to, and the paths species take through a protein from one compartment to another.
 * Read from the sidecars and the user's coupling edges alone: a species is in a compartment when the
 * compartment's own concentration or amount of it is annotated, and a protein carries it to or from there when a
 * coupling joins two ports annotated with that species. Nothing is guessed from names.
 *
 * Flows follow the convention of PhLynx's modules (see transport.js): a molar flow (per area or not)
 * annotated in a place is the rate into that place.
 */

import { OPB, isMolarFlow } from '../annotations/iris.js'
import { displayLabel } from '../annotations/labels.js'
import { selectionLabel } from './autoPlot.js'
import { sideOf } from './sides.js'

/** The properties that say how much of a species a compartment holds, preferred first. */
const AMOUNTS = [OPB.concentration, OPB.amount]
/** The roles that hold species. */
const COMPARTMENT_ROLES = new Set(['cytosol', 'region'])
/** The roles that carry species to and from a compartment. */
const PROTEIN_ROLES = new Set(['membraneProtein', 'cytosolic'])

/**
 * The annotation a port carries on its node: its own (as the sidecar now has it, if it came from there), else
 * the sidecar's annotation of its first variable.
 *
 * @param {Object} port - A coupling's port.
 * @param {Object|null} sidecar - The node's module's parsed sidecar.
 * @returns {Object|null} An annotation with property, species and location.
 */
export function portAnnotation(port, sidecar) {
  const own = port?.annotation
  if (own?.property) return sidecar?.variables?.find((entry) => entry.subject === own.subject) ?? own
  const variable = port?.variables?.[0]
  return (variable && sidecar?.variables?.find((entry) => entry.variable === variable)) || null
}

/** The one species an annotation is of, or null for none or a mixture. */
const speciesOf = (annotation) => (annotation?.species?.length === 1 ? annotation.species[0] : null)

/**
 * A compartment's own species: those whose concentration or amount it annotates as its own ('self'), with its
 * net inflow of each, if annotated.
 *
 * @param {Object|null} sidecar
 * @returns {Map<string, {species: string, variable: string, annotation: Object, flow: Object|null}>} Species ->
 *   its variable and annotation, in the sidecar's order; `flow` is the inflow's annotation.
 */
export function ownSpecies(sidecar) {
  const found = new Map()
  const flows = new Map()
  for (const annotation of sidecar?.variables ?? []) {
    const species = speciesOf(annotation)
    if (!species || annotation.location !== 'self' || !annotation.variable) continue
    if (isMolarFlow(annotation.property)) flows.set(species, flows.get(species) ?? annotation)
    const rank = AMOUNTS.indexOf(annotation.property)
    if (rank < 0) continue
    const held = found.get(species)
    if (!held || rank < AMOUNTS.indexOf(held.annotation.property))
      found.set(species, { species, variable: annotation.variable, annotation })
  }
  return new Map([...found].map(([species, entry]) => [species, { ...entry, flow: flows.get(species) ?? null }]))
}

/**
 * Finds a protein's annotated molar flow of a species on one side of its membrane.
 *
 * @param {Object|null} sidecar
 * @param {string} species
 * @param {'inside'|'outside'} side
 * @returns {Object|null} The annotation.
 */
export function proteinFlow(sidecar, species, side) {
  return (
    sidecar?.variables?.find(
      (annotation) =>
        isMolarFlow(annotation.property) &&
        speciesOf(annotation) === species &&
        sideOf(annotation.location) === side &&
        annotation.variable
    ) ?? null
  )
}

/**
 * Derives the species network.
 *
 * @param {Object} options
 * @param {Array<Object>} options.nodes - The diagram's nodes.
 * @param {Array<Object>} options.edges - The diagram's edges, with their couplings.
 * @param {(id: string) => string|undefined} options.roleOf - A node's physiological role.
 * @param {(node: Object) => Object|null} options.sidecarOf - A node's module's parsed sidecar.
 * @param {boolean} [options.all=false] - Every species a compartment annotates, not only those coupled to it.
 * @param {boolean} [options.fluxes=false] - Only the coupled species with a path through a protein to or from
 *   their compartment: one a protein only reads the amount of, as a pump does its ATP, is left out.
 * @param {{nodeId: string, species: string}|null} [options.keep] - A token shown whatever the rest say, as the
 *   focused one is, if its compartment annotates the species as its own.
 * @returns {{
 *   compartments: Map<string, Array<{species: string, label: string, variable: string, annotation: Object,
 *     flow: Object|null}>>,
 *   links: Array<{protein: string, compartment: string, species: string, kind: 'flow'|'amount',
 *     side: 'inside'|'outside'|null, proteinAnnotation: Object, compartmentAnnotation: Object}>,
 *   paths: Array<{protein: string, species: string, label: string, outside: string, inside: string}>,
 *   dependences: Array<{protein: string, compartment: string, species: string, label: string,
 *     side: 'inside'|'outside'|null}>
 * }} Compartment id -> its species tokens; each coupling of a species between a protein and a compartment; each
 *   way a membrane protein carries a species from outside its cell to inside, through flows coupled on both sides;
 *   and each compartment species a protein reads only the amount of, as a pump does its ATP, with no flow coupled.
 */
export function speciesNetwork({ nodes, edges, roleOf, sidecarOf, all = false, fluxes = false, keep = null }) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const sidecars = new Map()
  const sidecarFor = (id) => {
    if (!sidecars.has(id)) sidecars.set(id, byId.has(id) ? sidecarOf(byId.get(id)) : null)
    return sidecars.get(id)
  }
  const isCompartment = (id) => COMPARTMENT_ROLES.has(roleOf(id))

  const coupled = new Map()
  const links = []
  const seen = new Set()
  for (const edge of edges) {
    const ends = [
      { id: edge.source, port: 'sourcePort' },
      { id: edge.target, port: 'targetPort' },
    ]
    for (const coupling of edge.data?.couplings ?? []) {
      // What each of a compartment's own species it couples.
      for (const end of ends) {
        if (!isCompartment(end.id)) continue
        const annotation = portAnnotation(coupling[end.port], sidecarFor(end.id))
        const species = annotation?.location === 'self' ? speciesOf(annotation) : null
        if (species) coupled.set(end.id, new Set([...(coupled.get(end.id) ?? []), species]))
      }
      const compartment = ends.find((end) => isCompartment(end.id))
      const protein = ends.find((end) => PROTEIN_ROLES.has(roleOf(end.id)))
      if (!compartment || !protein) continue
      const compartmentAnnotation = portAnnotation(coupling[compartment.port], sidecarFor(compartment.id))
      const proteinAnnotation = portAnnotation(coupling[protein.port], sidecarFor(protein.id))
      const species = speciesOf(compartmentAnnotation)
      if (!species || species !== speciesOf(proteinAnnotation)) continue
      const properties = [compartmentAnnotation.property, proteinAnnotation.property]
      const kind = properties.every(isMolarFlow)
        ? 'flow'
        : properties.every((property) => AMOUNTS.includes(property))
          ? 'amount'
          : null
      if (!kind) continue
      const side = sideOf(proteinAnnotation.location)
      const key = [protein.id, compartment.id, species, kind, proteinAnnotation.variable].join('|')
      if (seen.has(key)) continue
      seen.add(key)
      links.push({
        protein: protein.id,
        compartment: compartment.id,
        species,
        kind,
        side: side === 'inside' || side === 'outside' ? side : null,
        proteinAnnotation,
        compartmentAnnotation,
      })
    }
  }

  const isKept = (id, species) => keep?.nodeId === id && keep.species === species
  const compartments = new Map()
  for (const node of nodes) {
    if (!isCompartment(node.id)) continue
    const own = ownSpecies(sidecarFor(node.id))
    const shown = [...own.values()].filter(
      ({ species }) => (all && !fluxes) || coupled.get(node.id)?.has(species) || isKept(node.id, species)
    )
    if (!shown.length) continue
    compartments.set(node.id, shown.map((entry) => ({ ...entry, label: displayLabel(entry.species) })))
  }

  const holds = (id, species) => !!compartments.get(id)?.some((entry) => entry.species === species)
  const paths = []
  const pathKeys = new Set()
  // Only flows carry a species: an amount coupled alone is something the protein depends on.
  for (const link of links) {
    if (link.kind !== 'flow' || link.side !== 'outside' || roleOf(link.protein) !== 'membraneProtein') continue
    for (const inner of links) {
      if (inner.kind !== 'flow' || inner.protein !== link.protein || inner.species !== link.species) continue
      if (inner.side !== 'inside') continue
      if (!holds(link.compartment, link.species) || !holds(inner.compartment, link.species)) continue
      const key = [link.protein, link.species, link.compartment, inner.compartment].join('|')
      if (pathKeys.has(key)) continue
      pathKeys.add(key)
      paths.push({
        protein: link.protein,
        species: link.species,
        label: displayLabel(link.species),
        outside: link.compartment,
        inside: inner.compartment,
      })
    }
  }

  // Only the species a path runs to or from, and the one kept.
  if (fluxes) {
    const flowing = new Set(
      paths.flatMap((path) => [`${path.outside}|${path.species}`, `${path.inside}|${path.species}`])
    )
    for (const [id, entries] of compartments) {
      const kept = entries.filter(({ species }) => flowing.has(`${id}|${species}`) || isKept(id, species))
      if (kept.length) compartments.set(id, kept)
      else compartments.delete(id)
    }
  }

  const same = (a, b) => a.protein === b.protein && a.compartment === b.compartment && a.species === b.species
  const dependences = []
  for (const link of links) {
    if (link.kind !== 'amount' || !holds(link.compartment, link.species)) continue
    if (links.some((other) => other.kind === 'flow' && same(other, link))) continue
    if (dependences.some((other) => same(other, link))) continue
    const { protein, compartment, species, side } = link
    dependences.push({ protein, compartment, species, label: displayLabel(species), side })
  }
  return { compartments, links, paths, dependences }
}

/**
 * The variable whose sign says which way a protein moves a species across its membrane: its flow inside, positive
 * going in; else its flow outside, positive going out.
 *
 * @param {Object|null} sidecar - The protein's.
 * @param {string} species
 * @returns {{variable: string, inward: 1|-1}|null}
 */
export function crossingFlow(sidecar, species) {
  const inside = proteinFlow(sidecar, species, 'inside')
  if (inside) return { variable: inside.variable, inward: 1 }
  const outside = proteinFlow(sidecar, species, 'outside')
  return outside ? { variable: outside.variable, inward: -1 } : null
}

/**
 * What a click on a species token plots, and which instances a Selection run needs for it: the compartment's
 * amount of the species, and every flow of it into the compartment. Those are the proteins' flows coupled to it,
 * with the compartment's own net inflow when it adds them up; where no flow is coupled (a boundary held at a
 * fixed concentration), each coupled protein's flow on that side.
 *
 * @param {Object} network - From speciesNetwork.
 * @param {{nodeId: string, species: string}} focus
 * @param {Object} options
 * @param {(id: string) => string} options.nameOf - An instance's name.
 * @param {(id: string) => Object|null} options.sidecarOf - An instance's module's parsed sidecar.
 * @returns {{entries: Array<{nodeId: string, variable: string, label: string}>, scope: string[]}}
 */
export function speciesFocus(network, { nodeId, species }, { nameOf, sidecarOf }) {
  const token = network.compartments.get(nodeId)?.find((entry) => entry.species === species)
  if (!token) return { entries: [], scope: [] }
  const entry = (id, annotation) => ({
    nodeId: id,
    variable: annotation.variable,
    label: selectionLabel(nameOf(id), annotation),
  })
  const links = network.links.filter((link) => link.compartment === nodeId && link.species === species)
  const flows = links.filter((link) => link.kind === 'flow')
  const entries = [entry(nodeId, token.annotation)]
  if (flows.length) {
    if (token.flow) entries.push(entry(nodeId, token.flow))
    entries.push(...flows.map((link) => entry(link.protein, link.proteinAnnotation)))
  } else {
    for (const link of links) {
      const flow = link.side && proteinFlow(sidecarOf(link.protein), species, link.side)
      if (flow) entries.push(entry(link.protein, flow))
    }
  }
  const unique = [...new Map(entries.map((item) => [`${item.nodeId}::${item.variable}`, item])).values()]
  return { entries: unique, scope: [...new Set([nodeId, ...links.map((link) => link.protein)])] }
}
