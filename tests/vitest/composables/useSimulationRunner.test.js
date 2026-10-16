// @vitest-environment happy-dom
import { defineComponent, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nodes = ref([])
const selected = ref([])
vi.mock('@vue-flow/core', async (importOriginal) => {
  const { computed } = await import('vue')
  return {
    ...(await importOriginal()),
    useVueFlow: () => ({ nodes, getSelectedNodes: computed(() => selected.value.map((id) => ({ id }))) }),
  }
})
const run = vi.hoisted(() => vi.fn(async () => {}))
vi.mock('../../../src/composables/useSimulation', async () => {
  const { ref } = await import('vue')
  return { useSimulation: () => ({ run, stop: vi.fn(), keepCurrent: vi.fn(), isStale: ref(false) }) }
})
vi.mock('../../../src/services/simulation/libopencorLoader', () => ({ libopencor: { status: 'ready' } }))

const { useSimulationRunner } = await import('../../../src/composables/useSimulationRunner.js')

/**
 * Runs the composable in a component.
 *
 * @param {Object} [options]
 * @returns {Object} What it returned.
 */
function setUpRunner(options) {
  let runner
  mount(
    defineComponent({
      setup() {
        runner = useSimulationRunner(options)
        return () => null
      },
    })
  )
  return runner
}

describe('useSimulationRunner', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    run.mockClear()
    nodes.value = [{ id: 'b' }, { id: 'a' }]
    selected.value = []
  })

  it('says why play can’t run the selection until there is one, then runs it sorted', () => {
    const runner = setUpRunner()
    runner.store.scopeMode = 'selection'
    expect(runner.blockedReason.value).toBe('Select instances on the canvas')
    selected.value = ['b', 'a']
    expect(runner.canPlay.value).toBe(true)
    runner.play()
    expect(run).toHaveBeenCalledWith(['a', 'b'])
  })

  it('runs the whole model at once when switched to it', () => {
    const runner = setUpRunner()
    runner.store.scopeMode = 'selection'
    runner.scopeMode.value = 'model'
    expect(run).toHaveBeenCalledWith(null)
  })

  it('runs only the whole model where there is no canvas to select from, the sidebar’s choice left as it is', () => {
    const runner = setUpRunner({ isWholeModelOnly: true })
    runner.store.scopeMode = 'selection'
    expect(runner.scopeMode.value).toBe('model')
    expect(runner.blockedReason.value).toBeNull()
    runner.scopeMode.value = 'selection'
    expect(run).not.toHaveBeenCalled()
    expect(runner.store.scopeMode).toBe('selection')
    runner.play()
    expect(run).toHaveBeenCalledWith(null)
  })

  it('says a selection’s results, from the sidebar, are another run where only the whole model runs', () => {
    const runner = setUpRunner({ isWholeModelOnly: true })
    runner.store.results = { voi: { values: [0], unit: 's' } }
    runner.store.scopeNodeIds = ['a']
    expect(runner.isOutdated.value).toBe(true)
    expect(runner.statusLine.value.text).toBe('These results are from another run · press play to update')
    runner.store.scopeNodeIds = null
    expect(runner.isOutdated.value).toBe(false)
  })

  it('counts warnings in the results’ status, but not notes, which only pass along', () => {
    const runner = setUpRunner()
    runner.store.status = 'done'
    runner.store.results = { voi: { values: [0], unit: 's' } }
    runner.store.report = { errors: [], warnings: [], notes: ['"a.u" uses its own value.'] }
    expect(runner.statusLine.value).toMatchObject({ severity: 'info', icon: null, details: [], notes: ['"a.u" uses its own value.'] })
    expect(runner.statusLine.value.text).not.toMatch(/warning/)

    runner.store.report = { errors: [], warnings: ['"a.w" is set to 0.'], notes: ['"a.u" uses its own value.'] }
    expect(runner.statusLine.value).toMatchObject({ severity: 'warn', icon: 'pi-exclamation-triangle', notes: ['"a.u" uses its own value.'] })
    expect(runner.statusLine.value.text).toMatch(/1 warning\.$/)
    expect(runner.statusLine.value.details).toEqual([{ title: 'Warnings', lines: ['"a.w" is set to 0.'] }])
  })

  it('runs the whole model from an instance editor, or its instance on its own when switched to it', () => {
    const runner = setUpRunner({ instanceId: 'b' })
    expect(runner.blockedReason.value).toBeNull()
    expect(runner.statusLine.value.text).toBe('Press play to simulate the whole model or this instance.')
    runner.play()
    expect(run).toHaveBeenCalledWith(null)

    runner.scopeMode.value = 'selection'
    expect(run).toHaveBeenLastCalledWith(['b'])
  })

  it('says what play runs, as the switch says, before it runs', () => {
    const editor = setUpRunner({ instanceId: 'b' })
    expect(editor.playScopeNodeIds.value).toBeNull()
    editor.scopeMode.value = 'selection'
    expect(editor.playScopeNodeIds.value).toEqual(['b'])

    const sidebar = setUpRunner()
    expect(sidebar.playScopeNodeIds.value).toBeNull()
    sidebar.store.scopeMode = 'selection'
    selected.value = ['b', 'a']
    expect(sidebar.playScopeNodeIds.value).toEqual(['a', 'b'])
  })
})
