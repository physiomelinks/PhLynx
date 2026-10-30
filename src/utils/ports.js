import { TARGET_COMPATIBLE } from './constants'
import { annotatedCompatible, annotationsAgree, coordOf } from '../services/annotations/couple'
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

/**
 * Whether a coupling an edge already holds still couples once its ports' annotations change: canCouple where both
 * nodes are located, else the same property and species in complementary roles, since their places can't be told.
 *
 * @param {Object} sourcePort
 * @param {Object} sourceNode
 * @param {Object} targetPort
 * @param {Object} targetNode
 * @param {Object} context - From buildCouplingContext.
 * @returns {boolean}
 */
export function canKeepCoupling(sourcePort, sourceNode, targetPort, targetNode, context) {
  if (canCouple(sourcePort, sourceNode, targetPort, targetNode, context)) return true
  if (!sourcePort || !targetPort || !isCompatible(sourcePort.portType, targetPort.portType)) return false
  if (!isAnnotatedPort(sourcePort) || !isAnnotatedPort(targetPort)) return false
  const isLocated = !!coordOf(sourceNode, context) && !!coordOf(targetNode, context)
  return !isLocated && annotationsAgree(sourcePort, sourceNode, targetPort, targetNode, context)
}
