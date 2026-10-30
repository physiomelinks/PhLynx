// @vitest-environment happy-dom
import { defineComponent, h, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nodes = ref([])
const edges = ref([])
const flow = { addEdges: vi.fn(), removeEdges: vi.fn() }
let connectHandler
const confirm = vi.fn()

vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm }) }))
vi.mock('../../../src/utils/layout', () => ({ waitUntilStable: () => Promise.resolve() }))
vi.mock('@vue-flow/core', async (importOriginal) => {
  const { computed } = await import('vue')
  const findNode = (id) => nodes.value.find((node) => node.id === id)
  return {
    ...(await importOriginal()),
    useVueFlow: () => ({
      nodes,
      edges,
      getNodes: nodes,
      getSelectedNodes: computed(() => nodes.value.filter((node) => node.selected)),
      findNode,
      updateNodeData: (id, update, options = { replace: false }) => {
        const node = findNode(id)
        if (!node) return
        const patch = typeof update === 'function' ? update(node) : update
        node.data = options.replace ? patch : { ...node.data, ...patch }
      },
      updateNodeInternals: vi.fn(),
      addEdges: flow.addEdges,
      removeEdges: flow.removeEdges,
      addNodes: vi.fn(),
      removeNodes: vi.fn(),
      updateNode: vi.fn(),
      screenToFlowCoordinate: (position) => position,
      setViewport: vi.fn(),
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
      onConnect: (handler) => {
        connectHandler = handler
      },
      onConnectEnd: vi.fn(),
      onDragLeave: vi.fn(),
      onNodeChange: vi.fn(),
      onEdgeChange: vi.fn(),
      onNodesInitialized: vi.fn(),
    }),
  }
})

const { default: MacroBuilderDialog } = await import('../../../src/components/MacroBuilderDialog.vue')

const Passthrough = defineComponent({
  setup(_, { slots }) {
    return () => h('div', [slots.header?.(), slots.default?.(), slots.footer?.()])
  },
})

function mountDialog() {
  return mount(MacroBuilderDialog, {
    props: { modelValue: true },
    global: {
      plugins: [PrimeVue],
      directives: { tooltip: {} },
      stubs: {
        Dialog: Passthrough,
        ResizableLibraryPanel: Passthrough,
        LibraryArea: true,
        Menubar: true,
        ConfirmDialog: true,
        VueFlow: true,
      },
    },
  })
}

const handle = (uid) => ({ uid, side: 'right', variant: 'default' })
const connection = { source: 'a', target: 'b', sourceHandle: 'handle_hs2', targetHandle: 'handle_ht2' }

describe('MacroBuilderDialog, connecting a pair that is already connected', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    nodes.value = [
      { id: 'a', data: { handles: [handle('hs1'), handle('hs2')] } },
      { id: 'b', data: { handles: [handle('ht1'), handle('ht2')] } },
    ]
    edges.value = [{ id: 'macro-a-b', source: 'a', target: 'b', sourceHandle: 'handle_hs1', targetHandle: 'handle_ht1' }]
    mountDialog()
  })

  it('asks, and on Cancel drops only the pending edge', async () => {
    confirm.mockResolvedValue(false)

    await connectHandler(connection)
    await flushPromises()

    expect(confirm).toHaveBeenCalledOnce()
    expect(flow.removeEdges.mock.calls).toEqual([['pending--a--b']])
    expect(flow.addEdges.mock.calls.map(([edge]) => edge.id)).toEqual(['pending--a--b'])
  })

  it('on Replace swaps the old edge for the new one', async () => {
    confirm.mockResolvedValue(true)

    await connectHandler(connection)
    await flushPromises()

    expect(flow.removeEdges.mock.calls).toEqual([['pending--a--b'], ['macro-a-b']])
    expect(flow.addEdges.mock.calls.map(([edge]) => edge.id)).toEqual(['pending--a--b', 'macro-a-b'])
  })
})
