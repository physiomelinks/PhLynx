import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { MAX_TRACKED_RUNS } from '../../../src/services/simulation/trackedRuns.js'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'

/**
 * Makes a run's results.
 *
 * @param {Object} [extra]
 * @returns {Object}
 */
const makeResults = (extra = {}) => ({ voi: { name: 'm/t', unit: 'second', values: new Float64Array([0, 1]) }, variables: new Map(), isStopped: false, ...extra })

const SETTINGS = { initialPoint: 0, startingPoint: 0, endingPoint: 1, pointInterval: 0.5 }

describe('simulationResultsStore tracked runs', () => {
  let store

  /**
   * Runs a scope to the end.
   *
   * @param {string[]|null} [nodeIds]
   * @param {Object} [results]
   */
  const finish = (nodeIds = null, results = makeResults()) => {
    store.startRun(nodeIds)
    store.finishRun({ results, mapping: new Map(), signature: 's', inspectionOutputs: [], inputs: { settings: SETTINGS, overrides: { rows: new Map(), globals: new Map() } } })
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useSimulationResultsStore()
  })

  it('tracks only a finished run, with the settings it ran with', () => {
    expect(store.trackRun()).toBeNull()
    store.startRun(null)
    expect(store.canTrackRun()).toBe(false)
    store.finishRun({ results: makeResults(), mapping: new Map(), signature: 's', inspectionOutputs: [], inputs: { settings: SETTINGS, overrides: null } })
    const run = store.trackRun([{ key: 'k', label: 'a/k', value: 2, units: '' }])
    expect(run).toMatchObject({ number: 1, name: null, isVisible: true, settings: SETTINGS, inputs: [{ label: 'a/k' }] })
    expect(run.results).toBe(store.results)
    expect(store.trackedRuns).toHaveLength(1)
  })

  it('leaves a protocol run untracked, and clears the runs tracked before it', () => {
    finish()
    store.trackRun()
    store.startRun(null)
    const experiment = makeResults({ subs: [] })
    store.finishProtocolRun({ protocolResults: { experiments: [experiment], issues: [], elapsedMs: 0, isStopped: false }, experiment: 0, mapping: new Map(), signature: 's' })

    expect(store.trackedRuns).toEqual([])
    expect(store.trackBlocker).toMatch(/protocol run/)
    expect(store.trackRun()).toBeNull()
  })

  it('shows a failed protocol run’s experiments without the runs tracked before it', () => {
    finish()
    store.trackRun()
    store.isLiveRunVisible = false
    store.startRun(null)
    const experiment = makeResults({ subs: [] })
    store.failRun('error', { message: 'no' }, { results: experiment, mapping: new Map(), protocolResults: { experiments: [experiment], issues: [], elapsedMs: 0, isStopped: false } })

    expect(store.trackedRuns).toEqual([])
    expect(store.isLiveRunVisible).toBe(true)
  })

  it('leaves a sweep with curves untracked', () => {
    finish(null, makeResults({ isSweep: true, family: { name: 'a/b', unit: '', values: [1, 2], curves: [] } }))
    expect(store.trackBlocker).toMatch(/curves/)
    expect(store.trackRun()).toBeNull()
  })

  it('says why the shown run can’t be tracked, as trackRun decides', () => {
    const blockers = []
    const expectAgreement = () => {
      blockers.push(store.trackBlocker)
      expect(store.canTrackRun()).toBe(store.trackBlocker === null)
    }
    expectAgreement()
    store.startRun(null)
    expectAgreement()
    finish()
    expectAgreement()
    for (let i = 0; i < MAX_TRACKED_RUNS; i++) store.trackRun()
    expectAgreement()
    store.failRun('error', { message: 'no' }, { results: makeResults(), mapping: new Map() })
    expectAgreement()
    expect(blockers).toEqual([
      'Run the simulation first',
      'Wait for the run to finish',
      null,
      `Up to ${MAX_TRACKED_RUNS} runs can be tracked: stop tracking one to track another`,
      'The last run didn’t finish',
    ])
  })

  it('tracks a stopped run, but not a failed one', () => {
    finish(null, makeResults({ isStopped: true }))
    expect(store.trackRun()).not.toBeNull()
    store.failRun('error', { message: 'no' })
    expect(store.trackRun()).toBeNull()
  })

  it(`tracks at most ${MAX_TRACKED_RUNS} runs, reusing a number once its run goes`, () => {
    finish()
    for (let i = 0; i < MAX_TRACKED_RUNS; i++) store.trackRun()
    expect(store.trackRun()).toBeNull()
    expect(store.trackedRuns.map((run) => run.number)).toEqual([1, 2, 3, 4, 5])
    store.removeTrackedRun(store.trackedRuns[1].id)
    expect(store.trackRun().number).toBe(2)
  })

  it('keeps tracked runs as the same scope reruns, and forgets them for another scope', () => {
    finish(['a'])
    store.trackRun()
    finish(['a'])
    expect(store.trackedRuns).toHaveLength(1)
    finish(['b'])
    expect(store.trackedRuns).toHaveLength(0)
  })

  it('forgets tracked runs that a steady state can’t be compared with', () => {
    finish()
    store.trackRun()
    finish(null, makeResults({ isSteadyState: true }))
    expect(store.trackedRuns).toHaveLength(0)
  })

  it('keeps tracked sweeps of one parameter, and forgets them for a single solve or another parameter', () => {
    const sweepOf = (label) => makeResults({ isSteadyState: true, isSweep: true, sweepLabel: label })
    finish(null, sweepOf('cell/V'))
    store.trackRun()
    finish(null, sweepOf('cell/V'))
    expect(store.trackedRuns).toHaveLength(1)
    finish(null, sweepOf('cell/g'))
    expect(store.trackedRuns).toHaveLength(0)
    store.trackRun()
    finish(null, makeResults({ isSteadyState: true }))
    expect(store.trackedRuns).toHaveLength(0)
  })

  it('shows and hides runs, and shows the live run again once no run is tracked', () => {
    finish()
    const run = store.trackRun()
    store.toggleTrackedRun(run.id)
    expect(store.trackedRuns[0].isVisible).toBe(false)
    store.isLiveRunVisible = false
    store.removeTrackedRun(run.id)
    expect(store.isLiveRunVisible).toBe(true)
    store.trackRun()
    store.isLiveRunVisible = false
    store.removeAllTrackedRuns()
    expect(store.isLiveRunVisible).toBe(true)
  })

  it('names a tracked run, and goes back to its number given a blank name', () => {
    finish()
    const [first, second] = [store.trackRun(), store.trackRun()]
    const before = store.trackedRuns
    store.renameTrackedRun(first.id, '  Low gain ')
    expect(store.trackedRuns).not.toBe(before)
    expect(store.trackedRuns.map((run) => run.name)).toEqual(['Low gain', null])
    expect(store.trackedRuns[1]).toBe(second)
    store.renameTrackedRun(first.id, '   ')
    expect(store.trackedRuns[0]).toMatchObject({ id: first.id, number: 1, name: null })
    store.renameTrackedRun(first.id, 'Again')
    store.renameTrackedRun(first.id, null)
    expect(store.trackedRuns[0].name).toBeNull()
  })

  it('forgets tracked runs with the workspace', () => {
    finish()
    store.trackRun()
    store.resetState()
    expect(store.trackedRuns).toEqual([])
    expect(store.runInputs).toBeNull()
  })
})
