// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const confirm = vi.hoisted(() => vi.fn())
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm }) }))

const { default: LibraryArea } = await import('../../../src/components/LibraryArea.vue')
const { default: useDragAndDrop } = await import('../../../src/composables/useDnD.js')
const { useCanvasLevel } = await import('../../../src/composables/useCanvasLevel.js')
const { useFlowHistory } = await import('../../../src/composables/useFlowHistory.js')
const { useSupermoduleEditGuard } = await import('../../../src/composables/useSupermoduleEditGuard.js')
const { supermoduleContentHash } = await import('../../../src/services/hierarchy/operations.js')
const { createHistory, useFlowHistoryStore } = await import('../../../src/stores/historyStore.js')
const { FLOW_IDS } = await import('../../../src/utils/constants.js')
const { module, superInstance, supermodule } = await import('../fixtures/hierarchy/graph.js')

/** Root: two super instances of heart (sm_1), which holds lv, a super instance of chamber (sm_2). */
function graph() {
  const chamber = supermodule('sm_2', 'chamber')
  const wall = module('dndnode_0', 'wall', { scope: 'sm_2' })
  const lv = superInstance([chamber, wall], 'dndnode_0', 'lv', 'sm_2', { scope: 'sm_1' })
  const heart = supermodule('sm_1', 'heart', { ca: { module_type: 'heart', module_subtype: 'Argus2026_v01' } })
  const inner = [heart, lv, chamber, wall]
  return { nodes: [superInstance(inner, 'dndnode_1', 'left', 'sm_1'), superInstance(inner, 'dndnode_2', 'right', 'sm_1'), ...inner], edges: [] }
}

describe('LibraryArea super-modules', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let wrapper

  const mountLibrary = (props = { showSupermodules: true }) => {
    wrapper = mount(LibraryArea, { props, global: { plugins: [PrimeVue] } })
  }
  const cards = () => wrapper.findAll('.mlc__card--supermodule:not(.mlc__card--empty-supermodule)')
  const card = (smId) => wrapper.find(`[data-supermodule="${smId}"]`)

  beforeEach(async () => {
    setActivePinia(createPinia())
    level.reset()
    await flow.fromObject(level.withVisibility(graph()))
  })
  afterEach(() => wrapper?.unmount())

  it('lists the workspace’s super-modules with how many super instances each has', () => {
    mountLibrary()
    expect(wrapper.find('.mlc__group--supermodules .mlc__group-name').text()).toBe('Super-modules')
    expect(cards().map((entry) => entry.find('.mlc__card-name').text())).toEqual(['heart', 'chamber'])
    expect(card('sm_1').find('.mlc__badge').text()).toBe('2 super instances')
    expect(card('sm_1').find('.mlc__supermodule-label').text()).toBe('heart:Argus2026_v01')
    expect(card('sm_2').find('.mlc__badge').text()).toBe('1 super instance')
  })

  it('lists none outside the workspace’s palette', () => {
    mountLibrary({})
    expect(cards()).toHaveLength(0)
    wrapper.unmount()
    mountLibrary({ showSupermodules: true, selectable: true })
    expect(cards()).toHaveLength(0)
  })

  it('edits a super-module on its own', async () => {
    mountLibrary()
    await card('sm_2').find('button').trigger('click')
    expect(level.isEditingSupermodule.value).toBe(true)
    expect(level.scope.value).toBe('sm_2')
  })

  it('drags a super-module to place another super instance of it', async () => {
    mountLibrary()
    const data = new Map()
    const dataTransfer = { setData: (type, value) => data.set(type, value), effectAllowed: '' }
    await card('sm_1').trigger('dragstart', { dataTransfer })
    expect(data.get('application/vueflow')).toBe('sm_1')
    expect(card('sm_1').attributes('draggable')).toBe('true')
  })

  it('greys out a super-module that would contain itself here', async () => {
    mountLibrary()
    level.enter('dndnode_1')
    await nextTick()
    expect(card('sm_1').classes()).toContain('mlc__card--blocked')
    expect(card('sm_1').attributes('draggable')).toBe('false')
    expect(card('sm_2').classes()).not.toContain('mlc__card--blocked')

    // heart holds chamber, so inside chamber neither can go.
    level.editSupermodule('sm_2')
    await nextTick()
    expect(card('sm_1').classes()).toContain('mlc__card--blocked')
    expect(card('sm_2').classes()).toContain('mlc__card--blocked')

    const data = new Map()
    await card('sm_1').trigger('dragstart', { dataTransfer: { setData: (type, value) => data.set(type, value) } })
    expect(data.size).toBe(0)
  })

  it('filters by the search text', async () => {
    mountLibrary()
    await wrapper.find('.mlc__search input').setValue('argus')
    expect(cards().map((entry) => entry.attributes('data-supermodule'))).toEqual(['sm_1'])
  })

  describe('the Empty super-module entry', () => {
    const entry = () => wrapper.find('[data-empty-supermodule]')

    it('comes first in the group, and drags a new, empty super-module', async () => {
      mountLibrary()
      const group = wrapper.findAll('.mlc__group--supermodules .mlc__card')
      expect(group[0].element).toBe(entry().element)
      expect(entry().find('.mlc__card-name').text()).toBe('Empty super-module')
      expect(entry().attributes('draggable')).toBe('true')

      const data = new Map()
      await entry().trigger('dragstart', { dataTransfer: { setData: (type, value) => data.set(type, value), effectAllowed: '' } })
      expect(data.get('application/vueflow')).toBe('empty-supermodule')
      expect(useDragAndDrop().draggedType.value).toEqual({ emptySupermodule: true })
      useDragAndDrop().draggedType.value = null
    })

    it('shows with no super-modules yet, but not outside the workspace’s palette or past the filter', async () => {
      await flow.fromObject({ nodes: [], edges: [] })
      mountLibrary()
      expect(entry().exists()).toBe(true)
      await wrapper.find('.mlc__search input').setValue('heart')
      expect(entry().exists()).toBe(false)
      await wrapper.find('.mlc__search input').setValue('empty')
      expect(entry().exists()).toBe(true)
      wrapper.unmount()
      mountLibrary({ showSupermodules: true, selectable: true })
      expect(entry().exists()).toBe(false)
    })
  })

  describe('deleting a super-module', () => {
    let history, listeners
    const deleteButton = (smId) => card(smId).find(`[aria-label^="Delete super-module"]`)
    const ids = () => flow.nodes.value.map((node) => node.id).sort()

    beforeEach(async () => {
      // valve (sm_3), which no super instance uses, holds a module.
      await flow.fromObject(level.withVisibility({ nodes: [...graph().nodes, supermodule('sm_3', 'valve'), module('dndnode_0', 'leaflet', { scope: 'sm_3' })], edges: [] }))
      history = useFlowHistoryStore()
      flow.applyDefault.value = false
      const { onNodeChange, onEdgeChange } = useFlowHistory({
        suppressedEdgeIds: new Set(),
        indexAddEdge: vi.fn(),
        indexRemoveEdge: vi.fn(),
        updateHelperLines: vi.fn(),
        revertHandlesForEdge: vi.fn(),
        reactivateEdgeHandles: vi.fn(),
      })
      listeners = [flow.onNodesChange(onNodeChange), flow.onEdgesChange(onEdgeChange)]
      confirm.mockReset()
    })
    afterEach(() => {
      listeners.forEach((listener) => listener.off())
      flow.applyDefault.value = true
    })

    it('asks, saying what it holds, then deletes it and what it holds as one undo step', async () => {
      const before = ids()
      confirm.mockResolvedValue(true)
      mountLibrary()
      await deleteButton('sm_3').trigger('click')
      await vi.waitFor(() => expect(flow.findNode('sm_3')).toBeUndefined())
      expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('1 module and 0 super instances') }))
      expect(flow.findNode('sm_3~dndnode_0')).toBeUndefined()
      expect(history.pointerIndex).toBe(0)

      await history.undo()
      expect(ids()).toEqual(before)
      expect(history.canUndo).toBe(false)
    })

    it('keeps it when told no', async () => {
      confirm.mockResolvedValue(false)
      mountLibrary()
      await deleteButton('sm_3').trigger('click')
      await vi.waitFor(() => expect(confirm).toHaveBeenCalled())
      expect(flow.findNode('sm_3')).toBeDefined()
    })

    it('can’t while a super instance uses it, or while the canvas shows it', async () => {
      mountLibrary()
      expect(deleteButton('sm_1').attributes('disabled')).toBeDefined()
      expect(deleteButton('sm_3').attributes('disabled')).toBeUndefined()
      level.editSupermodule('sm_3')
      await nextTick()
      expect(deleteButton('sm_3').attributes('disabled')).toBeDefined()
      // The tooltip is on a span around the button, as a disabled button shows none.
      expect(deleteButton('sm_3').element.parentElement.classList).toContain('mlc__delete-supermodule')
    })
  })

  describe('what edits did to a library entry', () => {
    it('marks a super-module modified once a structural edit to it is a step, not one made by it', async () => {
      const history = createHistory()
      useSupermoduleEditGuard().install(history)
      mountLibrary()
      expect(wrapper.find('.mlc__modified').exists()).toBe(false)

      // A new super-module made with what it holds isn't modified; one an edit changes is.
      await history.executeAndAddCommand({ type: 'add', scopes: ['sm_3'], created: ['sm_3'], redo: () => {}, undo: () => {} })
      await history.executeAndAddCommand({ type: 'add', scopes: ['sm_2'], redo: () => {}, undo: () => {} })
      await nextTick()
      expect(card('sm_2').find('.mlc__modified').text()).toBe('modified')
      expect(card('sm_1').find('.mlc__modified').exists()).toBe(false)

      history.clear()
      await nextTick()
      expect(wrapper.find('.mlc__modified').exists()).toBe(false)
    })

    it('says when a super-module made from a template no longer matches it', async () => {
      const source = { format: 'circulatory_autogen', moduleRef: 'heart:Argus2026_v01', hash: 'feedbeef' }
      const nodes = flow.nodes.value
      source.contentHash = supermoduleContentHash('sm_1', nodes, flow.edges.value)
      flow.updateNodeData('sm_1', { supermodule: { ...flow.findNode('sm_1').data.supermodule, source } })
      mountLibrary()
      // A rename doesn't count; what it holds does.
      flow.updateNodeData('sm_1', { supermodule: { ...flow.findNode('sm_1').data.supermodule, name: 'pump' } })
      await nextTick()
      expect(card('sm_1').find('.mlc__template-drift').exists()).toBe(false)

      flow.removeNodes(['sm_1~dndnode_0'])
      await nextTick()
      expect(card('sm_1').find('.mlc__template-drift').text()).toBe('no longer matches template heart:Argus2026_v01')
    })
  })
})
