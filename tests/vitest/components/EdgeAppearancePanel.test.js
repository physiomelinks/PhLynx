// @vitest-environment happy-dom
import { computed, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import ConnectionAppearanceFields from '../../../src/components/ConnectionAppearanceFields.vue'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useWorkspaceAppearanceStore } from '../../../src/stores/workspaceAppearanceStore.js'

const edges = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes: ref([]),
    edges,
    getSelectedEdges: computed(() => edges.value.filter((edge) => edge.selected)),
    findNode: () => undefined,
    findEdge: (id) => edges.value.find((edge) => edge.id === id),
    updateNodeData: () => {},
  }),
}))

const { default: EdgeAppearancePanel } = await import('../../../src/components/EdgeAppearancePanel.vue')

let wrapper, history, appearanceStore

const findEdge = (id) => edges.value.find((edge) => edge.id === id)
const fields = () => wrapper.findComponent(ConnectionAppearanceFields)

/**
 * Mounts the panel and waits for it to render.
 */
async function mountPanel() {
  wrapper = mount(EdgeAppearancePanel, { global: { plugins: [PrimeVue], directives: { tooltip: {} } } })
  await flushPromises()
}

/**
 * Sends an appearance change from the fields, as picking a value does.
 *
 * @param {Object} patch
 */
async function change(patch) {
  fields().vm.$emit('change', patch)
  await flushPromises()
}

describe('EdgeAppearancePanel', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    appearanceStore = useWorkspaceAppearanceStore()
    edges.value = [
      { id: 'e1', source: 'a', target: 'b', selected: true, data: { couplings: [] } },
      { id: 'e2', source: 'b', target: 'c', selected: true, data: { couplings: [], appearance: { width: 'thick' } } },
      { id: 'e3', source: 'c', target: 'a', selected: false, data: { couplings: [] } },
    ]
  })

  afterEach(() => wrapper?.unmount())

  it('shows the values the selection shares and marks the ones that differ', async () => {
    await mountPanel()
    expect(fields().props('mixed')).toEqual(['width'])
    expect(fields().props('appearance')).toMatchObject({ path: 'smoothstep', arrow: 'medium' })
    expect(wrapper.text()).toContain('2 selected')
  })

  it('styles every selected edge as one undo step', async () => {
    await mountPanel()
    await change({ colour: '#ef4444' })
    expect(findEdge('e1').data.appearance).toEqual({ colour: '#ef4444' })
    expect(findEdge('e2').data.appearance).toEqual({ colour: '#ef4444', width: 'thick' })
    expect(findEdge('e3').data.appearance).toBeUndefined()
    expect(history.pointerIndex).toBe(0)

    await history.undo()
    expect(findEdge('e1').data.appearance).toBeUndefined()
    expect(findEdge('e2').data.appearance).toEqual({ width: 'thick' })

    await history.redo()
    expect(findEdge('e1').data.appearance).toEqual({ colour: '#ef4444' })
  })

  it('removes a key set back to its built-in value', async () => {
    await mountPanel()
    await change({ width: 'normal' })
    expect(findEdge('e2').data).toEqual({ couplings: [] })
    expect(findEdge('e1').data).toEqual({ couplings: [] })
  })

  it('replaces edge data, so a pasted copy sharing it keeps its look', async () => {
    const shared = { couplings: [] }
    edges.value[0].data = shared
    edges.value[2].data = shared
    await mountPanel()
    await change({ arrow: 'large' })
    expect(findEdge('e1').data.appearance).toEqual({ arrow: 'large' })
    expect(findEdge('e3').data).toEqual({ couplings: [] })
    expect(shared).toEqual({ couplings: [] })
  })

  it('previews a colour without recording it, and puts the original back', async () => {
    await mountPanel()
    const before = findEdge('e2').data
    fields().vm.$emit('preview', '#3b82f6')
    expect(findEdge('e2').data.appearance).toEqual({ colour: '#3b82f6', width: 'thick' })
    fields().vm.$emit('preview-end')
    expect(findEdge('e2').data).toBe(before)
    expect(history.canUndo).toBe(false)
  })

  it('uses the selection as the default for new connections, as an undo step', async () => {
    edges.value[1].selected = false
    await mountPanel()
    await change({ path: 'bezier' })
    await wrapper.findAll('button').find((button) => button.text().includes('Use as default')).trigger('click')
    await flushPromises()
    expect(appearanceStore.connectionDefaults).toEqual({ path: 'bezier' })

    await history.undo()
    expect(appearanceStore.connectionDefaults).toEqual({})
    await history.redo()
    expect(appearanceStore.connectionDefaults).toEqual({ path: 'bezier' })
  })

  it('edits the default when nothing is selected, leaving existing edges alone', async () => {
    edges.value.forEach((edge) => (edge.selected = false))
    await mountPanel()
    expect(wrapper.find('[data-testid="edge-appearance-defaults"]').exists()).toBe(true)
    await change({ arrow: 'none' })
    expect(appearanceStore.connectionDefaults).toEqual({ arrow: 'none' })
    expect(findEdge('e1').data.appearance).toBeUndefined()

    await history.undo()
    expect(appearanceStore.connectionDefaults).toEqual({})
  })

  it('applies the default to all connections as one undo step', async () => {
    edges.value.forEach((edge) => (edge.selected = false))
    appearanceStore.setConnectionDefaults({ colour: '#22c55e' })
    await mountPanel()
    await wrapper.findAll('button').find((button) => button.text().includes('Apply to all')).trigger('click')
    await flushPromises()
    expect(edges.value.map((edge) => edge.data.appearance)).toEqual([
      { colour: '#22c55e' },
      { colour: '#22c55e' },
      { colour: '#22c55e' },
    ])
    expect(history.pointerIndex).toBe(0)

    await history.undo()
    expect(edges.value.map((edge) => edge.data.appearance)).toEqual([undefined, { width: 'thick' }, undefined])
  })
})
