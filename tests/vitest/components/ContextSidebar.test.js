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
    updateNodeData: (id, patch) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (node) node.data = { ...node.data, ...patch }
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
  wrapper = mount(ContextSidebar, { global: { plugins: [PrimeVue], stubs: { DataTable: { render: () => null } }, directives: { tooltip: {} } } })
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
