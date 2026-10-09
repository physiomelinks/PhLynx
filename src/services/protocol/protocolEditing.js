/**
 * Edits an obs_data document's protocol. Each edit gives a new document, keeping everything it doesn't touch, and
 * renumbers the observations that refer to experiments and sub-experiments by their place, so none points at the
 * wrong one after a change.
 */
import { buildShapeFromForm, nameExperiment, readShapeForm } from './protocolModel.js'
import { interpolateTrace } from './protocolPreview.js'
import { PACING, expandShape, isMapping, normaliseShape } from './protocolShapes.js'

// The lists in protocol_info with one entry per experiment.
const PER_EXPERIMENT = ['pre_times', 'sim_times', 'experiment_labels', 'experiment_colors', 'experiment_ids']
// Matplotlib's colours, as CA's experiment_colors name them, for experiments added after them.
const COLOURS = ['r', 'b', 'g', 'm', 'c', 'y', 'k']

/**
 * Copies a document as JSON, so edits never reach the one given.
 *
 * @param {*} document
 * @returns {*}
 */
const copy = (document) => JSON.parse(JSON.stringify(document))

/**
 * Gives a document with a protocol to edit: an empty one of a single experiment when it has none. A bare list of
 * data items becomes the document's data_items.
 *
 * @param {Object|Array|null} document
 * @returns {Object}
 */
export function ensureProtocol(document) {
  const edited = Array.isArray(document) ? { data_items: copy(document) } : copy(document ?? {})
  if (!isMapping(edited.protocol_info)) edited.protocol_info = { pre_times: [0], sim_times: [[1]], params_to_change: {} }
  if (!isMapping(edited.protocol_info.params_to_change)) edited.protocol_info.params_to_change = {}
  return edited
}

/**
 * Applies an edit to a copy of a document's protocol, then drops the shapes nothing uses any more, which CA refuses
 * unless they say how long they last.
 *
 * @param {Object} document
 * @param {Function} edit - Called with the copy, to change in place.
 * @returns {Object}
 */
function editDocument(document, edit) {
  const edited = ensureProtocol(document)
  edit(edited)
  const info = edited.protocol_info
  if (isMapping(info.protocol_shapes)) {
    const used = new Set(Object.values(info.params_to_change).flatMap((rows) => rows.flat().filter((leaf) => typeof leaf === 'string')))
    for (const [name, shape] of Object.entries(info.protocol_shapes)) {
      if (!used.has(name) && !(isMapping(shape) && 'duration' in shape)) delete info.protocol_shapes[name]
    }
  }
  return edited
}

/**
 * Renumbers the observations after an experiment's place changes, dropping those of a removed one. An observation
 * without an index is in experiment 0, as CA reads it.
 *
 * @param {Object} document
 * @param {Function} renumber - Gives an experiment's new index, or null when it is gone.
 */
function renumberExperiments(document, renumber) {
  for (const key of ['data_items', 'prediction_items']) {
    if (!Array.isArray(document[key])) continue
    document[key] = document[key].flatMap((item) => {
      const next = renumber(item.experiment_idx ?? 0)
      if (next == null) return []
      return next === (item.experiment_idx ?? 0) ? [item] : [{ ...item, experiment_idx: next }]
    })
  }
}

/**
 * Lists the observations that refer to an experiment, or to one of its sub-experiments.
 *
 * @param {Object|Array} document
 * @param {number} experiment
 * @param {number} [sub] - Leave out for the whole experiment. Prediction items refer to no sub-experiment.
 * @returns {string[]} Their names.
 */
export function findObservationsAt(document, experiment, sub = null) {
  const items = Array.isArray(document) ? document.map((item) => ['data_items', item]) : ['data_items', 'prediction_items'].flatMap((key) => (document?.[key] ?? []).map((item) => [key, item]))
  return items
    .filter(([key, item]) => (item.experiment_idx ?? 0) === experiment && (sub == null || (key === 'data_items' && (item.subexperiment_idx ?? 0) === sub)))
    .map(([, item]) => item.data_item_name ?? '(unnamed)')
}

/**
 * Adds an experiment after the others, a copy of one of them.
 *
 * @param {Object} document
 * @param {number} from - The experiment to copy.
 * @returns {Object}
 */
export function addExperiment(document, from) {
  return editDocument(document, ({ protocol_info: info }) => {
    const count = info.sim_times.length
    for (const key of PER_EXPERIMENT) {
      if (!Array.isArray(info[key])) continue
      if (key === 'experiment_labels') info[key].push(`${info[key][from] ?? nameExperiment(from)} (copy)`)
      else if (key === 'experiment_colors') info[key].push(COLOURS[count % COLOURS.length])
      else if (key === 'experiment_ids') info[key].push(null)
      else info[key].push(copy(info[key][from]))
    }
    for (const [parameter, rows] of Object.entries(info.params_to_change)) {
      // The copy's shapes and traces are its own, so editing one experiment never changes the other.
      rows.push(rows[from].map((leaf, sub) => (typeof leaf === 'string' ? copyInput(info, leaf, nameCellInput(parameter, count, sub)) : leaf)))
    }
  })
}

/**
 * Adds an experiment after the others, afresh: no warm-up, and one sub-experiment in which each parameter holds a
 * value of its own.
 *
 * @param {Object} document
 * @param {Object} [options]
 * @param {number} [options.duration] - The sub-experiment's length.
 * @param {Map<string, number>} [options.values] - Each parameter's value, as the model has it; 0 where it has none.
 * @returns {Object}
 */
export function addEmptyExperiment(document, { duration = 1, values = new Map() } = {}) {
  return editDocument(document, ({ protocol_info: info }) => {
    const count = info.sim_times.length
    info.pre_times.push(0)
    info.sim_times.push([duration])
    if (Array.isArray(info.experiment_labels)) info.experiment_labels.push(nameExperiment(count))
    if (Array.isArray(info.experiment_colors)) info.experiment_colors.push(COLOURS[count % COLOURS.length])
    if (Array.isArray(info.experiment_ids)) info.experiment_ids.push(null)
    for (const [parameter, rows] of Object.entries(info.params_to_change)) rows.push([values.get(parameter) ?? 0])
  })
}

/**
 * Lists the shape and trace names that sub-experiments use, but for one.
 *
 * @param {Object} info - The protocol_info.
 * @param {{parameter: string, experiment: number, sub: number}} [except]
 * @returns {Set<string>}
 */
function findUsedNames(info, except = null) {
  const used = new Set()
  for (const [parameter, rows] of Object.entries(info.params_to_change)) {
    rows.forEach((row, experiment) =>
      row.forEach((leaf, sub) => {
        const isExcepted = except && except.parameter === parameter && except.experiment === experiment && except.sub === sub
        if (typeof leaf === 'string' && !isExcepted) used.add(leaf)
      })
    )
  }
  return used
}

/**
 * Finds a name for an input no sub-experiment but the one given uses, nor any shape or trace already has.
 *
 * @param {Object} info - The protocol_info.
 * @param {string} base - The name wanted.
 * @param {{parameter: string, experiment: number, sub: number}} [owner] - The sub-experiment the name is for.
 * @returns {string} `base`, or `base_2`, `base_3`… when it is taken.
 */
function findFreeName(info, base, owner = null) {
  const used = findUsedNames(info, owner)
  const isOwnersOnly = (name) => !used.has(name)
  const exists = (name) => Object.hasOwn(info.protocol_shapes ?? {}, name) || Object.hasOwn(info.protocol_traces ?? {}, name)
  // The owner may take over a name only it uses; any other name must be new.
  if (isOwnersOnly(base) && (owner || !exists(base))) return base
  for (let index = 2; ; index++) {
    const name = `${base}_${index}`
    if (isOwnersOnly(name) && !exists(name)) return name
  }
}

/**
 * Copies a shape or trace under a name of its own.
 *
 * @param {Object} info - The protocol_info, changed in place.
 * @param {string} leaf - The input's name.
 * @param {string} base - The name wanted for the copy.
 * @returns {string} The copy's name, or the name given when it names nothing to copy.
 */
function copyInput(info, leaf, base) {
  const key = ['protocol_shapes', 'protocol_traces'].find((candidate) => isMapping(info[candidate]) && Object.hasOwn(info[candidate], leaf))
  if (!key) return leaf
  const name = findFreeName(info, base)
  info[key][name] = copy(info[key][leaf])
  return name
}

/**
 * Removes an experiment, and the observations of it.
 *
 * @param {Object} document
 * @param {number} experiment
 * @returns {Object}
 */
export function removeExperiment(document, experiment) {
  return editDocument(document, (edited) => {
    const info = edited.protocol_info
    for (const key of PER_EXPERIMENT) if (Array.isArray(info[key])) info[key].splice(experiment, 1)
    for (const rows of Object.values(info.params_to_change)) rows.splice(experiment, 1)
    renumberExperiments(edited, (index) => (index === experiment ? null : index > experiment ? index - 1 : index))
  })
}

/**
 * Moves an experiment to another place, its observations with it.
 *
 * @param {Object} document
 * @param {number} from
 * @param {number} to
 * @returns {Object}
 */
export function moveExperiment(document, from, to) {
  return editDocument(document, (edited) => {
    const info = edited.protocol_info
    const move = (list) => list.splice(to, 0, ...list.splice(from, 1))
    for (const key of PER_EXPERIMENT) if (Array.isArray(info[key])) move(info[key])
    for (const rows of Object.values(info.params_to_change)) move(rows)
    const order = info.sim_times.map((_, index) => index)
    move(order)
    renumberExperiments(edited, (index) => order.indexOf(index))
  })
}

/**
 * Adds a sub-experiment at the end of an experiment, each parameter holding its last value.
 *
 * @param {Object} document
 * @param {number} experiment
 * @returns {Object}
 */
export function addSubExperiment(document, experiment) {
  return editDocument(document, ({ protocol_info: info }) => {
    const subs = info.sim_times[experiment]
    const last = subs.length - 1
    // The last sub-experiment's clock: the first's starts with the warm-up, as CA runs it.
    const end = (last === 0 ? info.pre_times?.[experiment] ?? 0 : 0) + subs[last]
    for (const rows of Object.values(info.params_to_change)) rows[experiment].push(findEndValue(info, rows[experiment][last], end))
    subs.push(subs[last])
  })
}

/**
 * Finds the value an input ends a sub-experiment on, as CA runs it: a number's own, a shape's or a trace's at the
 * sub-experiment's end, held at its last value past its own end.
 *
 * @param {Object} info - The protocol_info.
 * @param {number|string} leaf - A params_to_change value.
 * @param {number} end - The sub-experiment's end on its clock.
 * @returns {number} 0 for an input that can't be read.
 */
export function findEndValue(info, leaf, end) {
  if (typeof leaf === 'number') return leaf
  const own = (mapping) => (isMapping(mapping) && Object.hasOwn(mapping, leaf) ? mapping[leaf] : undefined)
  try {
    const rawShape = own(info.protocol_shapes)
    if (rawShape !== undefined) {
      const shape = normaliseShape(rawShape, leaf)
      return interpolateTrace(expandShape(shape, shape.duration ?? end, leaf), end)
    }
    const trace = own(info.protocol_traces)
    if (trace?.t?.length) return interpolateTrace(trace, end)
  } catch {
    // A shape CA would refuse has no end to carry on from.
  }
  return 0
}

/**
 * Removes a sub-experiment, and the observations of it; the experiment keeps at least one.
 *
 * @param {Object} document
 * @param {number} experiment
 * @param {number} sub
 * @returns {Object}
 */
export function removeSubExperiment(document, experiment, sub) {
  return editDocument(document, (edited) => {
    const info = edited.protocol_info
    if (info.sim_times[experiment].length < 2) return
    info.sim_times[experiment].splice(sub, 1)
    for (const rows of Object.values(info.params_to_change)) rows[experiment].splice(sub, 1)
    if (!Array.isArray(edited.data_items)) return
    edited.data_items = edited.data_items.flatMap((item) => {
      if ((item.experiment_idx ?? 0) !== experiment) return [item]
      const index = item.subexperiment_idx ?? 0
      if (index === sub) return []
      return index > sub ? [{ ...item, subexperiment_idx: index - 1 }] : [item]
    })
  })
}

/**
 * Sets an experiment's warm-up, a sub-experiment's length, or an experiment's label.
 *
 * @param {Object} document
 * @param {{experiment: number, sub?: number, preTime?: number, duration?: number, label?: string}} change
 * @returns {Object}
 */
export function setTiming(document, { experiment, sub, preTime, duration, label }) {
  return editDocument(document, ({ protocol_info: info }) => {
    if (preTime !== undefined) info.pre_times[experiment] = preTime
    if (duration !== undefined) {
      const previous = info.sim_times[experiment][sub]
      info.sim_times[experiment][sub] = duration
      keepStepsToTheEnd(info, experiment, sub, previous, duration)
    }
    if (label !== undefined) {
      // Labelling one experiment labels them all, as CA wants one each; the others keep the names they're shown by.
      if (!Array.isArray(info.experiment_labels)) info.experiment_labels = info.sim_times.map((_, index) => nameExperiment(index))
      // A cleared name goes back to the experiment's place, rather than leaving it nameless.
      info.experiment_labels[experiment] = label.trim() || nameExperiment(experiment)
    }
  })
}

/**
 * Adds a parameter the protocol sets, at one value throughout.
 *
 * @param {Object} document
 * @param {string} parameter - As CA names it, `instance/variable`.
 * @param {number} value
 * @returns {Object}
 */
export function addParameter(document, parameter, value) {
  return editDocument(document, ({ protocol_info: info }) => {
    if (!Object.hasOwn(info.params_to_change, parameter)) info.params_to_change[parameter] = info.sim_times.map((subs) => subs.map(() => value))
  })
}

/**
 * Stops the protocol setting a parameter.
 *
 * @param {Object} document
 * @param {string} parameter
 * @returns {Object}
 */
export function removeParameter(document, parameter) {
  return editDocument(document, ({ protocol_info: info }) => {
    delete info.params_to_change[parameter]
  })
}

/**
 * Sets a parameter's value in a sub-experiment: a number, or the name of a trace or shape.
 *
 * @param {Object} document
 * @param {{parameter: string, experiment: number, sub: number, value: number|string}} change
 * @returns {Object}
 */
export function setValue(document, { parameter, experiment, sub, value }) {
  return editDocument(document, ({ protocol_info: info }) => {
    info.params_to_change[parameter][experiment][sub] = value
  })
}

/**
 * Names the shape or trace a cell's own input is written as, as CUFLynx's editor names it.
 *
 * @param {string} parameter
 * @param {number} experiment
 * @param {number} sub
 * @returns {string}
 */
export const nameCellInput = (parameter, experiment, sub) => `${parameter.replaceAll('/', '_')}_e${experiment}s${sub}`

/**
 * Sets a parameter's input in a sub-experiment to a shape or a trace of its own: under its cell's name, replacing
 * what an earlier edit wrote there, unless another sub-experiment uses that name too.
 *
 * @param {Object} document
 * @param {{parameter: string, experiment: number, sub: number, shape?: Object, trace?: {t: number[], values:
 *   number[]}}} change - The shape as protocol_shapes has it, or the trace as protocol_traces has it.
 * @returns {Object}
 */
export function setInput(document, change) {
  return editDocument(document, ({ protocol_info: info }) => writeInput(info, change))
}

/**
 * Writes a sub-experiment's input into a protocol_info, as setInput does.
 *
 * @param {Object} info - Changed in place.
 * @param {{parameter: string, experiment: number, sub: number, shape?: Object, trace?: Object}} change
 */
function writeInput(info, { parameter, experiment, sub, shape, trace }) {
  // Never a name another sub-experiment uses, as one copied, moved or left by a removal may.
  const name = findFreeName(info, nameCellInput(parameter, experiment, sub), { parameter, experiment, sub })
  const [kept, other] = shape ? ['protocol_shapes', 'protocol_traces'] : ['protocol_traces', 'protocol_shapes']
  if (isMapping(info[other])) delete info[other][name]
  if (!isMapping(info[kept])) info[kept] = {}
  info[kept][name] = shape ?? trace
  info.params_to_change[parameter][experiment][sub] = name
}

/**
 * Keeps each step of a sub-experiment held to its end when its length changes: a step lasts to the end it was made
 * for, so it would otherwise end early, as a pulse, or fire nothing.
 *
 * @param {Object} info - Changed in place.
 * @param {number} experiment
 * @param {number} sub
 * @param {number} previous - The length the sub-experiment had.
 * @param {number} duration - The length it has now.
 */
function keepStepsToTheEnd(info, experiment, sub, previous, duration) {
  for (const [parameter, rows] of Object.entries(info.params_to_change)) {
    const leaf = rows[experiment][sub]
    const raw = typeof leaf === 'string' && isMapping(info.protocol_shapes) && Object.hasOwn(info.protocol_shapes, leaf) ? info.protocol_shapes[leaf] : null
    if (!raw || 'duration' in raw) continue
    let form
    try {
      form = readShapeForm(normaliseShape(raw, leaf), previous)
    } catch {
      continue
    }
    if (form?.type === 'step' && form.start < duration) writeInput(info, { parameter, experiment, sub, shape: buildShapeFromForm(form, duration) })
  }
}

/**
 * Rewrites an input of an experiment's first sub-experiment so that it starts with the sub-experiment, not with the
 * warm-up as CA runs it, holding its first value through the warm-up. The file stays one CA reads the same way.
 *
 * @param {Object} document
 * @param {{parameter: string, experiment: number, shape?: Object, trace?: Object}} change - The input as it is now:
 *   its shape, normalised (see normaliseShape), or its trace.
 * @returns {Object}
 */
export function alignWithWarmUp(document, { parameter, experiment, shape, trace }) {
  const info = ensureProtocol(document).protocol_info
  const preTime = info.pre_times[experiment]
  const duration = info.sim_times[experiment][0]
  if (!(preTime > 0)) return document
  const shift = (input) => ({ t: [0, ...input.t.map((time) => time + preTime)], values: [input.values[0], ...input.values] })
  if (shape?.type === PACING) {
    const events = shape.events.map((event) => ({ ...event, start: event.start + preTime }))
    return setInput(document, { parameter, experiment, sub: 0, shape: { baseline: shape.baseline, duration: (shape.duration ?? duration) + preTime, events } })
  }
  const points = shape ? { t: [0, shape.duration ?? duration], values: [shape.from, shape.to] } : trace
  return setInput(document, { parameter, experiment, sub: 0, trace: shift(points) })
}
