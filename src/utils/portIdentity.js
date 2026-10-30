/**
 * What makes a port the same port. An annotated port is identified by its annotation's subject (and contribution
 * index), whatever its label, which stays empty; any other port by its label.
 *
 * Imports nothing, so multiport.js, edges.js and the exports can all use it.
 */

/**
 * Whether a port carries an RDF annotation.
 *
 * @param {Object} port
 * @returns {boolean}
 */
export const isAnnotatedPort = (port) => typeof port?.annotation?.subject === 'string' && !!port.annotation.subject

/**
 * Whether an annotated port carries a copy mirrored from a partner, whose variable the user picks, rather than a
 * sidecar's annotation of one of its own variables.
 *
 * @param {Object} port
 * @returns {boolean}
 */
export const isMirroredPort = (port) => isAnnotatedPort(port) && port.annotation.source?.kind === 'copied'

/**
 * A port's identity: 'rdf:<subject>' (with '#<n>' for a contribution index above 0) when annotated, else
 * 'label:<label>'.
 *
 * @param {Object} port
 * @returns {string|null} Null without a port.
 */
export function portIdentity(port) {
  if (!port) return null
  if (!isAnnotatedPort(port)) return `label:${port.label ?? ''}`
  const { subject, contribution } = port.annotation
  return Number.isInteger(contribution) && contribution > 0 ? `rdf:${subject}#${contribution}` : `rdf:${subject}`
}

const sameVariables = (a, b) => JSON.stringify(a.variables ?? []) === JSON.stringify(b.variables ?? [])

/**
 * Whether two ports are the same port: same type and identity, and for an unannotated port the same variables.
 * An annotated port keeps its identity while its variables are chosen or changed.
 *
 * @param {Object} a
 * @param {Object} b
 * @returns {boolean}
 */
export function samePort(a, b) {
  if (!a || !b || a.portType !== b.portType || portIdentity(a) !== portIdentity(b)) return false
  return isAnnotatedPort(a) || sameVariables(a, b)
}

/**
 * Finds the port in a list that is the same port.
 *
 * @param {Array<Object>} ports
 * @param {Object} port
 * @returns {Object|null}
 */
export function findPort(ports, port) {
  if (!port) return null
  return (ports ?? []).find((candidate) => samePort(candidate, port)) ?? null
}

/**
 * A port as edge couplings store it: a copy without editor fields, its annotation included.
 *
 * @param {Object} port
 * @returns {Object}
 */
export function portRef(port) {
  return {
    portType: port.portType,
    label: port.label,
    variables: port.variables,
    multiportType: port.multiportType,
    multiplyFactor: port.multiplyFactor,
    ...(port.annotation ? { annotation: JSON.parse(JSON.stringify(port.annotation)) } : {}),
  }
}

/**
 * A port's name for messages: its variables when annotated, else its label. Never stored as a label.
 *
 * @param {Object} port
 * @returns {string}
 */
export function portDisplayName(port) {
  if (!isAnnotatedPort(port)) return port?.label ?? ''
  const variables = (port.variables ?? []).filter(Boolean)
  if (variables.length) return variables.join(', ')
  return port.annotation.variable || port.annotation.subject
}

/**
 * Whether a port is named: annotated, or with a non-blank label. Editors keep only named ports.
 *
 * @param {Object} port
 * @returns {boolean}
 */
export const isNamedPort = (port) => isAnnotatedPort(port) || !!port?.label?.trim()
