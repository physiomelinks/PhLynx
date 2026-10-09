/**
 * Reads a protocol_info as experiments of sub-experiments, and the value each controlled parameter takes in each:
 * the view the run planner and the editor work from.
 */
import { PACING, RAMP, expandShape, findIntervals, isMapping, normaliseShape } from './protocolShapes.js'

/**
 * Reads what a single-event pacing shape or a ramp was written as, the way CUFLynx's editor offers them: a step runs
 * to the end of its sub-experiment, a pulse stops before it, and pacing repeats.
 *
 * @param {Object} shape - A normalised shape (see normaliseShape).
 * @param {number} duration - The sub-experiment's length.
 * @returns {Object|null} `{type, ...}`, or null for a shape of several events, which has no simpler form.
 */
export function readShapeForm(shape, duration) {
  if (shape.type === RAMP) return { type: 'ramp', from: shape.from, to: shape.to }
  if (shape.events.length !== 1) return null
  const [{ level, start, length, period, multiplier }] = shape.events
  const { baseline } = shape
  if (period > 0) return { type: 'pacing', baseline, level, start, length, period, multiplier }
  if (start + length >= duration) return { type: 'step', baseline, level, start }
  return { type: 'pulse', baseline, level, start, end: start + length }
}

/**
 * Names an experiment the file gives no label, by its place, as both PhLynx and CUFLynx show it.
 *
 * @param {number} index - From 0.
 * @returns {string}
 */
export const nameExperiment = (index) => `Experiment ${index + 1}`

/**
 * Writes a form as the protocol_shapes entry CA reads, the inverse of readShapeForm.
 *
 * @param {Object} form - `{type: 'step', baseline, level, start}`, `{type: 'pulse', baseline, level, start, end}`,
 *   `{type: 'pacing', baseline, level, start, length, period, multiplier}` or `{type: 'ramp', from, to}`.
 * @param {number} duration - The sub-experiment's length, which a step lasts to.
 * @returns {Object}
 */
export function buildShapeFromForm(form, duration) {
  if (form.type === 'ramp') return { type: 'ramp', from: form.from, to: form.to }
  const event = { level: form.level, start: form.start }
  if (form.type === 'step') return { baseline: form.baseline, events: [{ ...event, length: duration - form.start }] }
  if (form.type === 'pulse') return { baseline: form.baseline, events: [{ ...event, length: form.end - form.start }] }
  return { baseline: form.baseline, events: [{ ...event, length: form.length, period: form.period, multiplier: form.multiplier }] }
}

/**
 * Reads one params_to_change value.
 *
 * @param {*} leaf - A number, or the name of a trace or shape.
 * @param {number} duration - Its sub-experiment's length.
 * @param {Object} protocolInfo
 * @returns {Object} `{kind: 'constant', value}`, `{kind: 'shape', name, shape, form, trace, error?}` or `{kind: 'trace',
 *   name, trace}`, `trace` as CA expands it; a shape CA would refuse has a null shape and the reason as `error`.
 */
function readCell(leaf, duration, protocolInfo) {
  if (typeof leaf !== 'string') return { kind: 'constant', value: leaf }
  const ownValue = (mapping) => (isMapping(mapping) && Object.hasOwn(mapping, leaf) ? mapping[leaf] : undefined)
  // As CA reads it, a shape's trace is in protocol_traces too.
  const trace = ownValue(protocolInfo.protocol_traces) ?? null
  const rawShape = ownValue(protocolInfo.protocol_shapes)
  if (rawShape === undefined) return { kind: 'trace', name: leaf, trace }
  // A shape CA would refuse is kept to its own cell, with why, so the others read as they are.
  try {
    const shape = normaliseShape(rawShape, leaf)
    const expanded = trace ?? expandShape(shape, shape.duration ?? duration, leaf)
    return { kind: 'shape', name: leaf, shape, form: readShapeForm(shape, duration), trace: expanded }
  } catch (error) {
    return { kind: 'shape', name: leaf, shape: null, form: null, trace: null, error: error.message }
  }
}

/**
 * Reads a protocol_info that has passed validateProtocolInfo.
 *
 * @param {Object} protocolInfo - As validateProtocolInfo returns it.
 * @returns {{experiments: Array<{label: string|null, colour: string|null, id: *, preTime: number, duration: number,
 *   subs: Array<{start: number, duration: number}>}>, controls: Array<{parameter: string, cells: Object[][]}>}}
 *   Sub-experiment starts are from the end of the warm-up; `label` and `colour` are null where the file gives none.
 */
export function readProtocolInfo(protocolInfo) {
  const experiments = protocolInfo.sim_times.map((durations, experiment) => {
    let start = 0
    const subs = durations.map((duration) => {
      const sub = { start, duration }
      start += duration
      return sub
    })
    return {
      label: protocolInfo.experiment_labels?.[experiment] ?? null,
      colour: protocolInfo.experiment_colors?.[experiment] ?? null,
      id: protocolInfo.experiment_ids?.[experiment] ?? null,
      preTime: protocolInfo.pre_times[experiment],
      duration: start,
      subs,
    }
  })
  const controls = Object.entries(isMapping(protocolInfo.params_to_change) ? protocolInfo.params_to_change : {}).map(([parameter, rows]) => ({
    parameter,
    cells: experiments.map((experiment, e) => experiment.subs.map((sub, s) => readCell(rows[e][s], sub.duration, protocolInfo))),
  }))
  return { experiments, controls }
}

/**
 * Whether an input changes during a warm-up, so that CA, starting it with the warm-up, runs it earlier than written.
 *
 * @param {Object} cell - From readProtocolInfo.
 * @param {number} preTime
 * @param {number} duration - The sub-experiment's length, which a shape lasts unless it says otherwise.
 * @returns {boolean}
 */
export function changesDuringWarmUp(cell, preTime, duration) {
  if (cell.kind === 'constant') return false
  if (cell.kind === 'shape' && cell.shape.type === PACING) {
    return findIntervals(cell.shape.events, cell.shape.duration ?? duration, cell.name).some(([from]) => from < preTime)
  }
  const { t, values } = cell.trace ?? { t: [], values: [] }
  const early = values.filter((_, i) => t[i] <= preTime)
  const next = t.findIndex((time) => time > preTime)
  return early.some((value) => value !== early[0]) || (early.length > 0 && next >= 0 && next === early.length && t[next - 1] < preTime && values[next] !== early[0])
}
