/**
 * Planning the "Apply annotations" import: which library math each sidecar describes, which module each ApiCoord
 * instance runs, which existing node it binds to, and where new instances go. Pure: no Vue, no stores.
 */

import { parseRdf } from './rdf.js'
import { createGraph } from './graph.js'
import { SIDECAR_BASE_IRI, componentKind } from './sidecar.js'
import { BQBIOL, SBO, canonicalCurie, splitSubject } from './iris.js'
import { rankOf, roleOf } from './match.js'

/**
 * Finds the component a sidecar annotates: the one subject without a '.' in its fragment whose bqbiol:is says
 * what a module is (uniprot, GO:0005886 or SBO:0000290).
 *
 * @param {string} text - The sidecar RDF.
 * @param {{ format?: string }} [options]
 * @returns {Promise<{ file: string, componentName: string, mathRef: string, kind: string, is: string[] }|null>}
 *   Null when there is no such subject or more than one.
 * @throws {Error} When the text is not valid RDF.
 */
export async function readSidecarComponent(text, { format = 'turtle' } = {}) {
  const graph = createGraph(await parseRdf(text, { format, baseIri: SIDECAR_BASE_IRI }))
  const found = graph.subjectsOf().flatMap((term) => {
    const part = term.termType === 'NamedNode' ? splitSubject(term.value) : null
    if (!part || part.fragment.includes('.')) return []
    const is = graph.objects(term, BQBIOL.is).map((object) => canonicalCurie(object.value))
    const kind = componentKind(is)
    return kind ? [{ file: part.file, componentName: part.fragment, kind, is }] : []
  })
  if (found.length !== 1) return null
  const [component] = found
  return { ...component, mathRef: `${component.file}:${component.componentName}` }
}

/**
 * The RDF format of a file, from its name: RDF/XML for .rdf, .xml or .owl, else Turtle.
 *
 * @param {string} filename
 * @returns {'rdfxml'|'turtle'}
 */
export function rdfFormatOf(filename) {
  return /\.(rdf|xml|owl)$/i.test(filename ?? '') ? 'rdfxml' : 'turtle'
}

const componentOf = (mathRef) => mathRef.slice(mathRef.indexOf(':') + 1)

/**
 * Matches a sidecar to library math by its subject's file#component. Without that math, the maths with the same
 * component name in another file are offered (one is preselected). A math with another component name is never
 * offered: the sidecar's subjects name its component, so they would annotate nothing there.
 *
 * @param {{ mathRef: string, componentName: string }|null} component - From readSidecarComponent.
 * @param {Array<string>} mathRefs - The library's maths.
 * @returns {{ mathRef: string|null, candidates: Array<string>, isExact: boolean }}
 */
export function matchSidecarToMath(component, mathRefs) {
  if (!component) return { mathRef: null, candidates: [...mathRefs], isExact: false }
  if (mathRefs.includes(component.mathRef)) {
    return { mathRef: component.mathRef, candidates: [component.mathRef], isExact: true }
  }
  const sameComponent = mathRefs.filter((mathRef) => componentOf(mathRef) === component.componentName)
  return { mathRef: sameComponent.length === 1 ? sameComponent[0] : null, candidates: sameComponent, isExact: false }
}

/**
 * The modules that sidecars attached to library maths describe, for planInstances.
 *
 * @param {Array<{ component: Object|null, sidecar: Object|null }>} sidecars - From readAnnotationFiles.
 * @param {Map<string, string|null>|Object<string, string|null>} targets - Target math by sidecar filename.
 * @returns {Array<{ mathRef: string, is: string[], sidecar: Object|null, filename: string }>}
 */
export function attachedModules(sidecars, targets) {
  const targetOf = (filename) => (targets instanceof Map ? targets.get(filename) : targets?.[filename])
  const byMath = new Map()
  for (const entry of sidecars) {
    const mathRef = targetOf(entry.filename)
    if (!mathRef || !entry.component) continue
    byMath.set(mathRef, { mathRef, is: entry.component.is, sidecar: entry.sidecar, filename: entry.filename })
  }
  return [...byMath.values()]
}

/**
 * Whether a module's component suits a coordinate: a deployment's api:protein is the component's uniprot term;
 * a layer, cell or lyph runs a physical compartment (SBO:0000290); a facet-layer a component that is its
 * api:material.
 *
 * @param {Object} coord - A normalised ApiCoord.
 * @param {string[]} is - The component's canonical bqbiol:is terms.
 * @returns {boolean}
 */
export function suitsCoord(coord, is) {
  switch (coord?.kind) {
    case 'deployment':
      return !!coord.protein && is.includes(coord.protein)
    case 'layer':
    case 'cell':
    case 'lyph':
      return is.includes(SBO.physicalCompartment)
    case 'facet-layer':
      return !!coord.material && is.includes(coord.material)
    default:
      return false
  }
}

/**
 * The modules a coordinate may run, from the sidecars attached to library maths.
 *
 * @param {Object} coord
 * @param {Array<{ mathRef: string, is: string[] }>} modules - One per attached sidecar.
 * @returns {Array<string>} mathRefs, sorted.
 */
export function moduleCandidates(coord, modules) {
  return [...new Set(modules.filter((module) => suitsCoord(coord, module.is)).map((module) => module.mathRef))].sort()
}

/**
 * The variables of a sidecar whose role is aggregator: the fluxes a reservoir holds at constant 0.
 *
 * @param {{ variables: Array<{ variable: string, property: string, location: string }> }|null} sidecar
 * @returns {Array<string>}
 */
export function aggregatorVariables(sidecar) {
  return (sidecar?.variables ?? [])
    .filter((entry) => entry.property && entry.location && roleOf(entry) === 'aggregator')
    .map((entry) => entry.variable)
}

/**
 * The variables of a sidecar that another instance supplies through a port: readers, and aggregators (Sums).
 *
 * @param {{ variables: Array<{ variable: string, property: string, location: string }> }|null} sidecar
 * @returns {Array<string>}
 */
export function suppliedVariables(sidecar) {
  return (sidecar?.variables ?? [])
    .filter((entry) => entry.property && entry.location && ['reader', 'aggregator'].includes(roleOf(entry)))
    .map((entry) => entry.variable)
}

/**
 * Makes the named constant rows boundary conditions, keeping their values as the fallback used when nothing is
 * connected. Rows the math computes, and globals, are kept as they are.
 *
 * @param {Array<Object>} rows
 * @param {Array<string>} names
 * @returns {Array<Object>} New rows.
 */
export function asBoundaryConditions(rows, names) {
  const supplied = new Set(names)
  return (rows ?? []).map((row) =>
    supplied.has(row.name) && row.type === 'constant' ? { ...row, type: 'boundary_condition' } : row
  )
}

const isZero = (value) => value !== null && value !== undefined && String(value).trim() !== '' && Number(value) === 0

/**
 * Whether every named variable row is a constant 0.
 *
 * @param {Array<{ name: string, type: string, value: * }>} rows - Node variable rows.
 * @param {Array<string>} names
 * @returns {boolean} False when there are no names, or a row is missing.
 */
export function isHeldAtZero(rows, names) {
  if (!names.length) return false
  return names.every((name) => {
    const row = rows?.find((candidate) => candidate.name === name)
    return !!row && row.type === 'constant' && isZero(row.value)
  })
}

/**
 * Makes the named variable rows constant 0; other rows are kept as they are.
 *
 * @param {Array<Object>} rows
 * @param {Array<string>} names
 * @returns {Array<Object>} New rows.
 */
export function holdAtZero(rows, names) {
  const held = new Set(names)
  return (rows ?? []).map((row) => (held.has(row.name) ? { ...row, type: 'constant', value: '0' } : row))
}

/**
 * Finds the node an instance binds to: the node bound to its subject, else an unbound node of its name.
 *
 * @param {{ name: string, subject: string }} instance
 * @param {Array<Object>} nodes
 * @param {Set<string>} taken - Node ids already bound by this import.
 * @returns {Object|null}
 */
export function findBindingNode(instance, nodes, taken = new Set()) {
  const free = nodes.filter((node) => !taken.has(node.id))
  return (
    free.find((node) => node.data?.apiCoord?.subject === instance.subject) ??
    free.find((node) => !node.data?.apiCoord?.subject && node.data?.name === instance.name) ??
    null
  )
}

/**
 * Plans each instance of an instance file: its kind and rank, its module (the existing node's, else the single
 * candidate, else none until the user picks), the node it binds to, and whether it is held constant (pre-ticked
 * only on an existing node whose aggregators are constant 0 already, or that is held already).
 *
 * @param {Object} options
 * @param {Array<{ name: string, subject: string, coordIri: string, coord: Object }>} options.instances - From
 *   parseApiCoords.
 * @param {Array<{ mathRef: string, is: string[], sidecar?: Object }>} options.modules - One per attached sidecar.
 * @param {Array<Object>} [options.nodes] - Workspace nodes.
 * @param {(mathRef: string) => Object|null} [options.sidecarFor] - Parsed sidecars, for an existing node's math.
 * @returns {Array<{ name: string, subject: string, coordIri: string, kind: string|null, rank: number,
 *   candidates: Array<string>, mathRef: string|null, nodeId: string|null, nodeName: string|null,
 *   heldConstant: boolean }>}
 */
export function planInstances({ instances, modules, nodes = [], sidecarFor = () => null }) {
  const taken = new Set()
  const sidecarOf = (mathRef) => modules.find((module) => module.mathRef === mathRef)?.sidecar ?? sidecarFor(mathRef)
  return instances.map((instance) => {
    const kind = instance.coord?.kind ?? null
    const node = findBindingNode(instance, nodes, taken)
    if (node) taken.add(node.id)
    const candidates = node ? [node.data.mathRef] : moduleCandidates(instance.coord, modules)
    const mathRef = candidates.length === 1 ? candidates[0] : null
    const heldConstant = node
      ? !!node.data.annotationOverlay?.heldConstant ||
        isHeldAtZero(node.data.variables, aggregatorVariables(sidecarOf(node.data.mathRef)))
      : false
    return {
      name: instance.name,
      subject: instance.subject,
      coordIri: instance.coordIri,
      kind,
      rank: rankOf(instance.coord),
      candidates,
      mathRef,
      nodeId: node?.id ?? null,
      nodeName: node?.data?.name ?? null,
      heldConstant,
    }
  })
}

/**
 * Positions for new instances, in one column per rank to the right of the existing nodes, which stay put.
 *
 * @param {Array<{ name: string, rank: number }>} rows - The instances to place, in file order.
 * @param {Array<{ position: { x: number, y: number }, dimensions?: { width: number, height: number } }>} nodes
 *   - Existing nodes.
 * @param {{ columnWidth?: number, rowHeight?: number, gap?: number }} [options]
 * @returns {Map<string, { x: number, y: number }>} By instance name.
 */
export function layoutByRank(rows, nodes = [], { columnWidth = 320, rowHeight = 180, gap = 160 } = {}) {
  let left = 0
  let top = 0
  if (nodes.length) {
    left = Math.max(...nodes.map((node) => node.position.x + (node.dimensions?.width ?? 200))) + gap
    top = Math.min(...nodes.map((node) => node.position.y))
  }
  const ranks = [...new Set(rows.map((row) => row.rank))].sort((a, b) => a - b)
  const counts = new Map()
  const positions = new Map()
  for (const row of rows) {
    const index = counts.get(row.rank) ?? 0
    counts.set(row.rank, index + 1)
    positions.set(row.name, { x: left + ranks.indexOf(row.rank) * columnWidth, y: top + index * rowHeight })
  }
  return positions
}
