/**
 * The features of a protocol run, as circulatory_autogen computes them (see protocol-kit's computeFeatures): each
 * prediction item with an operation, reduced over its sub-experiment's own series, which the runner keeps for the
 * variables they need (see protocolRunner.js).
 */
import { computeFeatures, readObsDataParts, readOperation, readPredictionItem } from '@physiomelinks/protocol-kit'

import { findProtocolTarget } from './protocolTargets'
import { buildLinearSpace } from '../protocol/libopencorEngine/protocolPlan'

// CA's name for the time (see buildOperandTime).
export const TIME_OPERAND = 'time'
// The kinds libOpenCOR reports of a variable that doesn't change in a run; Myokit can't log one, so CA records it once.
const CONSTANT_KINDS = new Set(['constant', 'computedConstant'])

/**
 * Lists the operands of an obs_data's features: its prediction items with an operation, other than a series, then its
 * constant data items with one (see computeDataItemFeatures).
 *
 * @param {Object|Array|undefined} document - The obs_data, as parsed.
 * @returns {string[]} Each once, in order.
 */
export function listFeatureOperands(document) {
  if (document === undefined || document === null) return []
  const { dataItems, predictionItems, protocolInfo } = readObsDataParts(document)
  const isFeature = (item) => !!item && typeof item === 'object' && readOperation(item.operation) != null
  const predicted = predictionItems.flatMap((item, index) => {
    if (!isFeature(item) || item.data_type === 'series') return []
    return readPredictionItem(item, index, protocolInfo?.sim_times).entry?.operands ?? []
  })
  const measured = dataItems.flatMap((item) => (isFeature(item) && (item.data_type ?? 'constant') === 'constant' && Array.isArray(item.operands) ? item.operands : []))
  return [...new Set([...predicted, ...measured].filter((operand) => typeof operand === 'string'))]
}

/**
 * Finds the variable each feature operand names, as a protocol's parameters are found (see findProtocolTarget).
 *
 * @param {Object} options
 * @param {string[]} options.operands - From listFeatureOperands.
 * @param {Array<Object>} options.nodes - The scope's nodes.
 * @param {Map<string, string>} options.mapping - `nodeId::name` to the name libOpenCOR reports.
 * @param {Map<string, Object>} options.variables - The model's variables, by reported name.
 * @returns {Map<string, string>} Operand to reported name; one the model lacks, and the time, are left out.
 */
export function resolveFeatureOperands({ operands, nodes, mapping, variables }) {
  return new Map(
    operands.flatMap((operand) => {
      const reported = operand === TIME_OPERAND ? null : findProtocolTarget(operand, { nodes, mapping, variables })
      return reported ? [[operand, reported]] : []
    })
  )
}

/**
 * Gives a sub-experiment's time as CA records it for an operand (its Myokit helper's tSim less its pre_time): the
 * first's from the end of the warm-up, as the joined time is, but each later one's from the start of the warm-up, its
 * pre_time being 0.
 *
 * @param {number} preTime
 * @param {Array<{duration: number, numberOfSteps: number}>} subs - The experiment's, from its plan.
 * @param {number} s
 * @returns {Float64Array}
 */
export function buildOperandTime(preTime, subs, s) {
  // CA's current_time, summed as it sums it.
  let start = 0 + preTime
  for (let i = 0; i < s; i++) start += subs[i].duration
  const times = buildLinearSpace(start, start + subs[s].duration, subs[s].numberOfSteps)
  return s === 0 ? times.map((time) => time - preTime) : times
}

/**
 * Gives each sub-experiment's samples of the feature operands, as computeFeatures takes them: a variable's own series,
 * a constant's one value, as CA's Myokit helper records it, and the time.
 *
 * @param {{experiments: Array<{variables: Map<string, Object>, preTime: number, subs: Array, subSeries?: Array}>}} protocolResults
 * @param {Map<string, string>} operands - From resolveFeatureOperands.
 * @returns {Array<Array<{values: Object<string, ArrayLike<number>|number>}|null>>} `[experiment][sub]`, null for one
 *   not run to its end.
 */
export function buildFeatureSegments(protocolResults, operands) {
  return (protocolResults?.experiments ?? []).map(({ variables, preTime, subs, subSeries }) =>
    (subSeries ?? []).map((own, s) => {
      if (!own) return null
      const values = { [TIME_OPERAND]: buildOperandTime(preTime, subs, s) }
      for (const [operand, name] of operands) {
        if (!own[name]) continue
        values[operand] = CONSTANT_KINDS.has(variables.get(name)?.kind) ? own[name][0] : own[name]
      }
      return { values }
    })
  )
}

/**
 * Computes a protocol run's features.
 *
 * @param {Object|Array|undefined} document - The obs_data, as parsed.
 * @param {Object} protocolResults - The run's.
 * @param {Map<string, string>} operands - From resolveFeatureOperands.
 * @returns {Array<Object>} As computeFeatures gives them.
 */
export function computeRunFeatures(document, protocolResults, operands) {
  return protocolResults ? computeFeatures(document, buildFeatureSegments(protocolResults, operands)) : []
}
