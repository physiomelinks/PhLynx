import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runs = []
vi.mock('../../../src/composables/useSimulation', async () => {
  const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore')
  return {
    useSimulation: () => ({
      run: async (nodeIds, options = {}) => {
        runs.push({ nodeIds, kinetics: options.kinetics ? Object.fromEntries(options.kinetics) : null })
        const store = useSimulationResultsStore()
        store.startRun(nodeIds)
        store.finishRun({ results: { variables: new Map(), voi: { values: [0, 1] } }, mapping: new Map(), signature: 's', inspectionOutputs: [], inputs: {} })
      },
    }),
  }
})

import { useKineticsComparison } from '../../../src/composables/useKineticsComparison'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore'

describe('useKineticsComparison', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    runs.length = 0
  })

  it('runs the other kinetics, then the instance as it is, keeping both by name', async () => {
    const { compare } = useKineticsComparison()
    expect(await compare({ nodeId: 'n', kinetics: 'full', nodeIds: ['n'] })).toBe(true)
    expect(runs).toEqual([
      { nodeIds: ['n'], kinetics: { n: 'steady' } },
      { nodeIds: ['n'], kinetics: null },
    ])
    const store = useSimulationResultsStore()
    expect(store.trackedRuns.map((run) => run.name)).toEqual(['Steady state', 'Full kinetics'])
    expect(store.isLiveRunVisible).toBe(false)
  })

  it('compares a steady-state instance with its full kinetics', async () => {
    const { compare } = useKineticsComparison()
    await compare({ nodeId: 'n', kinetics: 'steady', nodeIds: null })
    expect(runs[0].kinetics).toEqual({ n: 'full' })
    expect(useSimulationResultsStore().trackedRuns.map((run) => run.name)).toEqual(['Full kinetics', 'Steady state'])
  })
})
