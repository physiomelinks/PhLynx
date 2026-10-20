// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { FLOW_IDS, HANDLE_VARIANT } from '../../../src/utils/constants.js'
import { module, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'

// The nodes are drawn in the workspace's own flow, as inside its VueFlow.
vi.mock('@vue-flow/core', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    Handle: { name: 'Handle', props: ['id'], template: '<div class="handle-stub" :data-handle-id="id"><slot /></div>' },
    useVueFlow: (id) => actual.useVueFlow(id ?? 'main-flow-editor'),
  }
})
vi.mock('@vue-flow/node-resizer', () => ({ NodeResizer: { name: 'NodeResizer', template: '<div />' } }))

const { useVueFlow } = await import('@vue-flow/core')
const { useCanvasLevel } = await import('../../../src/composables/useCanvasLevel.js')
const { useFlowHistoryStore } = await import('../../../src/stores/historyStore.js')
const { default: InstanceNode } = await import('../../../src/components/InstanceNode.vue')
const { default: SuperInstanceNode } = await import('../../../src/components/SuperInstanceNode.vue')
const { default: InterfaceNode } = await import('../../../src/components/InterfaceNode.vue')

// One used handle on the right and one ghost on the left; ids are `handle_${uid}`.
const handles = () => [
  { uid: 'used', side: 'right', name: '', slotIndex: 0, variant: HANDLE_VARIANT.DEFAULT },
  { uid: 'ghost', side: 'left', name: '', slotIndex: 0, variant: HANDLE_VARIANT.GHOST },
]

function graph() {
  const lv = module('dndnode_0', 'lv', { data: { handles: handles() } })
  const sm = supermodule('sm_1', 'heart')
  sm.data.handles = handles()
  const left = superInstance({ nodes: [sm], edges: [] }, 'dndnode_1', 'left', 'sm_1')
  left.data.handles = handles()
  const edge = { id: 'e1', source: 'dndnode_0', target: 'dndnode_1', sourceHandle: 'handle_used', targetHandle: 'handle_used' }
  const exposure = { id: 'e2', source: 'dndnode_0', target: 'sm_1', sourceHandle: 'handle_used', targetHandle: 'handle_used' }
  return { nodes: [lv, left, sm], edges: [edge, exposure] }
}

describe.each([
  ['InstanceNode', InstanceNode, 'dndnode_0', 'e1'],
  ['SuperInstanceNode', SuperInstanceNode, 'dndnode_1', 'e1'],
  ['InterfaceNode', InterfaceNode, 'sm_1', 'e2'],
])('%s handles', (_name, component, id, edgeId) => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const level = useCanvasLevel()
  let wrapper

  const mountNode = (props = {}) => {
    wrapper = mount(component, {
      props: { id, data: flow.findNode(id).data, ...props },
      global: { plugins: [PrimeVue, ConfirmationService], directives: { tooltip: {} } },
      attachTo: document.body,
    })
  }
  const handle = (uid) => wrapper.findAll('.handle-stub').find((el) => el.attributes('data-handle-id') === `handle_${uid}`)
  const variantOf = (uid) => flow.findNode(id).data.handles.find((h) => h.uid === uid).variant

  beforeEach(async () => {
    setActivePinia(createPinia())
    level.reset()
    await flow.fromObject(graph())
  })
  afterEach(() => {
    wrapper?.unmount()
    vi.useRealTimers()
  })

  it('renders every handle through NodeHandles', () => {
    mountNode()
    expect(wrapper.findComponent({ name: 'NodeHandles' }).exists()).toBe(true)
    expect(wrapper.findAll('.handle-stub')).toHaveLength(2)
  })

  it('activates a ghost handle on pointerdown', async () => {
    mountNode()
    await handle('ghost').trigger('pointerdown')
    await flushPromises()
    expect(variantOf('ghost')).toBe(HANDLE_VARIANT.DEFAULT)
  })

  it('keeps a corner ghost inert while the node is selected', async () => {
    mountNode({ selected: true })
    expect(handle('ghost').classes()).toContain('handle--inert')
    await handle('ghost').trigger('pointerdown')
    await flushPromises()
    expect(variantOf('ghost')).toBe(HANDLE_VARIANT.GHOST)
  })

  it('turns a used handle back into a ghost from its hover button, removing its edges, as one undo step', async () => {
    vi.useFakeTimers()
    mountNode()
    await handle('used').trigger('mouseenter')
    vi.advanceTimersByTime(1000)
    await flushPromises()
    await handle('used').find('[aria-label="Remove handle"]').trigger('click')
    await flushPromises()
    expect(variantOf('used')).toBe(HANDLE_VARIANT.GHOST)
    expect(flow.findEdge(edgeId)).toBeUndefined()

    await useFlowHistoryStore().undo()
    await flushPromises()
    expect(variantOf('used')).toBe(HANDLE_VARIANT.DEFAULT)
    expect(flow.findEdge(edgeId)).toBeDefined()
  })
})
