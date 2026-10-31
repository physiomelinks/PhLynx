/**
 * ApiCoord instance files (ApiCoord v0.2): which model component sits where. Coordinates are normalised per
 * kind; problems become warnings, never exceptions.
 */

import { parseRdf } from './rdf.js'
import { createGraph } from './graph.js'
import { BQBIOL, NS, RDF_TYPE, canonicalCurie, splitSubject } from './iris.js'

export const APICOORD_BASE_IRI = 'https://phlynx.invalid/apicoords/'

const API = (name) => `${NS.api}${name}`
const API_COORD = API('ApiCoord')
const API_SCOPE = API('Scope')

export const FACETS = ['apical', 'lateral', 'basolateral']
export const KINDS = ['material', 'layer', 'lyph', 'chain', 'coalescence', 'cell', 'facet-layer', 'deployment']

/**
 * Parses an ApiCoord instance file.
 *
 * @param {string} text - The RDF.
 * @param {{ format?: string, baseIri?: string }} [options]
 * @returns {Promise<object>} See readApiCoords.
 */
export async function parseApiCoords(text, { format = 'turtle', baseIri = APICOORD_BASE_IRI } = {}) {
  let triples
  try {
    triples = await parseRdf(text, { format, baseIri })
  } catch (error) {
    return {
      instances: [],
      coords: new Map(),
      scopes: new Map(),
      warnings: [{ message: `Could not parse: ${error.message}` }],
    }
  }
  return readApiCoords(createGraph(triples))
}

/**
 * Reads the instances and their coordinates from an indexed graph.
 *
 * @param {object} graph - From createGraph.
 * @returns {{ instances: Array<{ name: string, subject: string, coordIri: string, coord: object }>,
 *   coords: Map<string, object>, scopes: Map<string, object>, warnings: Array<{ subject?: string, message: string }> }}
 */
export function readApiCoords(graph) {
  const warnings = []
  const warn = (subject, message) => warnings.push({ subject, message })
  const iris = (subject, name) => graph.objects(subject, API(name)).map((term) => term.value)
  const curies = (subject, name) => iris(subject, name).map(canonicalCurie)
  const literal = (subject, name) => graph.first(subject, API(name))?.value
  const literals = (subject, name) => graph.objects(subject, API(name)).map((term) => term.value)

  const scopes = new Map()
  for (const term of graph.subjects(RDF_TYPE, API_SCOPE)) {
    scopes.set(term.value, {
      iri: term.value,
      anatomy: [...new Set(curies(term, 'anatomy'))].sort(),
      closure: literal(term, 'closure') ?? null,
      note: literal(term, 'note') ?? null,
    })
    if (!scopes.get(term.value).anatomy.length) warn(term.value, 'The scope has no api:anatomy.')
  }

  const coordTerms = graph.subjects(RDF_TYPE, API_COORD)
  const coordIris = new Set(coordTerms.map((term) => term.value))
  const coords = new Map()
  for (const term of coordTerms) {
    const subject = term.value
    const kind = literal(term, 'kind') ?? null
    if (!kind) warn(subject, 'The coordinate has no api:kind.')
    else if (!KINDS.includes(kind)) warn(subject, `Unknown api:kind '${kind}'.`)

    const coord = {
      iri: subject,
      kind,
      origin: iris(term, 'origin'),
      note: literals(term, 'note'),
    }

    const facets = literals(term, 'facet')
    const badFacets = facets.filter((facet) => !FACETS.includes(facet))
    if (badFacets.length) warn(subject, `Unknown api:facet ${badFacets.join(', ')}.`)
    const layerIndex = literal(term, 'layerIndex')
    const index = layerIndex === undefined ? undefined : Number(layerIndex)
    if (layerIndex !== undefined && !Number.isInteger(index))
      warn(subject, `api:layerIndex '${layerIndex}' is not an integer.`)
    const material = iris(term, 'material')[0]

    const within = iris(term, 'within')
    const scope = iris(term, 'scope')
    const requireOne = (values, name) => {
      if (values.length > 1) warn(subject, `Several api:${name}.`)
      return values[0]
    }

    switch (kind) {
      case 'layer': {
        // Layers may name their scope with api:scope or api:within.
        const scopeIris = [...new Set([...scope, ...within])]
        if (scopeIris.length !== 1)
          warn(subject, `A layer needs one api:scope or api:within, found ${scopeIris.length}.`)
        coord.scope = scopeIris[0] ?? null
        if (coord.scope && !scopes.has(coord.scope)) warn(subject, `The scope ${coord.scope} is not an api:Scope.`)
        coord.layerIndex = index ?? null
        if (index === undefined) warn(subject, 'A layer needs api:layerIndex.')
        coord.material = material ? canonicalCurie(material) : null
        break
      }
      case 'cell': {
        coord.scope = requireOne(within.length ? within : scope, 'within') ?? null
        if (!coord.scope || !scopes.has(coord.scope)) warn(subject, 'A cell needs api:within an api:Scope.')
        coord.cell = curies(term, 'cell')[0] ?? null
        if (!coord.cell) warn(subject, 'A cell needs api:cell.')
        coord.chainShape = literal(term, 'chainShape') ?? null
        break
      }
      case 'facet-layer':
      case 'deployment': {
        coord.within = requireOne(within, 'within') ?? null
        if (!coord.within || !coordIris.has(coord.within))
          warn(subject, `A ${kind} needs api:within a cell coordinate.`)
        coord.facets = FACETS.filter((facet) => facets.includes(facet))
        if (!coord.facets.length) warn(subject, `A ${kind} needs api:facet.`)
        if (kind === 'facet-layer') {
          coord.layerIndex = index ?? null
          coord.material = material ? canonicalCurie(material) : null
        } else {
          coord.protein = curies(term, 'protein')[0] ?? null
          if (!coord.protein) warn(subject, 'A deployment needs api:protein.')
          coord.label = literal(term, 'label') ?? null
          coord.regions = (literal(term, 'regions') ?? '')
            .split(',')
            .map((region) => region.trim())
            .filter(Boolean)
        }
        break
      }
      case 'lyph': {
        coord.template = iris(term, 'template')[0] ?? null
        coord.anatomy = [...new Set(curies(term, 'anatomy'))].sort()
        coord.conveys = curies(term, 'conveys')[0] ?? null
        coord.coalescedWith = iris(term, 'coalescedWith')
        if (!coord.origin.length && !coord.template && !coord.anatomy.length) {
          warn(subject, 'A lyph needs api:origin, api:template or api:anatomy.')
        }
        break
      }
      default:
        coord.material = material ? canonicalCurie(material) : null
    }
    coords.set(subject, coord)
  }

  // A cell's deployments and facet-layers must be within a cell.
  for (const coord of coords.values()) {
    if (coord.within && coords.has(coord.within) && coords.get(coord.within).kind !== 'cell') {
      warn(coord.iri, `api:within ${coord.within} is not a cell coordinate.`)
    }
  }

  const instances = []
  const names = new Set()
  for (const triple of graph.triples) {
    if (triple.predicate.value !== BQBIOL.is || !coordIris.has(triple.object.value)) continue
    const subject = triple.subject.value
    const name = triple.subject.termType === 'NamedNode' ? splitSubject(subject)?.fragment : null
    if (!name) {
      warn(subject, 'The instance subject has no #fragment to name it.')
      continue
    }
    if (names.has(name)) warn(subject, `The instance '${name}' is placed twice.`)
    names.add(name)
    instances.push({ name, subject, coordIri: triple.object.value, coord: coords.get(triple.object.value) })
  }
  if (!instances.length) warn(undefined, 'No instance is bqbiol:is an api:ApiCoord.')

  return { instances, coords, scopes, warnings }
}
