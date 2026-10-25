/**
 * What annotation chips and their detail show: chip texts from the label provider (never stored as a port
 * label), and readable places for located quantities.
 */

import { GO, canonicalCurie, expandCurie } from './iris.js'
import { displayLabel } from './labels.js'
import { SIDECAR_BASE_IRI } from './sidecar.js'

export const ROLE_DESCRIPTIONS = {
  owner: 'Owner: defines this quantity for its place',
  reader: 'Reader: uses the quantity its place defines',
  aggregator: 'Aggregator: sums the flows into its place',
  contributor: 'Contributor: a flow into its place, summed there',
}

const MULTIPORT_TEXT = { True: 'multiport', Sum: 'multiport, summed', None: 'basicport' }

/**
 * The title of a port control an annotation sets, e.g. 'From annotation: reader, basicport'.
 *
 * @param {{ multiportType?: string, annotation?: { role?: string } }} port
 * @returns {string}
 */
export function fromAnnotationTitle(port) {
  const parts = [port?.annotation?.role, MULTIPORT_TEXT[port?.multiportType]].filter(Boolean)
  return parts.length ? `From annotation: ${parts.join(', ')}` : 'From annotation'
}

/**
 * A sidecar location as text: a GO term's label, or the instance's own place.
 *
 * @param {string|null} location - 'self', 'self+GO:…' or a GO term.
 * @returns {string}
 */
export function locationText(location) {
  if (!location) return 'unlocated'
  if (location === 'self') return 'self'
  if (location.startsWith('self+')) return `${displayLabel(location.slice(5))} (self)`
  return displayLabel(location)
}

/**
 * A term as the detail lists it: its label, CURIE and IRI.
 *
 * @param {string} iriOrCurie
 * @returns {{ curie: string, label: string, iri: string }}
 */
export function termDetail(iriOrCurie) {
  const curie = canonicalCurie(iriOrCurie)
  return { curie, label: displayLabel(curie), iri: expandCurie(curie) }
}

/**
 * The chips of an annotation, in order: its species, its property, then its location.
 *
 * @param {{ property?: string, species?: string[], location?: string|null, absoluteLocation?: Object }} annotation
 * @returns {Array<{ kind: 'species'|'property'|'location', text: string, curie?: string }>}
 */
export function annotationChips(annotation) {
  if (!annotation) return []
  const species = (annotation.species ?? []).map((term) => ({
    kind: 'species',
    text: displayLabel(term),
    curie: canonicalCurie(term),
  }))
  const property = annotation.property
    ? [{ kind: 'property', text: displayLabel(annotation.property), curie: canonicalCurie(annotation.property) }]
    : []
  const location =
    annotation.location || !annotation.absoluteLocation
      ? { kind: 'location', text: locationText(annotation.location) }
      : { kind: 'location', text: placeText(annotation.absoluteLocation) }
  if (annotation.location && !annotation.location.startsWith('self')) location.curie = annotation.location
  return [...species, ...property, location]
}

const PLACE_KINDS = {
  layer: (rest) => `layer ${rest.slice(rest.lastIndexOf(':') + 1)}`,
  cyto: () => displayLabel(GO.cytoplasm),
  pm: () => displayLabel(GO.plasmaMembrane),
  lyph: () => 'lyph',
  'extra-basolateral': () => 'outside the basolateral facet',
}

/**
 * A resolved place as text, e.g. 'cytoplasm' or 'plasma membrane (apical)'.
 *
 * @param {{ key: string, facets?: string[] }} place - From locate.
 * @returns {string}
 */
export function placeText(place) {
  if (!place?.key) return 'unresolved'
  const colon = place.key.indexOf(':')
  const kind = colon > 0 ? place.key.slice(0, colon) : place.key
  const text = PLACE_KINDS[kind]?.(place.key.slice(colon + 1)) ?? place.key
  return place.facets?.length ? `${text} (${place.facets.join(', ')})` : text
}

/**
 * The places a located quantity resolved to, for its detail.
 *
 * @param {{ locations?: Array<{ key: string, facets?: string[], confidence: string, path?: string[],
 *   why?: string, unresolved?: boolean }> }|null} quantity - From quantityOfPort.
 * @returns {Array<{ text: string, path: string, confidence: string, why?: string, unresolved: boolean }>}
 */
export function resolvedPlaces(quantity) {
  return (quantity?.locations ?? []).map((place) => ({
    text: placeText(place),
    path: (place.path ?? []).join(' → '),
    confidence: place.confidence ?? 'high',
    ...(place.why ? { why: place.why } : {}),
    unresolved: !!place.unresolved,
  }))
}

/**
 * A sidecar subject as its sidecar writes it, relative to the module file, e.g. './file.cellml#comp.v'.
 *
 * @param {string} subject
 * @returns {string}
 */
export function subjectText(subject) {
  return typeof subject === 'string' && subject.startsWith(SIDECAR_BASE_IRI)
    ? `./${subject.slice(SIDECAR_BASE_IRI.length)}`
    : (subject ?? '')
}
