/**
 * Protocol shapes, ported from circulatory_autogen's `utilities/protocol_shapes.py`: Myokit-style pacing events and
 * ramps that expand into `protocol_traces`. Results and error messages match CA's exactly; golden vectors from CA
 * check this (tests/resources/protocols/ca-vectors.json).
 */
import { formatPythonFloat, formatPythonG, formatPythonList, formatPythonRepr, formatPythonStr, getPythonTypeName, isPythonFalsy } from './pythonFormat.js'

export const PACING = 'pacing'
export const RAMP = 'ramp'
export const SHAPE_TYPES = [PACING, RAMP]
// `Length` in a .mmt's column header, `duration` in Myokit's Python API.
const LENGTH_KEYS = ['length', 'duration']
const EVENT_KEYS = new Set(['level', 'start', 'period', 'multiplier', ...LENGTH_KEYS])
const SHAPE_KEYS = new Set(['type', 'events', 'baseline', 'duration', 'from', 'to'])
// The fraction of the shortest interval in a waveform that an edge, a short ramp, may take.
export const EDGE_FRACTION = 1e-3

/** A protocol_shapes entry that can't be turned into a trace. */
export class ProtocolShapeError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProtocolShapeError'
  }
}

/**
 * Whether a value is a JSON object (a Python dict).
 *
 * @param {*} value
 * @returns {boolean}
 */
export const isMapping = (value) => value != null && typeof value === 'object' && !Array.isArray(value)

/**
 * Reads a shape field as a finite number. A boolean isn't one, though Python counts it as an int.
 *
 * @param {*} value
 * @param {string} what - The field, for the error.
 * @returns {number}
 */
function toNumber(value, what) {
  if (typeof value !== 'number') throw new ProtocolShapeError(`${what} must be a number, got ${formatPythonRepr(value)}`)
  if (!Number.isFinite(value)) throw new ProtocolShapeError(`${what} must be finite, got ${formatPythonRepr(value)}`)
  return value
}

/**
 * Lists a mapping's keys outside the allowed ones, sorted, as CA reports them.
 *
 * @param {Object} mapping
 * @param {Set<string>} allowed
 * @returns {string[]}
 */
const unknownKeys = (mapping, allowed) => Object.keys(mapping).filter((key) => !allowed.has(key)).sort()

/**
 * Reads a field as Python's `mapping.get(key, fallback)`: an explicit null stays null.
 *
 * @param {Object} mapping
 * @param {string} key
 * @param {*} fallback
 * @returns {*}
 */
const readField = (mapping, key, fallback) => (Object.hasOwn(mapping, key) ? mapping[key] : fallback)

/**
 * Sets a key as an object's own, even one such as `__proto__`.
 *
 * @param {Object} object
 * @param {string} key
 * @param {*} value
 */
const setOwn = (object, key, value) => Object.defineProperty(object, key, { value, enumerable: true, writable: true, configurable: true })

/**
 * Checks one protocol_shapes entry and returns it in canonical form. A bare list of events is accepted as
 * shorthand for `{events: [...]}`.
 *
 * @param {Object|Array} shape
 * @param {string} name - The shape's name in protocol_shapes.
 * @returns {Object} `{type: 'pacing', events, baseline, duration?}` or `{type: 'ramp', from, to, duration?}`.
 * @throws {ProtocolShapeError}
 */
export function normaliseShape(shape, name) {
  if (Array.isArray(shape)) shape = { events: [...shape] }
  if (!isMapping(shape)) {
    throw new ProtocolShapeError(`protocol_shapes['${name}'] must be a mapping or a list of events, got ${getPythonTypeName(shape)}`)
  }

  const unknown = unknownKeys(shape, SHAPE_KEYS)
  if (unknown.length) {
    throw new ProtocolShapeError(
      `protocol_shapes['${name}'] has unknown keys ${formatPythonList(unknown)}; expected any of ${formatPythonList([...SHAPE_KEYS].sort())}`
    )
  }

  const type = readField(shape, 'type', PACING)
  if (!SHAPE_TYPES.includes(type)) {
    throw new ProtocolShapeError(`protocol_shapes['${name}'] has type '${formatPythonStr(type)}'; expected one of ${formatPythonList(SHAPE_TYPES)}`)
  }
  if (type === RAMP) return normaliseRamp(shape, name)

  const events = shape.events
  if (!Array.isArray(events) || !events.length) {
    throw new ProtocolShapeError(
      `protocol_shapes['${name}'] needs a non-empty 'events' list -- one entry per line of a .mmt [[protocol]] table`
    )
  }

  const normalised = events.map((raw, i) => {
    if (!isMapping(raw)) {
      throw new ProtocolShapeError(`protocol_shapes['${name}'].events[${i}] must be a mapping, got ${getPythonTypeName(raw)}`)
    }
    const unknownEventKeys = unknownKeys(raw, EVENT_KEYS)
    if (unknownEventKeys.length) {
      throw new ProtocolShapeError(
        `protocol_shapes['${name}'].events[${i}] has unknown keys ${formatPythonList(unknownEventKeys)}; expected any of ${formatPythonList([...EVENT_KEYS].sort())}`
      )
    }
    const where = `protocol_shapes['${name}'].events[${i}]`

    const givenLength = LENGTH_KEYS.filter((key) => Object.hasOwn(raw, key))
    if (!givenLength.length) throw new ProtocolShapeError(`${where} needs a 'length' (the .mmt column) or 'duration'`)
    if (givenLength.length > 1) {
      throw new ProtocolShapeError(
        `${where} gives both 'length' and 'duration'; they are the same field under two names, so give only one`
      )
    }
    const length = toNumber(raw[givenLength[0]], `${where}['${givenLength[0]}']`)
    if (length <= 0) throw new ProtocolShapeError(`${where} has length ${formatPythonFloat(length)}; an event must last some time`)

    if (!Object.hasOwn(raw, 'level')) throw new ProtocolShapeError(`${where} needs a 'level'`)
    const level = toNumber(raw.level, `${where}['level']`)
    const start = toNumber(readField(raw, 'start', 0), `${where}['start']`)
    if (start < 0) throw new ProtocolShapeError(`${where} has start ${formatPythonFloat(start)}; it cannot be before the run`)
    const period = toNumber(readField(raw, 'period', 0), `${where}['period']`)
    if (period < 0) throw new ProtocolShapeError(`${where} has period ${formatPythonFloat(period)}; it cannot be negative`)
    const multiplier = toNumber(readField(raw, 'multiplier', 0), `${where}['multiplier']`)
    if (multiplier < 0 || !Number.isInteger(multiplier)) {
      throw new ProtocolShapeError(
        `${where} has multiplier ${formatPythonFloat(multiplier)}; it must be a non-negative whole number (0 means repeat for as long as the sub-experiment lasts)`
      )
    }
    if (period === 0 && multiplier > 1) {
      throw new ProtocolShapeError(
        `${where} repeats ${multiplier} times but has no period, so every repeat would land on top of the first one`
      )
    }
    return { level, start, length, period, multiplier }
  })

  const canonical = { type, events: normalised, baseline: toNumber(readField(shape, 'baseline', 0), `protocol_shapes['${name}']['baseline']`) }
  if (Object.hasOwn(shape, 'duration')) canonical.duration = readDuration(shape, name)
  return canonical
}

/**
 * Reads a shape's own duration, which must be positive.
 *
 * @param {Object} shape
 * @param {string} name
 * @returns {number}
 */
function readDuration(shape, name) {
  const duration = toNumber(shape.duration, `protocol_shapes['${name}']['duration']`)
  if (duration <= 0) {
    throw new ProtocolShapeError(`protocol_shapes['${name}'] has duration ${formatPythonFloat(duration)}; it must be positive`)
  }
  return duration
}

/**
 * Checks a ramp: a linear sweep from `from` at the sub-experiment's start to `to` at its end.
 *
 * @param {Object} shape
 * @param {string} name
 * @returns {Object}
 */
function normaliseRamp(shape, name) {
  for (const key of ['from', 'to']) {
    if (!Object.hasOwn(shape, key)) throw new ProtocolShapeError(`protocol_shapes['${name}'] is a ramp, so it needs '${key}'`)
  }
  const unused = ['baseline', 'events'].filter((key) => Object.hasOwn(shape, key))
  if (unused.length) {
    throw new ProtocolShapeError(`protocol_shapes['${name}'] is a ramp, so ${formatPythonList(unused)} does not apply to it`)
  }
  const canonical = {
    type: RAMP,
    from: toNumber(shape.from, `protocol_shapes['${name}']['from']`),
    to: toNumber(shape.to, `protocol_shapes['${name}']['to']`),
  }
  if (Object.hasOwn(shape, 'duration')) canonical.duration = readDuration(shape, name)
  return canonical
}

/**
 * When an event fires within [0, duration), by Myokit's rules: no period fires once; a period with multiplier 0
 * repeats for as long as the sub-experiment runs.
 *
 * @param {Object} event - A normalised event.
 * @param {number} duration
 * @returns {number[]}
 */
function findOccurrences({ start, period, multiplier }, duration) {
  if (period === 0) return start < duration ? [start] : []
  const times = []
  let when = start
  const limit = multiplier || null
  const maxPoints = Math.trunc(duration / period) + 2
  while (when < duration && (limit == null || times.length < limit)) {
    times.push(when)
    when += period
    if (limit == null && times.length > maxPoints) break
  }
  return times
}

/**
 * Lists `[start, end, level]` for every occurrence, sorted, refusing overlaps.
 *
 * @param {Object[]} events - A normalised pacing shape's.
 * @param {number} duration - The time the shape is expanded over.
 * @param {string} name
 * @returns {Array<[number, number, number]>}
 * @throws {ProtocolShapeError}
 */
export function findIntervals(events, duration, name) {
  const spans = events.flatMap((event) =>
    findOccurrences(event, duration).map((start) => [start, Math.min(start + event.length, duration), event.level])
  )
  spans.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2])
  for (let i = 1; i < spans.length; i++) {
    const [aStart, aEnd] = spans[i - 1]
    const [bStart] = spans[i]
    if (bStart < aEnd) {
      throw new ProtocolShapeError(
        `protocol_shapes['${name}'] has events that overlap: one runs from ${formatPythonG(aStart)} to ${formatPythonG(aEnd)} while another starts at ${formatPythonG(bStart)}. Myokit rejects overlapping events too -- the value during the overlap would be ambiguous.`
      )
    }
  }
  return spans
}

/**
 * Expands a normalised shape over a sub-experiment into a trace. Square edges become ramps a small fraction of the
 * shortest feature long, as the trace is interpolated linearly.
 *
 * @param {Object} shape - From normaliseShape.
 * @param {number} duration - The sub-experiment's length.
 * @param {string} name
 * @returns {{t: number[], values: number[]}}
 * @throws {ProtocolShapeError}
 */
export function expandShape(shape, duration, name) {
  duration = toNumber(duration, `duration for protocol_shapes['${name}']`)
  if (duration <= 0) {
    throw new ProtocolShapeError(
      `protocol_shapes['${name}'] is used over a sub-experiment of length ${formatPythonG(duration)}; there is no time to pace anything in`
    )
  }
  if (shape.type === RAMP) return { t: [0, duration], values: [shape.from, shape.to] }

  const { baseline } = shape
  const spans = findIntervals(shape.events, duration, name)
  if (!spans.length) {
    throw new ProtocolShapeError(
      `protocol_shapes['${name}'] fires nothing within the ${formatPythonG(duration)} it is run over -- check 'start' against the sub-experiment's sim_time`
    )
  }

  const features = spans.map(([start, end]) => end - start)
  for (let i = 1; i < spans.length; i++) if (spans[i][0] > spans[i - 1][1]) features.push(spans[i][0] - spans[i - 1][1])
  if (spans[0][0] > 0) features.push(spans[0][0])
  const last = spans.at(-1)
  if (last[1] < duration) features.push(duration - last[1])
  const smallest = Math.min(...features.filter((feature) => feature > 0))
  const edgeWidth = Math.max(smallest * EDGE_FRACTION, duration * 1e-12)

  const t = [0]
  const values = [baseline]
  /** Adds a point; one at the same instant as the last replaces its value, as the later edge wins. */
  const push = (when, value) => {
    when = Math.min(Math.max(when, 0), duration)
    if (when > t.at(-1)) {
      t.push(when)
      values.push(value)
    } else values[values.length - 1] = value
  }
  for (const [start, end, level] of spans) {
    if (start > 0) push(start, baseline)
    push(Math.min(start + edgeWidth, duration), level)
    if (end > start + edgeWidth) push(end, level)
    if (end < duration) push(Math.min(end + edgeWidth, duration), baseline)
  }
  push(duration, last[1] < duration ? baseline : last[2])
  return { t, values }
}

/**
 * Lists the string leaves of a params_to_change entry, with their experiment and sub-experiment.
 *
 * @param {*} value - A params_to_change entry.
 * @returns {Array<[number, number, string]>}
 */
export function findStringLeaves(value) {
  if (!Array.isArray(value)) return []
  return value.flatMap((row, experiment) => {
    if (Array.isArray(row)) return row.flatMap((leaf, sub) => (typeof leaf === 'string' ? [[experiment, sub, leaf]] : []))
    return typeof row === 'string' ? [[experiment, 0, row]] : []
  })
}

/**
 * Expands protocol_shapes into protocol_traces, as CA does once on reading a file. A shape takes the length of the
 * sub-experiments that use it, unless it gives its own duration.
 *
 * @param {Object} protocolInfo
 * @returns {Object} A copy with the expanded traces added to protocol_traces; unchanged when it has no shapes.
 * @throws {ProtocolShapeError}
 */
export function materialiseShapes(protocolInfo) {
  if (!isMapping(protocolInfo)) return protocolInfo
  const rawShapes = protocolInfo.protocol_shapes
  if (isPythonFalsy(rawShapes)) return protocolInfo
  if (!isMapping(rawShapes)) {
    throw new ProtocolShapeError(`protocol_shapes must be a mapping of name -> shape, got ${getPythonTypeName(rawShapes)}`)
  }

  const traces = isMapping(protocolInfo.protocol_traces) ? { ...protocolInfo.protocol_traces } : {}
  const shapes = Object.fromEntries(Object.entries(rawShapes).map(([name, shape]) => [name, normaliseShape(shape, name)]))

  const simTimes = protocolInfo.sim_times || []
  // Shape name → duration → the leaves that use it at that length.
  const durations = new Map()
  for (const [param, value] of Object.entries(protocolInfo.params_to_change || {})) {
    for (const [experiment, sub, leaf] of findStringLeaves(value)) {
      if (!Object.hasOwn(shapes, leaf)) continue
      const row = simTimes[experiment]
      const duration = toPythonFloat(Array.isArray(row) || typeof row === 'string' ? row[sub] : undefined)
      if (duration === undefined) {
        throw new ProtocolShapeError(
          `params_to_change['${param}'][${experiment}][${sub}] uses shape '${leaf}', but sim_times has no matching sub-experiment`
        )
      }
      if (!durations.has(leaf)) durations.set(leaf, new Map())
      const seen = durations.get(leaf)
      if (!seen.has(duration)) seen.set(duration, [])
      seen.get(duration).push(`${param}[${experiment}][${sub}]`)
    }
  }

  for (const [name, shape] of Object.entries(shapes)) {
    let duration = shape.duration
    if (duration == null) {
      const seen = durations.get(name)
      if (!seen) {
        throw new ProtocolShapeError(
          `protocol_shapes['${name}'] is never used by params_to_change, so there is no sub-experiment to size it against. Reference it, remove it, or give it an explicit 'duration'.`
        )
      }
      if (seen.size > 1) {
        const lengths = [...seen]
          .sort(([a], [b]) => a - b)
          .map(([length, refs]) => `${formatPythonG(length)} (from ${refs.join(', ')})`)
          .join(', ')
        throw new ProtocolShapeError(
          `protocol_shapes['${name}'] is used over sub-experiments of different lengths: ${lengths}. Give it an explicit 'duration', or split it into one shape per length.`
        )
      }
      duration = seen.keys().next().value
    }
    const generated = expandShape(shape, duration, name)
    if (Object.hasOwn(traces, name) && !isSameTrace(traces[name], generated)) {
      throw new ProtocolShapeError(
        `'${name}' is defined in both protocol_shapes and protocol_traces, and they disagree. They are alternatives -- define each name in one or the other.`
      )
    }
    setOwn(traces, name, generated)
  }
  return { ...protocolInfo, protocol_traces: traces }
}

/**
 * Reads a value as Python's `float()` would, for a sim_times entry.
 *
 * @param {*} value
 * @returns {number|undefined} Undefined where `float()` would raise.
 */
function toPythonFloat(value) {
  if (typeof value === 'number') return value
  if (typeof value === 'boolean') return Number(value)
  if (typeof value !== 'string') return undefined
  const text = value.trim()
  const special = /^([+-]?)(inf|infinity|nan)$/i.exec(text)
  if (special) return special[2].toLowerCase() === 'nan' ? Number.NaN : (special[1] === '-' ? -Infinity : Infinity)
  // Digits may be grouped with single underscores, as in Python literals; hex and the like aren't floats.
  if (!/^[+-]?(\d(_?\d)*(\.(\d(_?\d)*)?)?|\.\d(_?\d)*)([eE][+-]?\d(_?\d)*)?$/.test(text)) return undefined
  return Number(text.replaceAll('_', ''))
}

/**
 * Whether two traces are equal, as Python compares their dicts.
 *
 * @param {*} a
 * @param {{t: number[], values: number[]}} b
 * @returns {boolean}
 */
function isSameTrace(a, b) {
  if (!isMapping(a) || Object.keys(a).length !== 2) return false
  // Python counts True and False as 1 and 0.
  const asNumber = (value) => (typeof value === 'boolean' ? Number(value) : value)
  const isSameList = (x, y) => Array.isArray(x) && x.length === y.length && x.every((value, i) => asNumber(value) === asNumber(y[i]))
  return isSameList(a.t, b.t) && isSameList(a.values, b.values)
}

/**
 * Refuses params_to_change strings that name no trace or shape.
 *
 * @param {Object} protocolInfo
 * @throws {ProtocolShapeError}
 */
export function validateTraceReferences(protocolInfo) {
  if (!isMapping(protocolInfo)) return
  const known = new Set([...Object.keys(protocolInfo.protocol_traces || {}), ...Object.keys(protocolInfo.protocol_shapes || {})])
  const missing = Object.entries(protocolInfo.params_to_change || {}).flatMap(([param, value]) =>
    findStringLeaves(value)
      .filter(([, , leaf]) => !known.has(leaf))
      .map(([experiment, sub, leaf]) => `  params_to_change['${param}'][${experiment}][${sub}] -> '${leaf}'`)
  )
  if (missing.length) {
    throw new ProtocolShapeError(
      `params_to_change refers to traces that are defined nowhere:\n${missing.join('\n')}\nDefined names: ${known.size ? formatPythonList([...known].sort()) : 'none'}`
    )
  }
}
