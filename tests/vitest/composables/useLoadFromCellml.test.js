import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  currentNodes: { value: [{ id: 'existing' }] },
  addNodes: vi.fn(),
  clearWorkspace: vi.fn(),
  trackEvent: vi.fn(),
  prepareLayout: vi.fn(),
  useWorkflowLayout: vi.fn(),
  buildWorkflowGraph: vi.fn(),
  notify: { info: vi.fn(), error: vi.fn() },
  store: {
    assignGlobalConstant: vi.fn(),
    addModule: vi.fn(),
    availableModules: ['available'],
    getMathAnalysis: 'analysis',
    getMathDefaults: 'defaults',
  },
  history: { startBatch: vi.fn(), endBatch: vi.fn() },
  order: [],
}))

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ nodes: mocks.currentNodes, addNodes: mocks.addNodes }),
}))
vi.mock('../../../src/stores/libraryStore', () => ({ useLibraryStore: () => mocks.store }))
vi.mock('../../../src/stores/historyStore', () => ({ useFlowHistoryStore: () => mocks.history }))
vi.mock('../../../src/utils/notify', () => ({ notify: mocks.notify }))
vi.mock('../../../src/composables/useGtm', () => ({ useGtm: () => ({ trackEvent: mocks.trackEvent }) }))
vi.mock('../../../src/composables/useClearWorkspace', () => ({
  useClearWorkspace: () => ({ clearWorkspace: mocks.clearWorkspace }),
}))
vi.mock('../../../src/composables/useWorkflowLayout', () => ({
  useWorkflowLayout: (opts) => {
    mocks.useWorkflowLayout(opts)
    return { prepareLayout: mocks.prepareLayout }
  },
}))
vi.mock('../../../src/services/import/buildWorkflow', () => ({ buildWorkflowGraph: mocks.buildWorkflowGraph }))

import { useLoadFromCellML } from '../../../src/composables/useLoadFromCellml.js'
import { useWorkspaceAppearanceStore } from '../../../src/stores/workspaceAppearanceStore.js'

const mod = (name, vars = []) => ({ name, variables: vars })

describe('useLoadFromCellML', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    mocks.order.length = 0
    mocks.clearWorkspace.mockResolvedValue(undefined)
    mocks.prepareLayout.mockResolvedValue(undefined)
    mocks.buildWorkflowGraph.mockReturnValue({ pendingInstances: [{ id: 'n1' }], pendingEdges: [{ id: 'e1' }] })
  })

  it('clears the workspace without recording history, then notifies and stops when there are no edges', async () => {
    const { loadFromCellML } = useLoadFromCellML()

    await loadFromCellML({ components: ['a'], modules: [mod('a')], edges: [] }, 'model.cellml')

    expect(mocks.clearWorkspace).toHaveBeenCalledWith({ recordHistory: false })
    expect(mocks.notify.info).toHaveBeenCalledWith({
      title: 'No Connections Found',
      message: 'model.cellml contains no inter-component connections.',
    })
    expect(mocks.store.addModule).not.toHaveBeenCalled()
    expect(mocks.addNodes).not.toHaveBeenCalled()
    expect(mocks.prepareLayout).not.toHaveBeenCalled()
    expect(mocks.trackEvent).not.toHaveBeenCalled()
  })

  it('treats a payload with missing edges as having no connections', async () => {
    const { loadFromCellML } = useLoadFromCellML()

    await loadFromCellML({}, 'x.cellml')

    expect(mocks.notify.info).toHaveBeenCalledTimes(1)
    expect(mocks.addNodes).not.toHaveBeenCalled()
  })

  it('passes fitViewParams to the layout composable', () => {
    const fitViewParams = { padding: 0.3 }
    useLoadFromCellML({ fitViewParams })
    expect(mocks.useWorkflowLayout).toHaveBeenCalledWith({ fitViewParams })
  })

  it('registers modules, builds instance refs from edges, adds nodes in a history batch and lays out', async () => {
    const { loadFromCellML } = useLoadFromCellML()
    const a = mod('a')
    const b = mod('b')
    const c = mod('c')
    const payload = {
      components: ['a', 'b', 'c'],
      modules: [a, b, c],
      edges: [
        { source: 'a', target: 'b' },
        { source: 'a', target: 'c' },
      ],
      cellmlModuleSubtype: 'sub',
    }

    mocks.prepareLayout.mockImplementation(async () => {
      mocks.order.push('layout-start')
    })
    mocks.addNodes.mockImplementation(() => mocks.order.push('addNodes'))
    mocks.history.startBatch.mockImplementation(() => mocks.order.push('start'))
    mocks.history.endBatch.mockImplementation(() => mocks.order.push('end'))

    await loadFromCellML(payload, 'model.cellml')

    expect(mocks.store.addModule.mock.calls.map((c) => c[0])).toEqual([a, b, c])
    expect(mocks.buildWorkflowGraph).toHaveBeenCalledWith(
      [
        { name: 'a', module_type: 'a', module_subtype: 'sub', out_instances: 'b c', inp_instances: '' },
        { name: 'b', module_type: 'b', module_subtype: 'sub', out_instances: '', inp_instances: 'a' },
        { name: 'c', module_type: 'c', module_subtype: 'sub', out_instances: '', inp_instances: 'a' },
      ],
      ['available'],
      'analysis',
      mocks.currentNodes.value,
      null,
      'defaults'
    )
    expect(mocks.prepareLayout).toHaveBeenCalledWith([{ id: 'e1', data: {} }])
    expect(mocks.addNodes).toHaveBeenCalledWith([{ id: 'n1' }])
    expect(mocks.order).toEqual(['layout-start', 'start', 'addNodes', 'end'])
    expect(mocks.trackEvent).toHaveBeenCalledWith('cellml_connection_load', {
      category: 'CellML',
      action: 'load_from_cellml_connections',
      label: 'Components: 3, Edges: 2',
      file_type: 'cellml',
    })
  })

  it('gives the new edges the default appearance for new connections', async () => {
    useWorkspaceAppearanceStore().setConnectionDefaults({ width: 'thick' })
    const { loadFromCellML } = useLoadFromCellML()

    await loadFromCellML({ components: ['a', 'b'], modules: [mod('a'), mod('b')], edges: [{ source: 'a', target: 'b' }] }, 'f')

    expect(mocks.prepareLayout).toHaveBeenCalledWith([{ id: 'e1', data: { appearance: { width: 'thick' } } }])
  })

  it('awaits the layout before tracking the load event', async () => {
    const { loadFromCellML } = useLoadFromCellML()
    let resolveLayout
    mocks.prepareLayout.mockReturnValue(new Promise((r) => (resolveLayout = r)))

    const p = loadFromCellML({ components: ['a', 'b'], modules: [mod('a'), mod('b')], edges: [{ source: 'a', target: 'b' }] }, 'f')
    await new Promise((r) => setTimeout(r, 0))
    expect(mocks.addNodes).toHaveBeenCalled()
    expect(mocks.trackEvent).not.toHaveBeenCalled()

    resolveLayout()
    await p
    expect(mocks.trackEvent).toHaveBeenCalledTimes(1)
  })

  it('drops parameter components, edges touching them, and components left without edges', async () => {
    const { loadFromCellML } = useLoadFromCellML()
    const a = mod('a')
    const b = mod('b')
    const orphan = mod('orphan')
    const params = mod('model_parameters')

    await loadFromCellML(
      {
        components: ['a', 'b', 'orphan', 'model_parameters'],
        modules: [a, b, orphan, params],
        edges: [
          { source: 'a', target: 'b' },
          { source: 'model_parameters', target: 'a' },
          { source: 'b', target: 'model_parameters' },
        ],
      },
      'f'
    )

    expect(mocks.store.addModule.mock.calls.map((c) => c[0])).toEqual([a, b])
    const refs = mocks.buildWorkflowGraph.mock.calls[0][0]
    expect(refs.map((r) => r.name)).toEqual(['a', 'b'])
    expect(refs[0].inp_instances).toBe('')
    expect(refs[1].out_instances).toBe('')
    expect(mocks.trackEvent.mock.calls[0][1].label).toBe('Components: 2, Edges: 1')
  })

  it('applies local constants and global constant types from parameterData and registers globals', async () => {
    const { loadFromCellML } = useLoadFromCellML()
    const a = mod('a', [
      { name: ' k ', value: '1', data_reference: 'old' },
      { name: 'G', value: '2' },
      { name: 'free', value: '3' },
      { name: 'keep', value: '4', data_reference: 'ref' },
    ])
    const b = mod('b')

    await loadFromCellML(
      { components: ['a', 'b'], modules: [a, b], edges: [{ source: 'a', target: 'b' }] },
      'f',
      {
        parameters: { a: [{ name: 'k', value: ' 9 ', data_reference: ' d ' }, { name: 'keep' }] },
        globalParameters: [{ name: 'G', value: '5', units: 'mM', data_reference: 'gref' }],
      }
    )

    expect(a.variables).toEqual([
      { name: ' k ', value: '9', data_reference: 'd', type: 'constant' },
      { name: 'G', value: '2', type: 'global_constant' },
      { name: 'free', value: '3' },
      { name: 'keep', value: '4', data_reference: 'ref', type: 'constant' },
    ])
    expect(mocks.store.assignGlobalConstant).toHaveBeenCalledWith('G', '5', 'mM', 'gref')
  })

  it('leaves variables untouched and registers no globals when parameterData is null', async () => {
    const { loadFromCellML } = useLoadFromCellML()
    const a = mod('a', [{ name: 'k', value: '1' }])

    await loadFromCellML({ components: ['a', 'b'], modules: [a, mod('b')], edges: [{ source: 'a', target: 'b' }] }, 'f')

    expect(a.variables).toEqual([{ name: 'k', value: '1' }])
    expect(mocks.store.assignGlobalConstant).not.toHaveBeenCalled()
  })

  it('ends the history batch even when addNodes throws, then notifies and rethrows', async () => {
    const { loadFromCellML } = useLoadFromCellML()
    mocks.addNodes.mockImplementation(() => {
      throw new Error('boom')
    })

    await expect(
      loadFromCellML({ components: ['a', 'b'], modules: [mod('a'), mod('b')], edges: [{ source: 'a', target: 'b' }] }, 'f')
    ).rejects.toThrow('boom')

    expect(mocks.history.startBatch).toHaveBeenCalledTimes(1)
    expect(mocks.history.endBatch).toHaveBeenCalledTimes(1)
    expect(mocks.notify.error).toHaveBeenCalledWith({ message: 'Failed to load CellML connections: boom' })
    expect(mocks.trackEvent).not.toHaveBeenCalled()
  })

  it('notifies and rethrows when clearing the workspace fails', async () => {
    const { loadFromCellML } = useLoadFromCellML()
    mocks.clearWorkspace.mockRejectedValue(new Error('clear failed'))

    await expect(loadFromCellML({ edges: [{ source: 'a', target: 'b' }] }, 'f')).rejects.toThrow('clear failed')

    expect(mocks.notify.error).toHaveBeenCalledWith({ message: 'Failed to load CellML connections: clear failed' })
    expect(mocks.addNodes).not.toHaveBeenCalled()
  })
})
