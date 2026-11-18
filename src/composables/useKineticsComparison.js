/**
 * Compares an instance's full kinetics with its steady state on the plots: runs it once in the other kinetics and once
 * as it is, keeping both as named tracked runs, so the charts show where they differ.
 */
import { ref } from 'vue'

import { STEADY_STATE_KINETICS } from '../services/steadyState/steadyStateLibrary'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { notify } from '../utils/notify'
import { useSimulation } from './useSimulation'

const LABELS = { full: 'Full kinetics', [STEADY_STATE_KINETICS]: 'Steady state' }

export function useKineticsComparison() {
  const store = useSimulationResultsStore()
  const { run } = useSimulation()
  const isComparing = ref(false)

  /** Keeps the shown run under `name`, or says why it can't. */
  function keep(name) {
    const tracked = store.trackRun()
    if (!tracked) {
      notify.error({ message: store.trackBlocker ?? 'The run couldn’t be kept for the comparison.' })
      return false
    }
    store.renameTrackedRun(tracked.id, name)
    return true
  }

  /**
   * Runs the instance in the other kinetics, then as it is, keeping both runs.
   *
   * @param {Object} options
   * @param {string} options.nodeId - The instance compared.
   * @param {string} options.kinetics - Its own kinetics: 'full' or STEADY_STATE_KINETICS.
   * @param {string[]|null} options.nodeIds - What the runs simulate: the instance alone, or null for the whole model.
   * @returns {Promise<boolean>} Whether both runs finished and were kept.
   */
  async function compare({ nodeId, kinetics, nodeIds }) {
    if (isComparing.value) return false
    isComparing.value = true
    const other = kinetics === STEADY_STATE_KINETICS ? 'full' : STEADY_STATE_KINETICS
    try {
      // The other kinetics first, so the live run, last, is the instance as it is and stays current
      await run(nodeIds, { kinetics: new Map([[nodeId, other]]) })
      if (store.status !== 'done' || !keep(LABELS[other])) return false
      await run(nodeIds)
      if (store.status !== 'done' || !keep(LABELS[kinetics])) return false
      // The live run is the second one kept, so only the two named runs show
      store.isLiveRunVisible = false
      return true
    } finally {
      isComparing.value = false
    }
  }

  return { compare, isComparing }
}
