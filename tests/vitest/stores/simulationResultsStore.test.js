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
    expect(run).toMatchObject({ number: 1, isVisible: true, settings: SETTINGS, inputs: [{ label: 'a/k' }] })
    expect(run.results).toBe(store.results)
    expect(store.trackedRuns).toHaveLength(1)
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

  it('forgets tracked runs with the workspace', () => {
    finish()
    store.trackRun()
    store.resetState()
    expect(store.trackedRuns).toEqual([])
    expect(store.runInputs).toBeNull()
  })
})
