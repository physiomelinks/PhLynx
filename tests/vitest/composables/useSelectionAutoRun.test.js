// @vitest-environment happy-dom
import { defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const selected = ref([])
vi.mock('@vue-flow/core', async (importOriginal) => {
  const { computed } = await import('vue')
  return {
    ...(await importOriginal()),
    useVueFlow: () => ({ getSelectedNodes: computed(() => selected.value.map((id) => ({ id }))), userSelectionActive: ref(false) }),
  }
})
const run = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../../src/composables/useSimulation', () => ({ useSimulation: () => ({ run }) }))
vi.mock('../../../src/services/simulation/libopencorLoader', () => ({ libopencor: { status: 'ready' } }))
const store = vi.hoisted(() => ({ scopeMode: 'selection', scopeNodeIds: ['a'], results: {} }))
vi.mock('../../../src/stores/simulationResultsStore', () => ({ useSimulationResultsStore: () => store }))

const { useSelectionAutoRun } = await import('../../../src/composables/useSelectionAutoRun.js')

const Host = defineComponent({
  setup() {
    useSelectionAutoRun()
    return () => null
  },
})

describe('useSelectionAutoRun', () => {
  let wrapper
  beforeEach(() => {
    vi.useFakeTimers()
    run.mockClear()
    selected.value = ['a']
    Object.assign(store, { scopeMode: 'selection', scopeNodeIds: ['a'], results: {} })
    wrapper = mount(Host)
  })
  afterEach(() => {
    wrapper.unmount()
    vi.useRealTimers()
  })

  /** Selects some instances and lets the selection settle. */
  async function select(ids) {
    selected.value = ids
    await wrapper.vm.$nextTick()
    vi.advanceTimersByTime(200)
  }

  it('runs a new selection once it is chosen', async () => {
    await select(['b'])
    expect(run).toHaveBeenCalledWith(['b'])
  })

  it('leaves a sweep of a model with ODEs for play, as a time course per point is too slow to follow', async () => {
    store.results = { isSweep: true, isSteadyState: false }
    await select(['b'])
    expect(run).not.toHaveBeenCalled()

    store.results = { isSweep: true, isSteadyState: true }
    await select(['c'])
    expect(run).toHaveBeenCalledWith(['c'])
  })
})
