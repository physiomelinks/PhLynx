// @vitest-environment happy-dom
import { computed, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useColorScheme } from '../../../src/composables/useColorScheme.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useNodeThemeStore } from '../../../src/stores/nodeThemeStore.js'

const nodes = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges: ref([]),
    getSelectedNodes: computed(() => nodes.value.filter((node) => node.selected)),
    findNode: (id) => nodes.value.find((node) => node.id === id),
    findEdge: () => undefined,
    updateNodeData: (id, update, options = { replace: false }) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (!node) return
      const patch = typeof update === 'function' ? update(node) : update
      node.data = options.replace ? patch : { ...node.data, ...patch }
    },
  }),
}))

const { default: NodeColourPanel } = await import('../../../src/components/NodeColourPanel.vue')

const sharedIndex = {
  schemaVersion: 1,
  themes: [
    {
      schemaVersion: 1,
      id: 'domain-types',
      name: 'Domain types',
      categories: [
        { key: 'membrane', label: 'Membrane', color: '#ffe2ec' },
        { key: 'protein', label: 'Protein', color: '#d1fff0' },
      ],
    },
  ],
}

let wrapper

async function mountPanel() {
  wrapper = mount(NodeColourPanel, {
    global: { plugins: [PrimeVue, ConfirmationService], directives: { tooltip: {}, hint: {} } },
  })
  await flushPromises()
}

const swatch = (label) => wrapper.findAll('button.swatch').find((button) => button.text() === label)

describe('NodeColourPanel', () => {
  beforeEach(async () => {
    window.localStorage.clear()
    setActivePinia(createPinia())
    const store = useNodeThemeStore()
    await store.refreshRemote({ fetchImpl: async () => ({ ok: true, json: async () => sharedIndex }) })
    store.setActiveTheme('domain-types')
    nodes.value = [
      reactive({ id: 'a', selected: true, data: { name: 'a' } }),
      reactive({ id: 'b', selected: true, data: { name: 'b', domainType: 'protein' } }),
      reactive({ id: 'c', selected: false, data: { name: 'c', domainType: 'membrane' } }),
    ]
  })

  afterEach(() => wrapper?.unmount())

  it('lists the active theme’s categories plus None', async () => {
    await mountPanel()
    expect(wrapper.findAll('button.swatch').map((b) => b.text())).toEqual(['Membrane', 'Protein', 'None'])
  })

  it('colours every selected node as one undo step, and undo clears a category that was never set', async () => {
    await mountPanel()
    await swatch('Membrane').trigger('click')
    await flushPromises()
    expect(nodes.value.map((n) => n.data.domainType)).toEqual(['membrane', 'membrane', 'membrane'])

    await useFlowHistoryStore().undo()
    await flushPromises()
    expect(nodes.value.map((n) => n.data.domainType ?? null)).toEqual([null, 'protein', 'membrane'])
  })

  it('greys the swatches with nothing selected, and a click then changes nothing', async () => {
    nodes.value.forEach((node) => (node.selected = false))
    await mountPanel()
    expect(swatch('Membrane').attributes('aria-disabled')).toBe('true')
    await swatch('Membrane').trigger('click')
    expect(nodes.value.map((n) => n.data.domainType ?? null)).toEqual([null, 'protein', 'membrane'])
  })

  it('adds no undo step when the selection has the category already', async () => {
    await mountPanel()
    const history = useFlowHistoryStore()
    await swatch('Membrane').trigger('click')
    const steps = history.pointerIndex
    await swatch('Membrane').trigger('click')
    expect(steps).toBe(0)
    expect(history.pointerIndex).toBe(steps)
  })

  describe('double-clicking a swatch', () => {
    /** The editor's colour chips that are open, by title. */
    const openChips = () =>
      wrapper.findAll('.theme-editor button.colour-chip[aria-expanded="true"]').map((b) => b.attributes('aria-label'))

    afterEach(() => useColorScheme().setDarkMode(false))

    it('opens an unsaved copy of a theme the user cannot edit, on that category’s light colour', async () => {
      nodes.value.forEach((node) => (node.selected = false))
      await mountPanel()
      await swatch('Protein').trigger('dblclick')
      await flushPromises()

      expect(wrapper.find('.theme-editor').text()).toContain('New theme')
      expect(useNodeThemeStore().localThemes).toHaveLength(0)
      expect(openChips()).toEqual(['Protein colour, #d1fff0'])
    })

    it('edits the user’s own theme in place, on the colour for dark mode when it is on', async () => {
      useColorScheme().setDarkMode(true)
      useNodeThemeStore().createLocalTheme('domain-types', 'Mine')
      await mountPanel()
      await swatch('Membrane').trigger('dblclick')
      await flushPromises()

      expect(wrapper.find('.theme-editor').text()).toContain('Editing theme')
      expect(openChips()).toEqual(['Membrane dark mode colour, automatic'])
    })
  })

  it('notes a category the active theme does not define', async () => {
    nodes.value = [reactive({ id: 'x', selected: true, data: { domainType: 'transporter' } })]
    await mountPanel()
    expect(wrapper.text()).toContain('“transporter” is not in the Domain types theme')
  })

  it('offers submission only for themes made locally', async () => {
    await mountPanel()
    expect(wrapper.text()).not.toContain('Propose for everyone')
    useNodeThemeStore().createLocalTheme('domain-types', 'Mine')
    await flushPromises()
    wrapper.vm.stopEditing()
    await flushPromises()
    expect(wrapper.text()).toContain('Propose for everyone')
  })

  it('opens the editor on a fresh copy, and saving updates the theme', async () => {
    await mountPanel()
    await wrapper.findAll('button').find((b) => b.text() === 'New from this theme').trigger('click')
    await flushPromises()
    const editor = wrapper.find('.theme-editor')
    expect(editor.exists()).toBe(true)

    await editor.find('input[id$="-name"]').setValue('Warm domains')
    await editor.findAll('button').find((b) => b.text() === 'Save').trigger('click')
    await flushPromises()

    const store = useNodeThemeStore()
    expect(store.activeTheme.name).toBe('Warm domains')
    expect(store.activeTheme.derivedFrom).toBe('domain-types')
    expect(wrapper.find('.theme-editor').exists()).toBe(false)
  })
  it('keeps a new theme only on Save, so Cancel leaves nothing behind', async () => {
    const store = useNodeThemeStore()
    await mountPanel()
    await wrapper.findAll('button').find((b) => b.text() === 'New from this theme').trigger('click')
    await flushPromises()
    expect(store.localThemes).toHaveLength(0)

    await wrapper.find('.theme-editor').findAll('button').find((b) => b.text() === 'Cancel').trigger('click')
    await flushPromises()
    expect(store.localThemes).toHaveLength(0)
    expect(store.activeThemeId).toBe('domain-types')
  })

  it('previews edits on the canvas and puts the theme back on Cancel', async () => {
    const store = useNodeThemeStore()
    store.createLocalTheme('domain-types', 'Mine')
    await mountPanel()
    await wrapper.findAll('button').find((b) => b.text() === 'Edit').trigger('click')
    await flushPromises()

    await wrapper.find('input[id$="-name"]').setValue('Mine, edited')
    await flushPromises()
    expect(store.activeTheme.name).toBe('Mine, edited')
    expect(wrapper.find('.theme-editor').text()).toContain('Unsaved')

    await wrapper.find('.theme-editor').findAll('button').find((b) => b.text() === 'Cancel').trigger('click')
    await flushPromises()
    expect(store.previewTheme).toBeNull()
    expect(store.activeTheme.name).toBe('Mine')
  })

  it('hides the theme picker and swatches while editing', async () => {
    await mountPanel()
    await wrapper.findAll('button').find((b) => b.text() === 'New from this theme').trigger('click')
    await flushPromises()
    expect(wrapper.findAll('button.swatch')).toHaveLength(0)
  })
})
