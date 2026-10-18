// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import LibraryArea from '../../../src/components/LibraryArea.vue'
import useDragAndDrop from '../../../src/composables/useDnD.js'
import { useCanvasLevel } from '../../../src/composables/useCanvasLevel.js'
import { useSupermoduleEditGuard } from '../../../src/composables/useSupermoduleEditGuard.js'
import { supermoduleContentHash } from '../../../src/services/hierarchy/operations.js'
import { createHistory } from '../../../src/stores/historyStore.js'
import { FLOW_IDS } from '../../../src/utils/constants.js'
import { module, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'

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
  // Types into the search box and waits out its debounce, as every list filters on it.
  const search = async (text) => {
    await wrapper.find('.mlc__search input').setValue(text)
    vi.advanceTimersByTime(150)
    await nextTick()
  }

  beforeEach(async () => {
    setActivePinia(createPinia())
    level.reset()
    await flow.fromObject(level.withVisibility(graph()))
  })
  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
  })

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

  it('filters by the search text, once typing stops, as the module collections do', async () => {
    vi.useFakeTimers()
    mountLibrary()
    await wrapper.find('.mlc__search input').setValue('argus')
    expect(cards()).toHaveLength(2)
    vi.advanceTimersByTime(150)
    await nextTick()
    expect(cards().map((entry) => entry.attributes('data-supermodule'))).toEqual(['sm_1'])
  })

  it('says nothing matches only when no super-module, Empty super-module or module does', async () => {
    vi.useFakeTimers()
    mountLibrary()
    await search('heart')
    expect(wrapper.find('.mlc__empty').exists()).toBe(false)
    await search('empty')
    expect(wrapper.find('.mlc__empty').exists()).toBe(false)
    await search('zzz')
    expect(wrapper.find('.mlc__empty-text').text()).toBe("No modules match 'zzz'")
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
      vi.useFakeTimers()
      await flow.fromObject({ nodes: [], edges: [] })
      mountLibrary()
      expect(entry().exists()).toBe(true)
      await search('heart')
      expect(entry().exists()).toBe(false)
      await search('empty')
      expect(entry().exists()).toBe(true)
      wrapper.unmount()
      mountLibrary({ showSupermodules: true, selectable: true })
      expect(entry().exists()).toBe(false)
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
