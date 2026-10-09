/**
 * Plans a protocol's runs as circulatory_autogen makes them (protocol_executor.py): each experiment afresh, its first
 * sub-experiment after an unlogged warm-up, each later one carrying on from the states the one before ended with,
 * its clock back at 0. The warm-up runs on its own, through CA's own count of points, so that the solver's limit on
 * steps between two points isn't spent on the whole of it.
 */
import { PACING, changesDuringWarmUp, findIntervals } from '@physiomelinks/protocol-kit'

// A protocol split into more runs than this would be slow to run.
export const MAX_SEGMENTS = 2000

/**
 * Reads a cell as a value at each time of its sub-experiment's clock, and the times it changes at. A pacing shape's
 * time is its sub-experiment's, starting with the warm-up for the first, and after its end it keeps its last value,
 * as CA's interpolated trace does.
 *
 * @param {Object} cell - From readProtocolInfo.
 * @param {number} duration - The sub-experiment's length.
 * @returns {{valueAt: Function, edges: number[]}|null} Null for a value that changes continuously.
 */
function readCellSchedule(cell, duration) {
  if (cell.kind === 'constant') return { valueAt: () => cell.value, edges: [] }
  if (cell.kind !== 'shape' || cell.shape.type !== PACING) return null
  const length = cell.shape.duration ?? duration
  const spans = findIntervals(cell.shape.events, length, cell.name)
  const { baseline } = cell.shape
  const last = spans.length && spans.at(-1)[1] >= length ? spans.at(-1)[2] : baseline
  return {
    valueAt: (time) => (time >= length ? last : (spans.find(([from, to]) => time >= from && time < to)?.[2] ?? baseline)),
    edges: spans.flatMap(([from, to]) => [from, to]).filter((edge) => edge > 0 && edge < length),
  }
}

/**
 * Whether a time lies on a grid of points, within rounding.
 *
 * @param {number} offset - From the grid's start.
 * @param {number} spacing
 * @returns {number|null} The point's index, or null when it falls between points.
 */
function findGridIndex(offset, spacing) {
  const index = Math.round(offset / spacing)
  return Math.abs(offset / spacing - index) <= 1e-9 * Math.max(1, index) ? index : null
}

/**
 * Plans the runs of a protocol. Steps, pulses and pacing run exactly: their sub-experiment is split where each
 * changes, so the solver starts afresh at every edge.
 *
 * @param {Object} options
 * @param {Object} options.view - The protocol, from readProtocolInfo.
 * @param {number} options.pointInterval - The time between output points, CA's dt.
 * @param {Map<string, string>} [options.kinds] - Each parameter's kind ('state' or 'constant'), where known.
 * @param {Map<string, {selectorParameter: string, valueParameter: string, selectors: number[][]}>} [options.drivers] -
 *   The parameters a driver computes (see planDrivers), by parameter: each sub-experiment sets its driver's selector
 *   and number instead.
 * @returns {{errors: string[], warnings: string[], experiments: Array<{preTime: number, segments: Object[], subs:
 *   Array<{startIndex: number, endIndex: number, duration: number, numberOfSteps: number}>, pointCount: number,
 *   modelTime: number}>}} Each segment is `{sub, duration, timeCourse, values, carriesStates, isLogged,
 *   dropsFirstPoint, startIndex}`: `timeCourse` as libOpenCOR takes it, `values` as `[{parameter, value}]`,
 *   `carriesStates` when it starts from the states the segment before ended with, `isLogged` unless it is part of a
 *   warm-up, `dropsFirstPoint` when its first point repeats the last one before it, and `startIndex` where its points
 *   go in the joined results. `subs` index each sub-experiment's points there.
 */
export function compileProtocolPlan({ view, pointInterval, kinds = new Map(), drivers = new Map() }) {
  const errors = []
  const warnings = []
  if (!(pointInterval > 0) || !Number.isFinite(pointInterval)) {
    return { errors: ['The point interval needs to be above 0.'], warnings, experiments: [] }
  }

  const experiments = view.experiments.map((experiment, e) => {
    const where = (s) => `Experiment ${e + 1}, sub-experiment ${s + 1}`
    const { preTime } = experiment
    const segments = []
    const subs = []
    let pointCount = 1
    experiment.subs.forEach((sub, s) => {
      // CA's int(sim_time / dt): the points of a sub-experiment that doesn't divide evenly are spread across it.
      const numberOfSteps = Math.trunc(sub.duration / pointInterval)
      if (numberOfSteps < 1) {
        errors.push(`${where(s)} (${sub.duration}) is shorter than the point interval (${pointInterval}).`)
        return
      }
      const schedules = []
      for (const { parameter, cells } of view.controls) {
        const cell = cells[e][s]
        // CA sets a state's initial value only before the first sub-experiment; later ones carry their states on.
        if (s > 0 && kinds.get(parameter) === 'state') {
          errors.push(`${where(s)}: ${parameter} is a state, so it can only be set for the first sub-experiment.`)
          continue
        }
        const driver = drivers.get(parameter)
        if (s === 0 && preTime > 0 && changesDuringWarmUp(cell, preTime, sub.duration)) {
          warnings.push(
            `Experiment ${e + 1}: ${parameter}'s ${cell.name} starts with the warm-up, as circulatory autogen runs it, so it shows ${preTime} earlier than written.`
          )
        }
        if (driver) {
          schedules.push({ parameter: driver.selectorParameter, valueAt: () => driver.selectors[e][s], edges: [] })
          schedules.push({ parameter: driver.valueParameter, valueAt: () => (cell.kind === 'constant' ? cell.value : 0), edges: [] })
          continue
        }
        if (cell.kind !== 'constant' && kinds.get(parameter) === 'state') {
          errors.push(`${where(s)}: ${parameter} is a state, so it can be set to a number but not to a step or pulse.`)
          continue
        }
        let schedule
        try {
          schedule = readCellSchedule(cell, sub.duration)
        } catch (error) {
          errors.push(`${where(s)}: ${error.message}`)
          continue
        }
        if (!schedule) {
          errors.push(`${where(s)}: ${parameter} changes continuously (a ramp or a trace), which PhLynx can't run yet.`)
          continue
        }
        schedules.push({ parameter, ...schedule })
      }
      // The sub-experiment's clock: the first carries on from the warm-up, each later one starts again at 0.
      const start = s === 0 ? preTime : 0
      const valuesAt = (time) => schedules.map(({ parameter, valueAt }) => ({ parameter, value: valueAt(time) }))
      const edges = [...new Set(schedules.flatMap(({ edges: times }) => times))].sort((a, b) => a - b)

      if (s === 0 && preTime > 0) {
        // The warm-up isn't logged, so it splits wherever a value changes, each part through CA's count of points.
        const cuts = [0, ...edges.filter((edge) => edge < preTime), preTime]
        cuts.slice(0, -1).forEach((from, index) => {
          const to = cuts[index + 1]
          const timeCourse = { initialTime: from, outputStartTime: from, outputEndTime: to, numberOfSteps: Math.max(1, Math.trunc((to - from) / pointInterval)) }
          segments.push({ sub: 0, duration: to - from, timeCourse, values: valuesAt((from + to) / 2), carriesStates: index > 0, isLogged: false, dropsFirstPoint: false, startIndex: null })
        })
      }

      const spacing = sub.duration / numberOfSteps
      const indices = new Set([0, numberOfSteps])
      const offGrid = []
      for (const edge of edges) {
        const offset = edge - start
        if (offset <= 0 || offset >= sub.duration) continue
        const index = findGridIndex(offset, spacing)
        if (index == null) offGrid.push(edge)
        else indices.add(index)
      }
      if (offGrid.length) {
        const times = offGrid.length > 1 ? `${offGrid.slice(0, -1).join(', ')} and ${offGrid.at(-1)}` : offGrid[0]
        errors.push(`${where(s)}: a value changes at ${times}, between output points; choose a point interval that divides ${offGrid.length > 1 ? 'them' : 'it'}.`)
      }
      const cuts = [...indices].sort((a, b) => a - b)
      const subStartIndex = pointCount - 1
      const timeAt = (index) => (index === numberOfSteps ? start + sub.duration : index * spacing + start)
      cuts.slice(0, -1).forEach((from, index) => {
        const to = cuts[index + 1]
        const timeCourse = { initialTime: timeAt(from), outputStartTime: timeAt(from), outputEndTime: timeAt(to), numberOfSteps: to - from }
        segments.push({
          sub: s,
          duration: timeAt(to) - timeAt(from),
          timeCourse,
          values: valuesAt((timeAt(from) + timeAt(to)) / 2),
          carriesStates: segments.length > 0,
          isLogged: true,
          // A part after the first starts at the point the one before ended on, which the join keeps from that one.
          dropsFirstPoint: s > 0 || index > 0,
          startIndex: subStartIndex + from,
        })
      })
      pointCount += numberOfSteps
      subs.push({ startIndex: subStartIndex, endIndex: pointCount - 1, duration: sub.duration, numberOfSteps })
    })
    return { preTime, segments, subs, pointCount, modelTime: preTime + experiment.duration }
  })
  const segmentCount = experiments.reduce((total, { segments }) => total + segments.length, 0)
  if (segmentCount > MAX_SEGMENTS) {
    errors.push(`The protocol needs ${segmentCount} runs, one for each time a value changes; PhLynx runs at most ${MAX_SEGMENTS}.`)
  }
  return { errors, warnings, experiments: errors.length ? [] : experiments }
}

/**
 * Gives evenly spaced times from start to stop, as numpy.linspace does.
 *
 * @param {number} start
 * @param {number} stop
 * @param {number} numberOfSteps
 * @returns {Float64Array} numberOfSteps + 1 times.
 */
export function buildLinearSpace(start, stop, numberOfSteps) {
  const times = new Float64Array(numberOfSteps + 1)
  const step = (stop - start) / numberOfSteps
  for (let i = 0; i < numberOfSteps; i++) times[i] = i * step + start
  times[numberOfSteps] = stop
  return times
}

/**
 * Gives an experiment's joined time as CA computes it: each sub-experiment's points from where the one before
 * ended, less the warm-up, so 0 is the end of the warm-up.
 *
 * @param {Object} experimentPlan - One of compileProtocolPlan's experiments.
 * @returns {Float64Array}
 */
export function buildExperimentTime({ preTime, subs, pointCount }) {
  const time = new Float64Array(pointCount)
  let currentTime = 0
  let index = 0
  subs.forEach(({ duration, numberOfSteps }, s) => {
    if (s === 0) currentTime += preTime
    const times = buildLinearSpace(currentTime, currentTime + duration, numberOfSteps)
    for (let i = s > 0 ? 1 : 0; i < times.length; i++) time[index++] = times[i] - preTime
    currentTime += duration
  })
  return time
}

/**
 * Copies a segment's series into its experiment's joined one. A segment whose first point repeats the last one before
 * it leaves that point as the one before set it, as CA's join does.
 *
 * @param {Float64Array} joined - The experiment's series, pointCount long.
 * @param {Float64Array} values - The segment's series.
 * @param {number} startIndex - Where the segment's first point goes.
 * @param {boolean} dropsFirstPoint
 */
export function joinSegmentValues(joined, values, startIndex, dropsFirstPoint) {
  joined.set(dropsFirstPoint ? values.subarray(1) : values, dropsFirstPoint ? startIndex + 1 : startIndex)
}
