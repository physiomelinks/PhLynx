import { TARGET_COMPATIBLE } from './constants'
import { annotatedCompatible } from '../services/annotations/couple'
import { isAnnotatedPort } from './portIdentity'

export {
  findPort,
  isAnnotatedPort,
  isMirroredPort,
  isNamedPort,
  portDisplayName,
  portIdentity,
  portRef,
  samePort,
} from './portIdentity'

export function isCompatible(srcType, tgtType) {
  return TARGET_COMPATIBLE[srcType]?.has(tgtType) ?? false
}

/**
 * Whether a source port may couple to a target port. Unannotated ports couple by equal, non-empty label;
 * annotated ports by their annotations, located on their nodes (see services/annotations/couple.js); an annotated
 * port never couples to an unannotated one.
 *
 * @param {Object} sourcePort
 * @param {Object} sourceNode
 * @param {Object} targetPort
 * @param {Object} targetNode
 * @param {Object} [context] - From buildCouplingContext; without it annotated ports never couple.
 * @returns {boolean}
 */
export function canCouple(sourcePort, sourceNode, targetPort, targetNode, context) {
  if (!sourcePort || !targetPort || !isCompatible(sourcePort.portType, targetPort.portType)) return false
  const annotated = [isAnnotatedPort(sourcePort), isAnnotatedPort(targetPort)]
  if (annotated[0] !== annotated[1]) return false
  if (annotated[0]) return !!context && annotatedCompatible(sourcePort, sourceNode, targetPort, targetNode, context)
  return !!sourcePort.label?.trim() && sourcePort.label === targetPort.label
}
