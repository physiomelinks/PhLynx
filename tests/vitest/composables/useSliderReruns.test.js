import { beforeEach, describe, expect, it, vi } from 'vitest'

// A stand-in useSimulation: each run waits for the test to finish it, and takes a new token as it starts.
const simulation = vi.hoisted(() => ({ runs: [], token: 0, isKept: false }))
vi.mock('../../../src/composables/useSimulation', () => ({
  useSimulation: () => ({
    run: vi.fn((scope) => {
      simulation.token++
      let finish
      const promise = new Promise((resolve) => (finish = resolve))
      simulation.runs.push({ scope, finish })
      return promise
    }),
  }),
  getRunToken: () => simulation.token,
  isRerunningKeptModel: () => simulation.isKept,
}))
vi.mock('../../../src/services/simulation/libopencorLoader', () => ({ libopencor: { status: 'ready' } }))
const store = vi.hoisted(() => ({ results: {}, scopeNodeIds: ['a'], status: 'done' }))
vi.mock('../../../src/stores/simulationResultsStore', () => ({ useSimulationResultsStore: () => store }))
const protocolStore = vi.hoisted(() => ({ areSlidersOff: false }))
vi.mock('../../../src/stores/protocolStore', () => ({ useProtocolStore: () => protocolStore }))

const { resetSliderReruns, useSliderReruns } = await import('../../../src/composables/useSliderReruns.js')

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useSliderReruns', () => {
  beforeEach(() => {
    resetSliderReruns()
    Object.assign(simulation, { runs: [], token: 0, isKept: false })
    Object.assign(store, { results: {}, status: 'done' })
    protocolStore.areSlidersOff = false
    vi.useRealTimers()
  })

  it('runs one at a time, then the newest waiting values once, after the run finishes', async () => {
    const { rerunForSliders } = useSliderReruns()
    rerunForSliders()
    rerunForSliders()
    rerunForSliders()
    expect(simulation.runs).toHaveLength(1)

    simulation.runs[0].finish()
    await settle()
    expect(simulation.runs).toHaveLength(2)
    simulation.runs[1].finish()
    await settle()
    expect(simulation.runs).toHaveLength(2)
  })

  it('does nothing before any run, and stops after a run play or Stop cut short', async () => {
    const { rerunForSliders } = useSliderReruns()
    store.results = null
    rerunForSliders()
    expect(simulation.runs).toHaveLength(0)

    store.results = {}
    rerunForSliders()
    rerunForSliders()
    // Play starts its own run, taking a newer token.
    simulation.token++
    simulation.runs[0].finish()
    await settle()
    expect(simulation.runs).toHaveLength(1)
  })

  it('lets a slow rerun of the kept model give way, but not a run reading a new model', async () => {
    vi.useFakeTimers({ toFake: ['performance'] })
    const { rerunForSliders } = useSliderReruns()
    rerunForSliders()
    vi.advanceTimersByTime(1000)
    rerunForSliders()
    expect(simulation.runs).toHaveLength(1)

    simulation.isKept = true
    rerunForSliders()
    expect(simulation.runs).toHaveLength(2)
    // The superseded run finishing doesn't start another.
    simulation.runs[0].finish()
    await Promise.resolve()
    expect(simulation.runs).toHaveLength(2)
  })

  it('does nothing while the sliders are off, dropping values that waited from before', async () => {
    const { rerunForSliders } = useSliderReruns()
    rerunForSliders()
    rerunForSliders()
    protocolStore.areSlidersOff = true
    rerunForSliders()
    expect(simulation.runs).toHaveLength(1)

    // Back in the time course, the run finishing doesn't start one for the dropped values.
    protocolStore.areSlidersOff = false
    simulation.runs[0].finish()
    await settle()
    expect(simulation.runs).toHaveLength(1)
  })
})
