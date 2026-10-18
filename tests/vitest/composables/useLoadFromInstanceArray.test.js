import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  addNodes: vi.fn(),
  addEdges: vi.fn(),
  importCaModuleArray: vi.fn(),
  layoutSupermoduleScopes: vi.fn(),
  clearWorkspace: vi.fn(),
  trackEvent: vi.fn(),
  prepareLayout: vi.fn(),
  buildWorkflowGraph: vi.fn(),
  notify: { error: vi.fn(), warning: vi.fn() },
  store: { availableModules: ['available'], getMathAnalysis: 'analysis', getMathDefaults: 'defaults' },
  history: { startBatch: vi.fn(), endBatch: vi.fn() },
}))

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ nodes: { value: [] }, addNodes: mocks.addNodes, addEdges: mocks.addEdges }),
}))
vi.mock('../../../src/stores/libraryStore', () => ({ useLibraryStore: () => mocks.store }))
vi.mock('../../../src/stores/historyStore', () => ({ useFlowHistoryStore: () => mocks.history }))
vi.mock('../../../src/utils/notify', () => ({ notify: mocks.notify }))
vi.mock('../../../src/composables/useGtm', () => ({ useGtm: () => ({ trackEvent: mocks.trackEvent }) }))
vi.mock('../../../src/composables/useClearWorkspace', () => ({
  useClearWorkspace: () => ({ clearWorkspace: mocks.clearWorkspace }),
}))
vi.mock('../../../src/composables/useWorkflowLayout', () => ({
  useWorkflowLayout: () => ({ prepareLayout: mocks.prepareLayout }),
}))
vi.mock('../../../src/services/import/buildWorkflow', () => ({ buildWorkflowGraph: mocks.buildWorkflowGraph }))
vi.mock('../../../src/services/import/caFold', () => ({ importCaModuleArray: mocks.importCaModuleArray }))
vi.mock('../../../src/services/layouts/scopes', () => ({ layoutSupermoduleScopes: mocks.layoutSupermoduleScopes }))

import { useLoadFromInstanceArray } from '../../../src/composables/useLoadFromInstanceArray.js'

describe('useLoadFromInstanceArray', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.clearWorkspace.mockResolvedValue(undefined)
    mocks.prepareLayout.mockResolvedValue(undefined)
  })

  it('warns about the connections left out for want of a free port slot, and adds the rest', async () => {
    const pendingInstances = [{ id: 'a' }, { id: 'b' }]
    mocks.buildWorkflowGraph.mockReturnValue({ pendingInstances, pendingEdges: [], conflicts: ['a → b: no slot.'] })

    await useLoadFromInstanceArray().loadFromInstanceArray({ instances: [] })

    expect(mocks.notify.warning).toHaveBeenCalledWith({ title: 'Connections Not Made', items: ['a → b: no slot.'], sticky: true })
    expect(mocks.addNodes).toHaveBeenCalledWith(pendingInstances)
  })

  it("builds the graph with circulatory_autogen's rules", async () => {
    mocks.buildWorkflowGraph.mockReturnValue({ pendingInstances: [], pendingEdges: [], conflicts: [] })

    await useLoadFromInstanceArray().loadFromInstanceArray({ instances: [] })

    expect(mocks.buildWorkflowGraph).toHaveBeenCalledWith([], ['available'], 'analysis', [], null, 'defaults', { caRules: true })
  })

  it("returns the hearts whose ivc flow CA's rule zeroed, for the parameters load to keep", async () => {
    mocks.buildWorkflowGraph.mockReturnValue({ pendingInstances: [], pendingEdges: [], conflicts: [], ivcZeroedHearts: ['heart'] })

    await expect(useLoadFromInstanceArray().loadFromInstanceArray({ instances: [] })).resolves.toEqual({ ivcZeroedHearts: ['heart'], parametersApplied: false })
  })

  it('warns once about the deprecated junction types the module array uses', async () => {
    mocks.buildWorkflowGraph.mockReturnValue({ pendingInstances: [], pendingEdges: [], conflicts: [] })
    const instances = [
      { name: 'j1', module_type: 'Min_junction' },
      { name: 'j2', module_type: 'Min_junction' },
      { name: 'j3', module_type: 'MinNout_junction' },
      { name: 'v', module_type: 'venous' },
    ]

    await useLoadFromInstanceArray().loadFromInstanceArray({ instances })

    expect(mocks.notify.warning).toHaveBeenCalledTimes(1)
    expect(mocks.notify.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Deprecated Junction Types',
        items: [expect.stringMatching(/^Min_junction, MinNout_junction are circulatory_autogen/)],
      })
    )
  })

  it('warns about nothing when every connection is made', async () => {
    mocks.buildWorkflowGraph.mockReturnValue({ pendingInstances: [], pendingEdges: [], conflicts: [] })

    await useLoadFromInstanceArray().loadFromInstanceArray({ instances: [] })

    expect(mocks.notify.warning).not.toHaveBeenCalled()
  })
  it('imports a module array with super-modules as super instances, its parameters applied', async () => {
    const loader = vi.fn()
    Object.assign(mocks.store, {
      availableSupermodules: new Map([['heart:v1', {}]]),
      caVariants: new Map(),
      caParameterLoader: () => loader,
      assignGlobalConstant: vi.fn(),
    })
    const nodes = [
      { id: 'dndnode_0', data: { scope: null }, hidden: false },
      { id: 'sm_0', data: { scope: 'sm_0' }, hidden: true },
      { id: 'sm_0~dndnode_0', data: { scope: 'sm_0' }, hidden: true },
    ]
    const rootEdge = { id: 'r', source: 'dndnode_0', target: 'dndnode_0' }
    const scopeEdge = { id: 's', source: 'sm_0~dndnode_0', target: 'sm_0' }
    mocks.importCaModuleArray.mockReturnValue({
      nodes,
      edges: [rootEdge, scopeEdge],
      globals: [{ name: 'R', value: '8', units: 'J', data_reference: 'ref' }],
      conflicts: [],
      skipped: [{ nodeName: 'heart_lv', name: 'q' }],
      warnings: ['forked'],
      positioned: new Set(['sm_9']),
    })
    const instances = [{ name: 'heart', module_type: 'heart', module_subtype: 'v1' }]
    const parameters = [{ variable_name: 'heart/lv/E', value: '1' }]

    const result = await useLoadFromInstanceArray().loadFromInstanceArray({ instances, parameters, source: 'a.json' })

    expect(result).toEqual({ ivcZeroedHearts: [], parametersApplied: true })
    expect(mocks.buildWorkflowGraph).not.toHaveBeenCalled()
    expect(mocks.importCaModuleArray).toHaveBeenCalledWith(instances, expect.objectContaining({ supermodules: mocks.store.availableSupermodules }), {
      source: 'a.json',
      load: loader,
      hostRows: parameters,
      currentNodes: [],
    })
    expect(mocks.store.assignGlobalConstant).toHaveBeenCalledWith('R', '8', 'J', 'ref')
    // Set after the clear, which resets the global constants.
    expect(mocks.clearWorkspace.mock.invocationCallOrder[0]).toBeLessThan(mocks.store.assignGlobalConstant.mock.invocationCallOrder[0])
    // A super-module whose config gave its layout keeps it.
    expect(mocks.layoutSupermoduleScopes).toHaveBeenCalledWith(nodes, [rootEdge, scopeEdge], { keep: new Set(['sm_9']) })
    expect(mocks.addNodes).toHaveBeenCalledWith(nodes)
    expect(mocks.addEdges).toHaveBeenCalledWith([scopeEdge])
    expect(mocks.prepareLayout).toHaveBeenCalledWith([rootEdge], null)
    expect(mocks.notify.warning).toHaveBeenCalledWith(expect.objectContaining({ items: ['forked'], sticky: true }))
    expect(mocks.notify.warning).toHaveBeenCalledWith(expect.objectContaining({ title: 'Some Parameters Not Applied', items: [expect.stringContaining('heart_lv.q')] }))
    delete mocks.store.availableSupermodules
  })

  it('leaves the workspace as it was when the module array cannot be built, and leaves the report to the caller', async () => {
    Object.assign(mocks.store, { availableSupermodules: new Map([['heart:v1', {}]]), caParameterLoader: () => vi.fn(), assignGlobalConstant: vi.fn() })
    mocks.importCaModuleArray.mockImplementation(() => {
      throw new Error('a.json: "heart" names host "x", which is not in the module array.')
    })

    await expect(
      useLoadFromInstanceArray().loadFromInstanceArray({ instances: [{ name: 'heart', module_type: 'heart', module_subtype: 'v1' }] })
    ).rejects.toThrow('names host "x"')

    expect(mocks.clearWorkspace).not.toHaveBeenCalled()
    expect(mocks.addNodes).not.toHaveBeenCalled()
    expect(mocks.store.assignGlobalConstant).not.toHaveBeenCalled()
    expect(mocks.notify.error).not.toHaveBeenCalled()
    delete mocks.store.availableSupermodules
  })
})
