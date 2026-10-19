// @vitest-environment happy-dom
import { computed, reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const nodes = ref([])
// Interface nodes, which findNode finds but the canvas doesn't select.
const supermodules = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges: ref([]),
    getSelectedNodes: computed(() => nodes.value),
    userSelectionActive: ref(false),
    findNode: (id) => [...nodes.value, ...supermodules.value].find((node) => node.id === id),
    findEdge: () => undefined,
    updateNodeData: () => {},
  }),
}))

vi.mock('../../../src/composables/useActiveCanvas', async () => {
  const { computed: makeComputed } = await import('vue')
  return { useActiveCanvas: () => ({ selectedNodes: makeComputed(() => nodes.value) }) }
})

// The selected node is a module inside a super instance entered from the root, or edited on its own.
const mode = ref('instance')
const context = vi.hoisted(() => ({
  writeRow: vi.fn(() => []),
  resetRow: vi.fn(),
  provenanceOf: null,
  // The expanded model, which a test changes as an override or undo would.
  graph: null,
}))
vi.mock('../../../src/composables/useParameterContext', async () => {
  const { ref: makeRef } = await import('vue')
  context.graph = makeRef({})
  context.provenanceOf = vi.fn(() =>
    mode.value === 'instance'
      ? new Map([
          ['k', { chip: 'overridden', isOverridden: true, inherited: '1', status: { state: 'connected' } }],
          ['m', { chip: 'ignored', isOverridden: false, status: null }],
          ['c', { chip: 'local', isLocal: true, isOverridden: false, status: null }],
        ])
      : new Map([['k', { total: 3, summary: 'connected in 2/3' }]])
  )
  return {
    useParameterContext: () => ({
      contextOf: (node) => ({ mode: node ? mode.value : 'root', modelId: node ? 'sub/x' : null }),
      rowsOf: () => [
        { name: 'k', value: '9', type: 'constant', units: 's' },
        { name: 'm', value: '5', type: 'constant', units: 's' },
        { name: 'c', value: '7', type: 'local_constant', units: 's' },
      ],
      provenanceOf: (node) => context.provenanceOf(node),
      targetFor: (node, chosen) => (mode.value === 'supermodule' ? 'supermodule' : chosen),
      writeRow: context.writeRow,
      resetRow: context.resetRow,
      graph: context.graph,
    }),
  }
})

const { default: ContextSidebar } = await import('../../../src/components/ContextSidebar.vue')
const { SUPER_INSTANCE_NODE_TYPE, SUPERMODULE_INTERFACE_NODE_TYPE } = await import('../../../src/utils/constants.js')

let wrapper
afterEach(() => wrapper?.unmount())

async function mountOnParams() {
  wrapper = mount(ContextSidebar, {
    global: {
      plugins: [PrimeVue],
      stubs: { DataTable: { render: () => null }, NodeColourPanel: true, ExposedPortList: true, LocalConstantsPanel: true, NewSupermoduleDialog: true, SuperInstancePanel: true },
      directives: { tooltip: {} },
    },
  })
  wrapper.vm.isCollapsed = false
  wrapper.vm.activeTabId = 'params'
  await waitForRows()
}

/** Waits for the sidebar's deferred row rebuild, which lands after the next paint. */
async function waitForRows() {
  await flushPromises()
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)))
  await flushPromises()
}

const findRow = (name) => wrapper.vm.parameterRows.find((row) => row.name === name)

describe('ContextSidebar inside a super instance', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mode.value = 'instance'
    nodes.value = [reactive({ id: 'sm_1~x', data: { scope: 'sm_1', localId: 'x', name: 'x', variables: [] } })]
    supermodules.value = [
      { id: 'sm_1', type: 'supermoduleInterface', data: { supermodule: { name: 'segment', localConstants: [{ name: 'c', units: 's', value: '4' }, { name: 'm', units: 's', value: '6' }] } } },
    ]
  })

  it('shows the values there, chipped by where they come from', async () => {
    await mountOnParams()
    expect(findRow('k')).toMatchObject({ value: '9', chip: 'overridden', statusText: 'connected; super-module value 1' })
    expect(findRow('m').chip).toBe('ignored')
    expect(wrapper.text()).toContain('Edits apply to')
  })

  it('edits this super instance by default, only its value, and the super-module’s default when switched', async () => {
    await mountOnParams()
    expect(wrapper.vm.editTarget).toBe('instance')
    expect(wrapper.vm.isOverrideTarget).toBe(true)

    findRow('k').value = '4'
    wrapper.vm.handleParameterValueChange(findRow('k'))
    expect(context.writeRow).toHaveBeenLastCalledWith(nodes.value[0], 'k', { value: '4', type: 'constant' }, expect.objectContaining({ target: 'instance' }))

    wrapper.vm.editTarget = 'supermodule'
    wrapper.vm.handleParameterValueChange(findRow('k'))
    expect(context.writeRow).toHaveBeenLastCalledWith(nodes.value[0], 'k', expect.anything(), expect.objectContaining({ target: 'supermodule' }))
  })

  it('edits a super-module edited on its own only as its default, its statuses summed up', async () => {
    mode.value = 'supermodule'
    await mountOnParams()
    expect(wrapper.vm.editTarget).toBe('supermodule')
    expect(wrapper.vm.editTargetOptions[0]).toMatchObject({ value: 'instance', disabled: true })
    expect(findRow('k').summary).toBe('connected in 2/3')
  })

  it('chips a local constant row, offers the local type for a row its super-module declares, and binds it at the declared value', async () => {
    await mountOnParams()
    expect(findRow('c')).toMatchObject({ value: '7', chip: 'local', statusText: 'local constant' })
    const optionsOf = (name) => wrapper.vm.typeOptionsFor(findRow(name), null, wrapper.vm.localConstantNames).map((option) => option.value)
    expect(optionsOf('m')).toContain('local_constant')
    expect(optionsOf('k')).not.toContain('local_constant')

    wrapper.vm.editTarget = 'supermodule'
    findRow('m').type = 'local_constant'
    wrapper.vm.handleParameterTypeChange(findRow('m'))
    expect(context.writeRow).toHaveBeenLastCalledWith(nodes.value[0], 'm', { value: '6', type: 'local_constant' }, expect.objectContaining({ target: 'supermodule' }))
  })

  it('shows a local constant row of a super-module edited on its own at its declared value', async () => {
    mode.value = 'supermodule'
    await mountOnParams()
    expect(findRow('c').value).toBe('4')
  })

  it('edits the next module selected as this super instance again, whatever the last one was set to', async () => {
    await mountOnParams()
    wrapper.vm.editTarget = 'supermodule'

    nodes.value = [reactive({ id: 'sm_1~y', data: { scope: 'sm_1', localId: 'y', name: 'y', variables: [] } })]
    await waitForRows()
    expect(wrapper.vm.parameterRowsNode.id).toBe('sm_1~y')
    expect(wrapper.vm.editTarget).toBe('instance')
  })

  it('rebuilds the rows on a model change only once they are shown', async () => {
    await mountOnParams()
    wrapper.vm.isCollapsed = true
    await flushPromises()
    context.provenanceOf.mockClear()

    context.graph.value = {}
    await waitForRows()
    expect(context.provenanceOf).not.toHaveBeenCalled()

    wrapper.vm.isCollapsed = false
    await waitForRows()
    expect(context.provenanceOf).toHaveBeenCalledTimes(1)
  })
})

describe('ContextSidebar headings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    mode.value = 'instance'
    supermodules.value = []
  })

  const heading = () => wrapper.find('.context-section--params').element.previousElementSibling.textContent.trim()

  it.each([
    { label: 'a super instance', node: { id: 'si_1', type: SUPER_INSTANCE_NODE_TYPE, data: { name: 'left' } }, expected: 'Super Instance' },
    { label: 'a super-module’s interface', node: { id: 'sm_1', type: SUPERMODULE_INTERFACE_NODE_TYPE, data: { supermodule: { name: 'segment' } } }, expected: 'Super-module Interface' },
    { label: 'a module', node: { id: 'sm_1~x', data: { scope: 'sm_1', localId: 'x', name: 'x', variables: [] } }, expected: 'Instance Parameters' },
  ])('heads the panel of $label by what it is', async ({ node, expected }) => {
    nodes.value = [reactive(node)]
    await mountOnParams()
    expect(heading()).toBe(expected)
  })

  it('truncates a long super-module name, its whole name in a tooltip, beside its rename button', async () => {
    const name = 'a_very_long_super_module_name_that_will_not_fit_in_the_sidebar'
    nodes.value = [reactive({ id: 'sm_1', type: SUPERMODULE_INTERFACE_NODE_TYPE, data: { supermodule: { name } } })]
    await mountOnParams()
    const title = wrapper.find('.context-section--params .context-title-name')
    expect(title.attributes('title')).toBe(`Exposed ports of ${name}`)
    expect(title.element.nextElementSibling.classList).toContain('rename-supermodule-btn')
  })
})
