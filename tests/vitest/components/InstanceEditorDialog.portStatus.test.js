// @vitest-environment happy-dom
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const flowNodes = ref([])
const flowEdges = ref([])
// The canvas level a test enters.
const level = vi.hoisted(() => ({ instancePath: null, isEditingSupermodule: null }))
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm: async () => true }) }))
vi.mock('@vue-flow/core', async (importOriginal) => {
  const { computed } = await import('vue')
  // One flow, so the model is expanded once per workspace, as in the app.
  let flow
  return { ...(await importOriginal()), useVueFlow: () => (flow ??= { nodes: flowNodes, edges: flowEdges, getSelectedNodes: computed(() => []) }) }
})
vi.mock('../../../src/composables/useCanvasLevel', async () => {
  const { ref } = await import('vue')
  level.instancePath = ref([])
  level.isEditingSupermodule = ref(false)
  return { useCanvasLevel: () => level }
})
vi.mock('../../../src/utils/layout', () => ({ waitUntilStable: () => Promise.resolve() }))
vi.mock('../../../src/composables/useSimulation', async () => {
  const { ref } = await import('vue')
  return { useSimulation: () => ({ run: vi.fn(), stop: vi.fn(), keepCurrent: vi.fn(), isStale: ref(false) }) }
})
vi.mock('../../../src/services/simulation/libopencorLoader', () => ({ libopencor: { status: 'ready' } }))
// Whether expanding the dialog's preview of the canvas, never the store's own nodes, throws, and how often it runs.
const expansion = vi.hoisted(() => ({ failsPreview: false, previews: 0 }))
vi.mock('../../../src/services/hierarchy/expand', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    expandHierarchy: (nodes, ...rest) => {
      if (nodes !== flowNodes.value) expansion.previews++
      if (expansion.failsPreview && nodes !== flowNodes.value) throw new Error('expansion failed')
      return actual.expandHierarchy(nodes, ...rest)
    },
  }
})

const { default: InstanceEditorDialog } = await import('../../../src/components/InstanceEditorDialog.vue')
const { connect, exposed, exposures, module, port, superInstance, supermodule } = await import('../fixtures/hierarchy/graph.js')

const MATH_REF = 'file:m'
const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="m">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" initial_value="1"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><cn cellml:units="metre_per_second" xmlns:cellml="http://www.cellml.org/cellml/2.0#">0</cn></apply>
    </math>
  </component>
</model>`

const Stub = defineComponent({
  emits: ['change', 'undo', 'redo', 'variable-click'],
  setup(_, { expose, slots }) {
    expose({ format: 'mathml', setText: vi.fn(), setModel: vi.fn(), flush: () => {}, getErrors: () => [], focus: () => {}, flushPendingRenames: () => {}, ensureResults: vi.fn() })
    return () => h('div', [slots.header?.(), slots.default?.(), slots.footer?.()])
  },
})

// Shows a tooltip's text on its element, so a test can read it.
const tooltip = {
  mounted: (el, { value }) => (el.dataset.tooltip = value ?? ''),
  updated: (el, { value }) => (el.dataset.tooltip = value ?? ''),
}

/**
 * Super-module heart, whose module ra exposes its port u, placed twice at the root: si_1, whose u root module outer
 * couples to, and si_2, coupled to nothing.
 */
function workspace() {
  const ra = module('ra', 'ra', { scope: 'sm_1', ports: [port('general_ports', 'u', ['x'])], data: { mathRef: MATH_REF } })
  const inner = { nodes: [supermodule('sm_1', 'heart', { submoduleOrder: ['ra'] }), ra], edges: exposures('sm_1', [exposed('xp_1', 'ra', 'general_ports', 'u')]) }
  const si1 = superInstance(inner, 'si_1', 'left', 'sm_1')
  const si2 = superInstance(inner, 'si_2', 'right', 'sm_1')
  const outer = module('outer', 'outer', { ports: [port('general_ports', 'u', ['x'])], data: { mathRef: MATH_REF } })
  flowNodes.value = [outer, si1, si2, ...inner.nodes]
  flowEdges.value = [...inner.edges, connect(outer, si1)]
  return ra
}

const RATE_REF = 'file:rate'
const RATE_XML = XML.replace('name="m"', 'name="rate"').replace('<component name="m">', '<component name="rate">').replace(
  '<variable name="x" units="metre" initial_value="1"/>',
  '<variable name="x" units="metre" initial_value="1"/>\n    <variable name="k" units="per_second" initial_value="2"/>'
)

/**
 * Super-module heart, whose module ra takes its boundary condition k, valued 2, through its exposed port u, placed
 * twice: si_1, whose u root module outer supplies, and si_2, supplied by nothing.
 */
function rateWorkspace() {
  const variables = [
    { name: 't', units: 'second', type: 'variable', access: 'access' },
    { name: 'x', units: 'metre', type: 'variable', access: 'access' },
    { name: 'k', units: 'per_second', type: 'boundary_condition', value: '2', access: 'access' },
  ]
  const ra = module('ra', 'ra', { scope: 'sm_1', ports: [port('general_ports', 'u', ['k'])], variables, data: { mathRef: RATE_REF } })
  const inner = { nodes: [supermodule('sm_1', 'heart', { submoduleOrder: ['ra'] }), ra], edges: exposures('sm_1', [exposed('xp_1', 'ra', 'general_ports', 'u')]) }
  const si1 = superInstance(inner, 'si_1', 'left', 'sm_1')
  const si2 = superInstance(inner, 'si_2', 'right', 'sm_1')
  const outer = module('outer', 'outer', {
    ports: [port('general_ports', 'u', ['k_src'])],
    variables: [{ name: 'k_src', units: 'per_second', type: 'variable', access: 'access' }],
    data: { mathRef: MATH_REF },
  })
  flowNodes.value = [outer, si1, si2, ...inner.nodes]
  flowEdges.value = [...inner.edges, connect(outer, si1)]
  return ra
}

let wrapper
afterEach(() => {
  wrapper?.unmount()
  flowNodes.value = []
  flowEdges.value = []
})

/**
 * Opens the editor of a node on its Ports tab.
 *
 * @param {Object} node
 * @returns {Promise<import('@vue/test-utils').DOMWrapper>} The port's status dot.
 */
async function openPorts(node) {
  await openEditor(node, 'ports')
  await vi.waitFor(() => expect(wrapper.find('td .port-status').exists()).toBe(true))
  return wrapper.find('td .port-status')
}

/**
 * Opens the editor of a node on a tab, its rows loaded.
 *
 * @param {Object} node
 * @param {string} [defaultTab='parameters']
 */
async function openEditor(node, defaultTab = 'parameters') {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', component: { render: () => null } }] })
  wrapper = mount(InstanceEditorDialog, {
    props: {
      modelValue: false,
      id: node.id,
      initialName: node.data.name,
      mathRef: node.data.mathRef,
      variables: node.data.variables,
      initialPorts: node.data.ports,
      defaultTab,
    },
    global: {
      plugins: [PrimeVue, router],
      stubs: { Dialog: Stub, CellMLTextEditor: Stub, MathWorkbenchEditor: Stub, ParameterTable: Stub, SimulationPanel: Stub },
      directives: { tooltip },
    },
  })
  await wrapper.setProps({ modelValue: true })
  await flushPromises()
}

describe('InstanceEditorDialog port status inside super-modules', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    useLibraryStore().addMath(MATH_REF, XML)
    level.instancePath.value = []
    level.isEditingSupermodule.value = false
  })

  it('shows a port exposed and coupled above as connected, in the super instance entered', async () => {
    const ra = workspace()
    level.instancePath.value = ['si_1']
    const dot = await openPorts(ra)

    expect(dot.classes()).toContain('port-status--connected')
    expect(dot.attributes('data-tooltip')).toBe('Connected to outer')
  })

  it('shows the port free in a super instance where nothing couples to it', async () => {
    const ra = workspace()
    level.instancePath.value = ['si_2']
    const dot = await openPorts(ra)

    expect(dot.classes()).toContain('port-status--free')
    expect(dot.attributes('data-tooltip')).toBe('Not connected')
  })

  it('shows the port exposed via its interface when its super-module is edited on its own', async () => {
    const ra = workspace()
    level.isEditingSupermodule.value = true
    const dot = await openPorts(ra)

    expect(dot.classes()).toContain('port-status--exposed')
    expect(dot.attributes('data-tooltip')).toBe('Exposed via interface')
    expect(wrapper.find('.ports-key').text()).toContain('Exposed via interface')
  })
})

describe('InstanceEditorDialog connection status inside super-modules', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    useLibraryStore().addMath(MATH_REF, XML)
    useLibraryStore().addMath(RATE_REF, RATE_XML)
    level.instancePath.value = []
    level.isEditingSupermodule.value = false
    expansion.failsPreview = false
    expansion.previews = 0
  })

  /** @returns {Object} The k row's status, ignored notice and issue chips, as the dialog has them. */
  const kStatus = () => ({
    status: wrapper.vm.connectionStatus.get('k'),
    notice: wrapper.vm.ignoredNotices.get('k'),
    chips: wrapper.vm.issueChips.map((chip) => chip.key),
  })

  it('reads the status of the module’s copy in the super instance entered', async () => {
    const ra = rateWorkspace()
    level.instancePath.value = ['si_1']
    await openEditor(ra)

    await vi.waitFor(() => expect(kStatus().status?.state).toBe('connected'))
    expect(kStatus().notice).toMatch(/^Set by .*k_src: this value is ignored on export$/)
    expect(kStatus().chips).toContain('ignored')
    expect(wrapper.find('.connection-elsewhere-note').exists()).toBe(false)
  })

  it('resolves the status once on opening, after its rows and ports load', async () => {
    const ra = rateWorkspace()
    level.instancePath.value = ['si_1']
    await openEditor(ra)

    await vi.waitFor(() => expect(kStatus().status?.state).toBe('connected'))
    expect(expansion.previews).toBe(1)
  })

  it('reads its own value in a super instance where nothing supplies it', async () => {
    const ra = rateWorkspace()
    level.instancePath.value = ['si_2']
    await openEditor(ra)

    await vi.waitFor(() => expect(kStatus().status?.state).toBe('own'))
    expect(kStatus().notice).toBeUndefined()
  })

  it('says connection status is shown inside a super instance when its super-module is edited on its own', async () => {
    const ra = rateWorkspace()
    level.isEditingSupermodule.value = true
    await openEditor(ra)

    expect(wrapper.find('.connection-elsewhere-note').text()).toBe('Connection status is shown inside a super instance.')
    expect(wrapper.vm.connectionStatus.size).toBe(0)
  })

  it('shows no status, and still opens, when the model fails to expand', async () => {
    const ra = rateWorkspace()
    level.instancePath.value = ['si_1']
    expansion.failsPreview = true
    await openEditor(ra)

    expect(wrapper.vm.parameterRows.some((row) => row.name === 'k')).toBe(true)
    expect(wrapper.vm.connectionStatus.size).toBe(0)
    expect(wrapper.vm.issueChips.map((chip) => chip.key)).not.toContain('ignored')
  })
})
