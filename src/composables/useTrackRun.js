/**
 * Tracking the shown run, from wherever it is offered (the simulation toolbar, the floating viewer): whether it can be
 * tracked, and tracking it with the slider values it ran with.
 */
import { computed } from 'vue'

import { describeRunInputs } from '../services/simulation/trackedRuns'
import { GLOBAL_COMPONENT } from '../services/simulation/variableIndex'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useSimulationSettingsStore } from '../stores/simulationSettingsStore'

/**
 * Gives what tracking the shown run needs.
 *
 * @returns {{liveInputs: import('vue').ComputedRef<Array<Object>>, trackBlocker: import('vue').ComputedRef<string|null>, track: Function}}
 */
export function useTrackRun() {
  const store = useSimulationResultsStore()
  const settingsStore = useSimulationSettingsStore()

  // The slider values the shown run ran with, named as the runs list shows them; a sweep set its own parameter's.
  const liveInputs = computed(() => {
    const inputs = describeRunInputs(store.runInputs?.overrides, settingsStore.parameterScanConfig?.selections, GLOBAL_COMPONENT)
    const sweep = store.results?.isSweep ? store.runInputs?.settings?.sweep : null
    if (!sweep) return inputs
    const sweptKey = sweep.type === 'global_constant' ? `global::${sweep.parameterName}` : sweep.key
    return inputs.filter((input) => input.key !== sweptKey)
  })

  // Why the shown run can't be tracked, or null when it can.
  const trackBlocker = computed(() => store.trackBlocker)

  /** Tracks the shown run, with the slider values it ran with. */
  function track() {
    store.trackRun(liveInputs.value)
  }

  return { liveInputs, trackBlocker, track }
}
