/**
 * What annotation chips and their detail show: chip texts from the label provider, never stored as a port label.
 */

import { canonicalCurie, expandCurie } from './iris.js'
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
 * @param {string} [selfName] - What the module is, e.g. 'this compartment'; without it, 'self'.
 * @returns {string}
 */
export function locationText(location, selfName) {
  if (!location) return 'unlocated'
  if (location === 'self') return selfName ?? 'self'
  if (location.startsWith('self+')) {
    const label = displayLabel(location.slice(5))
    return selfName ? `${label} of ${selfName}` : `${label} (self)`
  }
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
 * @param {{ property?: string, species?: string[], location?: string|null }} annotation
 * @param {Object} [options]
 * @param {string} [options.selfName] - What the module is, for its own place (see locationText).
 * @returns {Array<{ kind: 'species'|'property'|'location', text: string, curie?: string }>}
 */
export function annotationChips(annotation, { selfName } = {}) {
  if (!annotation) return []
  const species = (annotation.species ?? []).map((term) => ({
    kind: 'species',
    text: displayLabel(term),
    curie: canonicalCurie(term),
  }))
  const property = annotation.property
    ? [{ kind: 'property', text: displayLabel(annotation.property), curie: canonicalCurie(annotation.property) }]
    : []
  const location = { kind: 'location', text: locationText(annotation.location, selfName) }
  if (annotation.location && !annotation.location.startsWith('self')) location.curie = annotation.location
  return [...species, ...property, location]
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
