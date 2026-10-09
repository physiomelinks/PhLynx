/**
 * Reruns the shown scope as sliders move, from wherever they are (the Simulation tab, the results dialog, the
 * floating viewer), as often as the simulator keeps up and always with the latest values: one run at a time,
 * and only the newest values wait. A rerun of the kept model taking far longer than usual, as some values
 * make a model hard to solve, gives way to the newest values rather than holding the slider up.
 */
import { libopencor } from '../services/simulation/libopencorLoader'
import { useProtocolStore } from '../stores/protocolStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { getRunToken, isRerunningKeptModel, useSimulation } from './useSimulation'

const SLOW_RUN_MIN_MS = 150
const SLOW_RUN_FACTOR = 3
let sliderRun = null
let sliderRunStartedAt = 0
let isSliderRerunWaiting = false
const recentRunMs = []

/**
 * Reruns the scope with the slider values, or queues the newest values behind the run going. Nothing reruns while
 * the sliders are off, as their values don't reach the protocol's runs.
 *
 * @param {Object} store - simulationResultsStore.
 * @param {Function} run - useSimulation's run.
 * @param {Object} protocolStore
 */
function rerunForSliders(store, run, protocolStore) {
  if (protocolStore.areSlidersOff) {
    isSliderRerunWaiting = false
    return
  }
  // Before any run there is no scope to rerun: the next play uses the slider values.
  if (['unavailable', 'error'].includes(libopencor.status) || !store.results) return
  if (!sliderRun) {
    startSliderRun(store, run, protocolStore)
    return
  }
  isSliderRerunWaiting = true
  // Only a rerun of the kept model gives way: a run reading a new model would just have to start again.
  if (!isRerunningKeptModel()) return
  const typical = [...recentRunMs].sort((a, b) => a - b)[Math.floor(recentRunMs.length / 2)] ?? SLOW_RUN_MIN_MS
  // run() stops the run going and ignores its results.
  if (performance.now() - sliderRunStartedAt > Math.max(SLOW_RUN_MIN_MS, typical * SLOW_RUN_FACTOR)) startSliderRun(store, run, protocolStore)
}

/**
 * Starts a rerun, then the newest waiting values once it is done.
 *
 * @param {Object} store
 * @param {Function} run
 * @param {Object} protocolStore
 */
function startSliderRun(store, run, protocolStore) {
  isSliderRerunWaiting = false
  const startedAt = performance.now()
  sliderRunStartedAt = startedAt
  const thisRun = run(store.scopeNodeIds)
  // run() takes its token as it starts, so this is the token of this run.
  const token = getRunToken()
  sliderRun = thisRun
  thisRun.finally(() => {
    // Superseded by a newer slider run, which carries on.
    if (sliderRun !== thisRun) return
    sliderRun = null
    // Cut short by play, Stop or a cleared workspace: what the user did stands, so nothing more runs.
    if (token !== getRunToken() || store.status === 'stopped') {
      isSliderRerunWaiting = false
      return
    }
    recentRunMs.push(performance.now() - startedAt)
    if (recentRunMs.length > 5) recentRunMs.shift()
    if (isSliderRerunWaiting) {
      isSliderRerunWaiting = false
      rerunForSliders(store, run, protocolStore)
    }
  })
}

/** Forgets the queue, for a workspace cleared or replaced. */
export function resetSliderReruns() {
  sliderRun = null
  isSliderRerunWaiting = false
  recentRunMs.length = 0
}

/**
 * Gives the shared slider rerun queue.
 *
 * @returns {{rerunForSliders: Function}}
 */
export function useSliderReruns() {
  const store = useSimulationResultsStore()
  const protocolStore = useProtocolStore()
  const { run } = useSimulation()
  return { rerunForSliders: () => rerunForSliders(store, run, protocolStore) }
}
