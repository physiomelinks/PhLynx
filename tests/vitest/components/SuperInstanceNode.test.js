// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FLOW_IDS } from '../../../src/utils/constants.js'
import { exposed, exposures, module, port, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'

const notifyError = vi.hoisted(() => vi.fn())
vi.mock('../../../src/utils/notify', () => ({ notify: Object.assign(vi.fn(), { error: notifyError }) }))

// The node is drawn in the workspace's own flow, as inside its VueFlow.
vi.mock('@vue-flow/core', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    Handle: { name: 'Handle', template: '<div class="handle-stub"><slot /></div>' },
    useVueFlow: (id) => actual.useVueFlow(id ?? 'main-flow-editor'),
  }
})
vi.mock('@vue-flow/node-resizer', () => ({ NodeResizer: { name: 'NodeResizer', template: '<div />' } }))

const { useVueFlow } = await import('@vue-flow/core')
const { useCanvasLevel } = await import('../../../src/composables/useCanvasLevel.js')
const { useFlowHistoryStore } = await import('../../../src/stores/historyStore.js')
const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore.js')
const { default: SuperInstanceNode } = await import('../../../src/components/SuperInstanceNode.vue')
const { default: InterfaceNode } = await import('../../../src/components/InterfaceNode.vue')

const IN = port('entrance_ports', 'vessel', ['v_in', 'u'])

/** Root: two super instances of heart (sm_1, holding lv), and a module. */
function graph() {
  const lv = module('dndnode_0', 'lv', { scope: 'sm_1', ports: [{ ...IN }] })
  const sm = supermodule('sm_1', 'heart', { ca: { module_type: 'heart', module_subtype: 'Argus2026_v01' } })
  const exposure = exposures('sm_1', [exposed('xp_in', 'dndnode_0', 'entrance_ports', 'vessel')])
  const inner = { nodes: [sm, lv], edges: exposure }
  const left = superInstance(inner, 'dndnode_1', 'left', 'sm_1')
  const right = superInstance(inner, 'dndnode_2', 'right', 'sm_1')
  return { nodes: [left, right, sm, lv], edges: exposure }
}

describe('SuperInstanceNode', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let wrapper

  const mountNode = (id = 'dndnode_1') => {
    wrapper = mount(SuperInstanceNode, {
      props: { id, data: flow.findNode(id).data },
      global: { plugins: [PrimeVue], directives: { tooltip: {} } },
      attachTo: document.body,
    })
  }
  const nameInput = () => wrapper.find('.instance-name input')

  beforeEach(async () => {
    setActivePinia(createPinia())
    notifyError.mockClear()
    level.reset()
    await flow.fromObject(level.withVisibility(graph()))
  })
  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
  })

  it('shows its name, its super-module and its ports, but not how many super instances that has', () => {
    mountNode()
    expect(wrapper.find('.name-text').text()).toBe('left')
    expect(wrapper.find('.super-instance-supermodule').text()).toBe('heart:Argus2026_v01')
    expect(wrapper.find('.super-instance-count').exists()).toBe(false)
    expect(wrapper.text()).toContain('1 port')
  })

  it('lists its ports on hover, each with the child it is on', () => {
    const tooltip = { mounted: (el, { value }) => (el.dataset.tooltip = value?.value ?? '') }
    wrapper = mount(SuperInstanceNode, {
      props: { id: 'dndnode_1', data: flow.findNode('dndnode_1').data },
      global: { plugins: [PrimeVue], directives: { tooltip } },
    })
    expect(wrapper.find('.super-instance-ports').attributes('data-tooltip')).toBe('vessel — lv')
  })

  it('is an instance card, with the same header, name and button, and a second card stacked behind it', () => {
    mountNode()
    const card = wrapper.find('.instance-card')
    expect(card.classes()).toEqual(expect.arrayContaining(['instance-card', 'super-instance-card']))
    // The front card is the node's only card box: no inline border or offset of its own.
    expect(card.attributes('style') ?? '').not.toMatch(/border|shadow|transform/)
    expect(card.findAll(':scope > *').map((child) => child.classes()[0])).toEqual(['card-header-actions', 'instance-name'])
    expect(card.findAll('.instance-details .detail-item')).toHaveLength(2)
    expect(card.find('.super-instance-open').classes()).toContain('instance-button')

    // Nested by a second edge inside the card, so nothing is drawn outside it.
    expect(wrapper.find('.super-instance-stack').exists()).toBe(false)
  })

  it('opens from its Open button', async () => {
    mountNode()
    await wrapper.find('.super-instance-open').trigger('click')
    expect(level.scope.value).toBe('sm_1')
    expect(level.instancePath.value).toEqual(['dndnode_1'])
  })

  it('opens on a double-click, not a rename', async () => {
    vi.useFakeTimers()
    mountNode()
    await wrapper.find('.name-text').trigger('click', { detail: 1 })
    await wrapper.find('.name-text').trigger('dblclick')
    vi.advanceTimersByTime(500)
    await flushPromises()
    expect(nameInput().exists()).toBe(false)
    expect(level.instancePath.value).toEqual(['dndnode_1'])
  })

  it('says when its super-module is missing, and can’t open', () => {
    flow.removeNodes([{ ...flow.findNode('sm_1'), deletable: true }])
    mountNode()
    expect(wrapper.find('.super-instance-supermodule--missing').exists()).toBe(true)
    expect(wrapper.find('.super-instance-open').attributes('disabled')).toBeDefined()
  })

  it('renames as one undo step, by the rules for names inside super-modules', async () => {
    mountNode()
    await wrapper.find('.name-text').trigger('keydown', { key: 'Enter' })
    await flushPromises()
    await nameInput().setValue('left__a')
    await nameInput().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(notifyError).toHaveBeenCalledWith({ items: [expect.stringContaining('"__"')] })
    expect(flow.findNode('dndnode_1').data.name).toBe('left')

    await nameInput().setValue('right')
    await nameInput().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(notifyError).toHaveBeenLastCalledWith({ items: ['A node here already has this name.'] })

    await nameInput().setValue('atrium')
    await nameInput().trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(flow.findNode('dndnode_1').data.name).toBe('atrium')
    await useFlowHistoryStore().undo()
    expect(flow.findNode('dndnode_1').data.name).toBe('left')
  })

  it('is outlined as simulated when a module inside it was simulated', async () => {
    mountNode()
    expect(wrapper.classes()).not.toContain('instance-node--simulated')
    const results = useSimulationResultsStore()
    results.results = { ok: true }
    results.scopeNodeIds = ['dndnode_1/dndnode_0']
    await flushPromises()
    expect(wrapper.classes()).toContain('instance-node--simulated')
    results.scopeNodeIds = ['dndnode_2/dndnode_0']
    await flushPromises()
    expect(wrapper.classes()).not.toContain('instance-node--simulated')
  })

  it('asks for its context menu', async () => {
    mountNode()
    await wrapper.trigger('contextmenu', { clientX: 5, clientY: 7 })
    expect(wrapper.emitted('open-context-menu')).toEqual([[{ clientX: 5, clientY: 7, id: 'dndnode_1' }]])
  })
})

describe('InterfaceNode', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  // The tooltip directive, as a data attribute to read.
  const tooltip = { mounted: (el, { value }) => (el.dataset.tooltip = value?.value ?? '') }
  const render = (node, data = node.data) => mount(InterfaceNode, { props: { id: node.id, data }, global: { directives: { tooltip } } })
  const rows = (wrapper) => wrapper.findAll('.interface-port-list li')

  beforeEach(async () => {
    setActivePinia(createPinia())
    await flow.fromObject(graph())
  })

  it('names its super-module and lists the ports its exposure edges expose, with generic handles', () => {
    const node = flow.findNode('sm_1')
    const wrapper = render(node, { ...node.data, handles: [{ uid: 'h1', side: 'left', name: '', variant: 'ghost' }] })
    expect(wrapper.find('.interface-name').text()).toBe('heart')
    expect(rows(wrapper).map((row) => row.find('.interface-port-label').text())).toEqual(['vessel'])
    expect(wrapper.findAll('.handle-stub')).toHaveLength(1)
  })

  it('badges each port with its type', () => {
    const wrapper = render(flow.findNode('sm_1'))
    expect(rows(wrapper)[0].find('.interface-port-type').text()).toBe('I')
    expect(rows(wrapper)[0].find('.interface-port-index').exists()).toBe(false)
  })

  it('gives the child, type and variables on hover, and with its label as its accessible name', () => {
    const row = rows(render(flow.findNode('sm_1')))[0]
    expect(row.attributes('data-tooltip')).toBe('lv · entrance · v_in, u')
    expect(row.attributes('aria-label')).toBe('vessel — lv · entrance · v_in, u')
  })

  it('numbers ports of the same label, so they read apart', async () => {
    const a = module('dndnode_0', 'lv', { scope: 'sm_1', ports: [{ ...IN }] })
    const b = module('dndnode_3', 'rv', { scope: 'sm_1', ports: [{ ...IN }, port('exit_ports', 'out', ['v'])] })
    const edges = exposures('sm_1', [
      exposed('xp_a', 'dndnode_0', 'entrance_ports', 'vessel'),
      exposed('xp_b', 'dndnode_3', 'entrance_ports', 'vessel'),
      exposed('xp_c', 'dndnode_3', 'exit_ports', 'out'),
    ])
    await flow.fromObject({ nodes: [supermodule('sm_1', 'heart'), a, b], edges })
    const list = rows(render(flow.findNode('sm_1')))
    expect(list.map((row) => row.find('.interface-port-index').exists() && row.find('.interface-port-index').text())).toEqual(['1', '2', false])
    expect(list.map((row) => row.find('.interface-port-type').text())).toEqual(['I', 'I', 'O'])
    expect(list.map((row) => row.attributes('aria-label'))).toEqual(['vessel1 — lv · entrance · v_in, u', 'vessel2 — rv · entrance · v_in, u', 'out — rv · exit · v'])
  })

  it('says when nothing is exposed yet', () => {
    const wrapper = render(supermodule('sm_2', 'lung'))
    expect(wrapper.find('.interface-name').text()).toBe('lung')
    expect(wrapper.find('.interface-ports').text()).toBe('No exposed ports yet')
  })
})
