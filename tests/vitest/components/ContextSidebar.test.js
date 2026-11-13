// @vitest-environment happy-dom
import { computed, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'

const nodes = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges: ref([]),
    getSelectedNodes: computed(() => nodes.value),
    userSelectionActive: ref(false),
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

const { default: ContextSidebar } = await import('../../../src/components/ContextSidebar.vue')

let wrapper
afterEach(() => wrapper?.unmount())

/** Waits for the sidebar's deferred row rebuild, which lands after the next paint. */
async function waitForRows() {
  await flushPromises()
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  await flushPromises()
}

/** Mounts the sidebar on the Params tab and waits for its rows. */
async function mountOnParams() {
  wrapper = mount(ContextSidebar, { global: { plugins: [PrimeVue], stubs: { DataTable: { render: () => null }, NodeColourPanel: true }, directives: { tooltip: {}, hint: {} } } })
  wrapper.vm.isCollapsed = false
  wrapper.vm.activeTabId = 'params'
  await waitForRows()
}

const findRow = (name) => wrapper.vm.parameterRows.find((row) => row.name === name)

/** Commits a value typed into a row's input. */
async function editRow(name, value) {
  const row = findRow(name)
  row.value = value
  wrapper.vm.handleParameterValueChange(row)
  await flushPromises()
}

describe('ContextSidebar instance parameters', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    nodes.value = [
      reactive({
        id: 'a',
        data: {
          name: 'a',
          variables: [
            { name: 'k', value: '1', type: 'constant' },
            { name: 'm', value: '5', type: 'constant' },
          ],
        },
      }),
    ]
  })

  it('shows undone values, so the next edit doesn’t write the old ones back', async () => {
    await mountOnParams()

    await editRow('k', '2')
    expect(nodes.value[0].data.variables[0].value).toBe('2')

    await useFlowHistoryStore().undo()
    await flushPromises()
    expect(findRow('k').value).toBe('1')

    await editRow('m', '6')
    expect(nodes.value[0].data.variables.map((row) => row.value)).toEqual(['1', '6'])
  })

  it('shows an instance editor save, so the next edit doesn’t write the old values back (#608)', async () => {
    await mountOnParams()

    // The editor saves through updateNodeData, which swaps in a new data object on the same node.
    const variables = [
      { name: 'k', value: '2', type: 'constant' },
      { name: 'm', value: '5', type: 'constant' },
    ]
    nodes.value[0].data = { ...nodes.value[0].data, variables }
    await flushPromises()
    expect(findRow('k').value).toBe('2')

    await editRow('m', '6')
    expect(nodes.value[0].data.variables.map((row) => row.value)).toEqual(['2', '6'])
  })

  it('writes only the edited row', async () => {
    await mountOnParams()

    findRow('k').value = '99'
    await editRow('m', '6')
    expect(nodes.value[0].data.variables.map((row) => row.value)).toEqual(['1', '6'])
  })
})

describe('ContextSidebar global constant parameters', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useLibraryStore().assignGlobalConstant('g', '1', 'second', undefined)
    nodes.value = [
      reactive({
        id: 'a',
        data: {
          name: 'a',
          variables: [
            { name: 'g', value: '1', units: 'second', type: 'global_constant' },
            { name: 'k', value: '1', type: 'constant' },
          ],
        },
      }),
    ]
  })

  it('updates the shared value when edited, and undo puts it back', async () => {
    const libraryStore = useLibraryStore()
    await mountOnParams()

    await editRow('g', '3')
    expect(libraryStore.getGlobalConstant('g')).toEqual({ value: '3', units: 'second', data_reference: undefined })

    await useFlowHistoryStore().undo()
    await flushPromises()
    expect(libraryStore.getGlobalConstant('g').value).toBe('1')
    expect(findRow('g').value).toBe('1')
  })

  it('shows a global constant restored by undo', async () => {
    await mountOnParams()

    wrapper.vm.handleGlobalConstantChange({ name: 'g', value: '2', units: 'second' })
    await flushPromises()
    expect(findRow('g').value).toBe('2')

    await useFlowHistoryStore().undo()
    await flushPromises()
    expect(findRow('g').value).toBe('1')
  })

  it('stays on the Params tab when a row is switched to a new global constant', async () => {
    await mountOnParams()

    const row = findRow('k')
    row.type = 'global_constant'
    wrapper.vm.handleParameterTypeChange(row)
    await flushPromises()

    expect(useLibraryStore().getGlobalConstant('k').value).toBe('1')
    expect(wrapper.vm.activeTabId).toBe('params')
  })

  it('stays on the Params tab when a constant is added elsewhere', async () => {
    await mountOnParams()

    useLibraryStore().assignGlobalConstant('z', '4', 'second', undefined)
    await flushPromises()
    expect(wrapper.vm.activeTabId).toBe('params')
  })
})

describe('ContextSidebar opening and closing', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    nodes.value = []
  })

  /** Mounts the sidebar closed, as it starts. */
  async function mountCollapsed() {
    wrapper = mount(ContextSidebar, {
      props: { initialWidth: 320 },
      global: { plugins: [PrimeVue], stubs: { DataTable: { render: () => null }, NodeColourPanel: true, BioPropertiesPanel: true, SimulationPanel: true }, directives: { tooltip: {}, hint: {} } },
    })
    await flushPromises()
  }

  const toggle = () => wrapper.find('button.library-toggle')
  const panelBody = () => wrapper.find('.library-panel-body')
  const tabFor = (icon) => wrapper.findAll('[role=tab]').find((tab) => tab.find(`.${icon}`).exists())
  const widths = () => wrapper.emitted('resize').map(([width]) => width)

  it('starts closed, floating on the right, with only the hamburger showing', async () => {
    await mountCollapsed()

    expect(wrapper.vm.isCollapsed).toBe(true)
    expect(wrapper.classes()).toContain('resizable-library-panel--right')
    expect(wrapper.classes()).not.toContain('resizable-library-panel--inline')
    expect(panelBody().attributes('style')).toContain('display: none')
    expect(toggle().attributes('aria-label')).toBe('Show context panel')
    expect(toggle().attributes('aria-expanded')).toBe('false')
    expect(widths().at(-1)).toBe(0)
  })

  it('opens and closes from the hamburger', async () => {
    await mountCollapsed()

    await toggle().trigger('click')
    expect(wrapper.vm.isCollapsed).toBe(false)
    expect(panelBody().isVisible()).toBe(true)
    expect(toggle().attributes('aria-label')).toBe('Hide context panel')
    expect(widths().at(-1)).toBe(320)

    await toggle().trigger('click')
    expect(wrapper.vm.isCollapsed).toBe(true)
    expect(widths().at(-1)).toBe(0)
  })

  it('shows the colour properties for the diagram, and the physiology properties while that view is open', async () => {
    await mountCollapsed()
    await toggle().trigger('click')
    await tabFor('pi-wrench').trigger('click')
    expect(wrapper.findComponent({ name: 'NodeColourPanel' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'BioPropertiesPanel' }).exists()).toBe(false)

    await wrapper.setProps({ bioProperties: { roles: ref(new Map()), chooseRole: () => {}, chooseGlyph: () => {} } })
    expect(wrapper.findComponent({ name: 'NodeColourPanel' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'BioPropertiesPanel' }).exists()).toBe(true)
  })

  it('switches tabs without closing, even on the open tab', async () => {
    await mountCollapsed()
    await toggle().trigger('click')

    await tabFor('pi-wrench').trigger('click')
    expect(wrapper.vm.activeTabId).toBe('props')
    expect(tabFor('pi-wrench').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('.module-aside-title').text()).toBe('Properties')

    await tabFor('pi-wrench').trigger('click')
    expect(wrapper.vm.isCollapsed).toBe(false)
    expect(wrapper.vm.activeTabId).toBe('props')
  })

  const headerTitle = () => wrapper.find('.module-aside-title').text().replace(/\s+/g, ' ')

  it('puts each tab’s name and detail in the panel header, not in the tab', async () => {
    await mountCollapsed()
    await toggle().trigger('click')

    expect(headerTitle()).toBe('Global parameters (0)')
    await tabFor('pi-chart-line').trigger('click')
    expect(headerTitle()).toBe('Simulation')
    expect(wrapper.findAll('.p-tabpanels h4')).toHaveLength(0)
  })

  it('names the edited instance and its parameter count in the header', async () => {
    nodes.value = [{ id: 'n1', type: 'instanceNode', data: { name: 'LV', moduleRef: 'missing.cellml:none' } }]
    await mountOnParams()

    expect(headerTitle()).toBe(`Instance parameters · LV (${wrapper.vm.parameterRows.length})`)
  })

  it('offers New in the header on the inspection modules tab only', async () => {
    await mountCollapsed()
    await toggle().trigger('click')
    expect(wrapper.find('.module-aside-header-actions').exists()).toBe(false)

    await tabFor('pi-question-circle').trigger('click')
    const actions = wrapper.find('.module-aside-header-actions')
    expect(headerTitle()).toBe('Inspection modules (0)')
    await actions.find('button').trigger('click')
    expect(wrapper.emitted('open-inspection-module-dialog')).toHaveLength(1)
  })

  it('closes when asked, and opens again on a tab', async () => {
    await mountOnParams()

    wrapper.vm.collapse()
    await flushPromises()
    expect(wrapper.vm.isCollapsed).toBe(true)
    expect(widths().at(-1)).toBe(0)

    wrapper.vm.showTab('global')
    await flushPromises()
    expect(wrapper.vm.isCollapsed).toBe(false)
    expect(wrapper.vm.activeTabId).toBe('global')
    expect(widths().at(-1)).toBeGreaterThan(0)
  })
})
