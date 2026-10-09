import { describe, expect, it, vi } from 'vitest'

import { MAX_RESULT_BYTES, SimulationError } from '../../../../src/services/simulation/engine.js'
import { mergeChanges, runProtocol } from '../../../../src/services/simulation/protocolRunner.js'
import { buildLinearSpace, compileProtocolPlan } from '../../../../src/services/protocol/libopencorEngine/protocolPlan.js'
import { readProtocolInfo } from '../../../../src/services/protocol/protocolModel.js'
import { validateProtocolInfo } from '../../../../src/services/protocol/protocolValidation.js'

const TARGETS = new Map([['decay/k', 'c/k']])

/**
 * Stands in for a simulation session running dx/dt = -k x, solved exactly, from x = 1 and k = 0.5 unless changed.
 *
 * @param {Object} [options]
 * @param {number} [options.failOnRun] - The run (from 1) that fails, keeping its first two points.
 * @param {boolean} [options.isHeld] - Whether runs go on until stopped, keeping their first three points.
 * @returns {Object} The session, with `runs` recording what each run was given.
 */
function createFakeSession({ failOnRun = null, isHeld = false } = {}) {
  const runs = []
  return {
    runs,
    run({ settings, timeCourse, changes }) {
      runs.push({ settings, timeCourse, changes })
      const value = (name, fallback) => changes.find((change) => `${change.component}/${change.variable}` === name)?.value ?? fallback
      const [x0, k] = [value('c/x', 1), value('c/k', 0.5)]
      const voi = buildLinearSpace(timeCourse.outputStartTime, timeCourse.outputEndTime, timeCourse.numberOfSteps)
      const results = (length) => ({
        voi: { name: 'c/t', unit: 'second', values: voi.slice(0, length) },
        variables: new Map([
          ['c/x', { kind: 'state', unit: 'dimensionless', values: voi.map((t) => x0 * Math.exp(-k * (t - timeCourse.initialTime))).slice(0, length) }],
          ['c/k', { kind: 'constant', unit: 'per_second', values: new Float64Array(voi.length).fill(k).slice(0, length) }],
        ]),
        issues: [],
        elapsedMs: 1,
        isStopped: false,
      })
      if (isHeld) {
        let release
        const promise = new Promise((resolve) => (release = resolve))
        return { promise, stop: () => release({ ...results(3), isStopped: true }) }
      }
      const stop = vi.fn()
      if (runs.length === failOnRun) return { promise: Promise.reject(new SimulationError('The simulation failed.', [], results(2))), stop }
      return { promise: Promise.resolve(results(voi.length)), stop }
    },
  }
}

/**
 * Plans a protocol_info's runs.
 *
 * @param {Object} protocolInfo
 * @param {number} [pointInterval]
 * @returns {Object}
 */
function plan(protocolInfo, pointInterval = 0.5) {
  const { errors, protocolInfo: valid } = validateProtocolInfo(protocolInfo)
  expect(errors).toEqual([])
  const compiled = compileProtocolPlan({ view: readProtocolInfo(valid), pointInterval })
  expect(compiled.errors).toEqual([])
  return compiled
}

const STEP = plan({ pre_times: [1], sim_times: [[2, 2]], params_to_change: { 'decay/k': [[0.5, 1]] } })

describe('runProtocol', () => {
  it("runs each sub-experiment from the states the one before ended with, and joins them as CA does", async () => {
    const session = createFakeSession()
    const progress = []
    const results = await runProtocol({ session, plan: STEP, settings: { solver: 'CVODE' }, targets: TARGETS, onProgress: (value) => progress.push(value) }).promise

    const [experiment] = results.experiments
    expect([...experiment.voi.values]).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])
    const x = experiment.variables.get('c/x').values
    // The warm-up decays x to exp(-0.5) before the first point; the second sub-experiment decays twice as fast.
    expect(x[0]).toBeCloseTo(Math.exp(-0.5), 12)
    expect(x[4]).toBeCloseTo(Math.exp(-1.5), 12)
    expect(x[8]).toBeCloseTo(Math.exp(-1.5) * Math.exp(-2), 12)
    expect([...experiment.variables.get('c/k').values]).toEqual([0.5, 0.5, 0.5, 0.5, 0.5, 1, 1, 1, 1])
    expect(experiment.subs).toEqual(STEP.experiments[0].subs)
    expect(session.runs.map(({ timeCourse }) => timeCourse)).toEqual(STEP.experiments[0].segments.map(({ timeCourse }) => timeCourse))
    // The warm-up, then the first sub-experiment carrying on from it, then the second.
    expect(session.runs.map(({ changes }) => changes.map(({ variable }) => variable))).toEqual([['k'], ['k', 'x'], ['k', 'x']])
    expect(session.runs[2].changes).toEqual([
      { component: 'c', variable: 'k', value: 1 },
      { component: 'c', variable: 'x', value: x[4] },
    ])
    expect(progress.at(-1)).toBe(1)
    expect(results).toMatchObject({ issues: [], elapsedMs: 3, isStopped: false })
  })

  it('runs a pulse as parts of its sub-experiment, joined on its points', async () => {
    const pulsed = plan({
      pre_times: [0],
      sim_times: [[4]],
      params_to_change: { 'decay/k': [['pulse']] },
      protocol_shapes: { pulse: { baseline: 0.5, events: [{ level: 2, start: 1, length: 1 }] } },
    })
    const { experiments } = await runProtocol({ session: createFakeSession(), plan: pulsed, settings: {}, targets: TARGETS }).promise

    const [{ voi, variables }] = experiments
    expect([...voi.values]).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])
    expect([...variables.get('c/k').values]).toEqual([0.5, 0.5, 0.5, 2, 2, 0.5, 0.5, 0.5, 0.5])
    // x decays at 0.5 to t = 1, at 2 to t = 2, then at 0.5 again.
    const x = variables.get('c/x').values
    expect(x[2]).toBeCloseTo(Math.exp(-0.5), 12)
    expect(x[4]).toBeCloseTo(Math.exp(-0.5 - 2), 12)
    expect(x[8]).toBeCloseTo(Math.exp(-0.5 - 2 - 1), 12)
  })

  it("lets the protocol's values win over the sliders', and starts each experiment afresh", async () => {
    const session = createFakeSession()
    const twoExperiments = plan({ pre_times: [0, 0], sim_times: [[1], [1]], params_to_change: { 'decay/k': [[1], [2]] } })
    const sliders = [
      { component: 'c', variable: 'k', value: 9 },
      { component: 'c', variable: 'other', value: 3 },
    ]
    const { experiments } = await runProtocol({ session, plan: twoExperiments, settings: {}, targets: TARGETS, baseChanges: sliders }).promise

    expect(session.runs.map(({ changes }) => changes)).toEqual([
      [{ component: 'c', variable: 'k', value: 1 }, { component: 'c', variable: 'other', value: 3 }],
      [{ component: 'c', variable: 'k', value: 2 }, { component: 'c', variable: 'other', value: 3 }],
    ])
    expect(experiments.map(({ variables }) => variables.get('c/x').values[0])).toEqual([1, 1])
  })

  it('keeps the experiments run so far when one fails, saying which', async () => {
    const twoExperiments = plan({ pre_times: [0, 0], sim_times: [[1], [1, 1]] })
    const error = await runProtocol({ session: createFakeSession({ failOnRun: 3 }), plan: twoExperiments, settings: {}, targets: TARGETS }).promise.catch((reason) => reason)

    expect(error).toBeInstanceOf(SimulationError)
    expect(error.message).toBe('Experiment 2: The simulation failed.')
    // The second experiment's first sub-experiment, and the point the failed one computed after it.
    expect(error.partialResults.experiments.map(({ voi }) => [...voi.values])).toEqual([[0, 0.5, 1], [0, 0.5, 1, 1.5]])
  })

  it('stops the segment running, keeping the points it computed, and runs no more', async () => {
    const session = createFakeSession({ isHeld: true })
    const noWarmUp = plan({ pre_times: [0], sim_times: [[2, 2]], params_to_change: { 'decay/k': [[0.5, 1]] } })
    const run = runProtocol({ session, plan: noWarmUp, settings: {}, targets: TARGETS })
    await vi.waitFor(() => expect(session.runs).toHaveLength(1))
    run.stop()
    const results = await run.promise

    expect(session.runs).toHaveLength(1)
    expect(results.isStopped).toBe(true)
    expect([...results.experiments[0].voi.values]).toEqual([0, 0.5, 1])
  })

  it('runs nothing when stopped before it starts', async () => {
    const session = createFakeSession()
    const run = runProtocol({ session, plan: STEP, settings: {}, targets: TARGETS })
    run.stop()

    expect(await run.promise).toMatchObject({ experiments: [], isStopped: true })
    expect(session.runs).toEqual([])
  })

  it("refuses a parameter the model doesn't have", async () => {
    await expect(runProtocol({ session: createFakeSession(), plan: STEP, settings: {}, targets: new Map() }).promise).rejects.toThrow(
      "The protocol sets decay/k, which isn't in the model."
    )
  })

  it('refuses a protocol whose results would not fit in memory, after its first segment', async () => {
    const huge = plan({ pre_times: [0], sim_times: [[1]] }, 1)
    huge.experiments[0].pointCount = MAX_RESULT_BYTES
    const session = createFakeSession()
    huge.experiments[0].segments[0].timeCourse.numberOfSteps = 1
    await expect(runProtocol({ session, plan: huge, settings: {}, targets: TARGETS }).promise).rejects.toThrow(/GB of memory/)
  })
})

describe('mergeChanges', () => {
  it('keeps one change per variable, the last given', () => {
    expect(
      mergeChanges([
        [{ component: 'a', variable: 'b', value: 1 }],
        [
          { component: 'a', variable: 'b', value: 2 },
          { component: 'a', variable: 'c', value: 3 },
        ],
      ])
    ).toEqual([
      { component: 'a', variable: 'b', value: 2 },
      { component: 'a', variable: 'c', value: 3 },
    ])
  })
})
