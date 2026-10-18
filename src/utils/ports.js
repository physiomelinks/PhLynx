/**
 * The port roles of a coupling, as circulatory_autogen (CA) pairs them: a source couples through its exit and general
 * ports, a target through its entrance and general ports, each list in the order CA merges a label's ports into one
 * group (exit, or entrance, before general).
 */
export const SOURCE_PORT_TYPES = Object.freeze(['exit_ports', 'general_ports'])
export const TARGET_PORT_TYPES = Object.freeze(['entrance_ports', 'general_ports'])

/** The label CA pairs one slot to one slot on a connection; every other label pairs each free source slot. */
export const VESSEL_PORT = 'vessel_port'

/**
 * Whether a source port type may couple to a target port type: exit or general to entrance or general.
 *
 * @param {string} srcType
 * @param {string} tgtType
 * @returns {boolean}
 */
export function isCompatible(srcType, tgtType) {
  return SOURCE_PORT_TYPES.includes(srcType) && TARGET_PORT_TYPES.includes(tgtType)
}

/**
 * Gets a port's number of variables, the count CA indexes a pair by.
 *
 * @param {Object} port
 * @returns {number}
 */
export const variableCount = (port) => port?.variables?.length ?? 0

export function findPort(ports, port) {
  if (!port) return null
  // A super instance's port is the exposed port it names: two may share a label and variables.
  if (port.exposedPortId != null) return ports.find((p) => p.exposedPortId === port.exposedPortId) ?? null
  return ports.find((p) =>
    p.label === port.label &&
    p.portType === port.portType &&
    JSON.stringify(p.variables) === JSON.stringify(port.variables)
  ) ?? null
}
