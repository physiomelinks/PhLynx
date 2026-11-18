// @vitest-environment happy-dom
import { reactive, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { SVG_EXCLUDE_SELECTOR } from '../../../src/services/export/svg.js'

const nodes = ref([])
const notifyError = vi.hoisted(() => vi.fn())

vi.mock('../../../src/utils/notify', () => ({ notify: Object.assign(vi.fn(), { error: notifyError }) }))

vi.mock('@vue-flow/core', async (importOriginal) => {
  const findNode = (id) => nodes.value.find((node) => node.id === id)
  return {
    ...(await importOriginal()),
    Handle: { name: 'Handle', template: '<div class="handle-stub"><slot /></div>' },
    useVueFlow: () => ({
      id: 'main-flow-editor',
      nodes,
      getNodes: nodes,
      edges: ref([]),
      viewport: ref({ x: 0, y: 0, zoom: 1 }),
      addEdges: vi.fn(),
      removeEdges: vi.fn(),
      updateNodeInternals: vi.fn(),
      findNode,
      findEdge: () => undefined,
      updateNodeData: (id, update, options = { replace: false }) => {
        const node = findNode(id)
        if (!node) return
        const patch = typeof update === 'function' ? update(node) : update
        node.data = options.replace ? patch : { ...node.data, ...patch }
      },
    }),
  }
})

vi.mock('@vue-flow/node-resizer', () => ({ NodeResizer: { name: 'NodeResizer', template: '<div />' } }))

const { default: InstanceNode } = await import('../../../src/components/InstanceNode.vue')

let wrapper

/** Mounts node `a` with the data the store holds for it. */
function mountNode() {
  wrapper = mount(InstanceNode, {
    props: { id: 'a', data: nodes.value[0].data },
    global: { plugins: [PrimeVue], directives: { tooltip: {}, hint: {} } },
    attachTo: document.body,
  })
}

const nameButton = () => wrapper.find('.name-text')
const nameInput = () => wrapper.find('.instance-name input')

describe('InstanceNode', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    setActivePinia(createPinia())
    notifyError.mockClear()
    nodes.value = [
      reactive({ id: 'a', data: { name: 'soma', mathRef: 'cell.cellml:soma', variables: [], handles: [] } }),
      reactive({ id: 'b', data: { name: 'axon', mathRef: 'cell.cellml:axon', variables: [], handles: [] } }),
    ]
  })

  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
  })

  it('shows the name as a rename button', () => {
    mountNode()
    expect(nameButton().text()).toBe('soma')
    expect(nameButton().attributes('aria-label')).toBe('Rename soma')
    expect(nameButton().attributes('role')).toBe('button')
  })

  it('keeps the name in the SVG export', () => {
    mountNode()
    expect(nameButton().element.closest(SVG_EXCLUDE_SELECTOR)).toBeNull()
  })

  it('starts renaming a moment after a single click', async () => {
    mountNode()
    await nameButton().trigger('click', { detail: 1 })
    expect(nameInput().exists()).toBe(false)

    vi.advanceTimersByTime(250)
    await flushPromises()
    expect(nameInput().element.value).toBe('soma')
  })

  it('starts renaming at once from the keyboard', async () => {
    mountNode()
    await nameButton().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(nameInput().exists()).toBe(true)
  })

  it('opens the instance editor, not a rename, on a double-click on the name', async () => {
    mountNode()
    const button = nameButton()
    await button.trigger('click', { detail: 1 })
    await button.trigger('click', { detail: 2 })
    await button.trigger('dblclick')
    vi.advanceTimersByTime(500)
    await flushPromises()

    expect(nameInput().exists()).toBe(false)
    expect(wrapper.emitted('open-instance-editor')).toHaveLength(1)
    expect(wrapper.emitted('open-instance-editor')[0][0]).toMatchObject({ id: 'a', defaultTab: 'parameters' })
  })

  it('drops a scheduled rename when the node is double-clicked', async () => {
    mountNode()
    await nameButton().trigger('click', { detail: 1 })
    await nameButton().trigger('dblclick')
    vi.advanceTimersByTime(500)
    await flushPromises()

    expect(nameInput().exists()).toBe(false)
    expect(wrapper.emitted('open-instance-editor')).toHaveLength(1)
  })

  it('opens the instance editor, not a rename, on a double-click slower than the rename delay', async () => {
    mountNode()
    await nameButton().trigger('click', { detail: 1 })
    vi.advanceTimersByTime(300)
    await flushPromises()
    expect(nameInput().exists()).toBe(true)

    await nameInput().trigger('dblclick')
    await flushPromises()
    expect(nameInput().exists()).toBe(false)
    expect(wrapper.emitted('open-instance-editor')).toHaveLength(1)
  })

  it('keeps renaming on a later double-click in the field', async () => {
    mountNode()
    await nameButton().trigger('click', { detail: 1 })
    vi.advanceTimersByTime(1000)
    await flushPromises()

    await nameInput().trigger('dblclick')
    await flushPromises()
    expect(nameInput().exists()).toBe(true)
    expect(wrapper.emitted('open-instance-editor')).toBeUndefined()
  })

  it('opens the instance editor on a double-click anywhere on the node', async () => {
    mountNode()
    await wrapper.find('.detail-value').trigger('dblclick')
    expect(wrapper.emitted('open-instance-editor')).toHaveLength(1)
  })

  it('renames on Enter as one undo step, and leaves the name on Escape', async () => {
    mountNode()
    await nameButton().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await nameInput().setValue('dendrite')
    await nameInput().trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(nodes.value[0].data.name).toBe('dendrite')
    expect(nameInput().exists()).toBe(false)
    await useFlowHistoryStore().undo()
    expect(nodes.value[0].data.name).toBe('soma')

    await nameButton().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await nameInput().setValue('other')
    await nameInput().trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(nameInput().exists()).toBe(false)
    expect(nodes.value[0].data.name).toBe('soma')
  })

  it('keeps renaming when another instance already has the name', async () => {
    mountNode()
    await nameButton().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await nameInput().setValue('axon')
    await nameInput().trigger('keydown', { key: 'Enter' })
    await flushPromises()

    expect(notifyError).toHaveBeenCalledWith({ message: 'An instance with this name already exists.' })
    expect(nameInput().exists()).toBe(true)
    expect(nodes.value[0].data.name).toBe('soma')
  })
})

describe('InstanceNode warning', () => {
  const MATH = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="PhLynxComponent">
  <component name="soma"><variable name="k" units="per_second" interface="public_and_private"/></component>
</model>`
  const IMBALANCE =
    "The units in 'dx/dt = k*x' in component 'soma' are not equivalent. 'dx/dt' is in 'metre x second^-1' while 'k*x' is in 'metre x second'."

  // Records the tooltip's text, which the real directive keeps out of the DOM.
  const tooltip = {
    mounted: (el, { value }) => (el.dataset.tooltip = value),
    updated: (el, { value }) => (el.dataset.tooltip = value),
  }
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.addMath('cell.cellml:soma', MATH)
    store.addUnitsFile({
      componentFile: 'units.cellml',
      model: `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
</model>`,
    })
    store.getMathCheck = vi.fn(() => ({ invalid: [], imbalances: [] }))
  })

  afterEach(() => wrapper?.unmount())

  function mountWith(variables) {
    nodes.value = [reactive({ id: 'a', data: { name: 'soma', mathRef: 'cell.cellml:soma', variables, handles: [] } })]
    wrapper = mount(InstanceNode, {
      props: { id: 'a', data: nodes.value[0].data },
      global: { plugins: [PrimeVue], directives: { tooltip, hint: {} } },
    })
  }
  const warning = () => wrapper.find('.status-indicator .warning-icon')

  it('shows no warning when the parameters and units are fine', () => {
    mountWith([{ name: 'k', type: 'constant', value: '1', units: 'per_second' }])
    expect(warning().exists()).toBe(false)
  })

  it("warns when the module's math doesn't balance its units", () => {
    store.getMathCheck = vi.fn(() => ({ invalid: [], imbalances: [IMBALANCE] }))
    mountWith([{ name: 'k', type: 'constant', value: '1', units: 'per_second' }])
    expect(store.getMathCheck).toHaveBeenCalledWith('cell.cellml:soma')
    expect(warning().attributes('data-tooltip')).toBe(
      "Units don't balance in an equation of this module's math:\n" +
        "• dx/dt = k*x: 'dx/dt' is in 'metre x second^-1' while 'k*x' is in 'metre x second'."
    )
  })

  it("warns when a parameter's units have other dimensions than the math's", () => {
    mountWith([{ name: 'k', type: 'constant', value: '1', units: 'second' }])
    expect(warning().attributes('data-tooltip')).toBe(
      'Parameter units don\'t match the math\'s dimensions:\n• "k" is in second, but its math uses per_second'
    )
  })

  it("warns when the module's math isn't valid CellML", () => {
    store.getMathCheck = vi.fn(() => ({
      invalid: [
        "MathML ci element has the child text 'r_max' which does not correspond with any variable names present in component 'soma'.",
      ],
      imbalances: [],
    }))
    mountWith([{ name: 'k', type: 'constant', value: '1', units: 'per_second' }])
    expect(warning().attributes('data-tooltip')).toBe(
      "This module's math isn't valid CellML:\n• MathML ci element has the child text 'r_max' which does not correspond with any variable names."
    )
  })

  it('lists only the first few problems of a kind', () => {
    const invalid = ['a', 'b', 'c', 'd', 'e'].map((name) => `Variable '${name}' is wrong.`)
    store.getMathCheck = vi.fn(() => ({ invalid, imbalances: [] }))
    mountWith([])
    expect(warning().attributes('data-tooltip').split('\n').slice(-2)).toEqual(["• Variable 'c' is wrong.", '• and 2 more'])
  })

  it('lists every problem in one warning', () => {
    store.getMathCheck = vi.fn(() => ({ invalid: [], imbalances: [IMBALANCE] }))
    mountWith([{ name: 'k', type: 'constant', value: '', units: 'per_second' }])
    expect(wrapper.findAll('.warning-icon')).toHaveLength(1)
    expect(warning().attributes('data-tooltip').split('\n\n')).toHaveLength(2)
  })
})
