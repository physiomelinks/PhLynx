import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }))
const save = vi.hoisted(() => ({ legacyDownload: vi.fn(), saveFileHandle: vi.fn(), writeFileHandle: vi.fn() }))
const trackEvent = vi.hoisted(() => vi.fn())
const clearWorkspace = vi.hoisted(() => vi.fn())

vi.mock('../../../src/utils/notify', () => ({ notify }))
vi.mock('../../../src/utils/save', async (importOriginal) => ({ ...(await importOriginal()), ...save }))
vi.mock('../../../src/composables/useGtm', () => ({ useGtm: () => ({ trackEvent }) }))
vi.mock('../../../src/composables/useClearWorkspace', () => ({ useClearWorkspace: () => ({ clearWorkspace }) }))
vi.mock('@vue-flow/core', async (importOriginal) => ({ ...(await importOriginal()), useVueFlow: () => ({}) }))

import { useWorkspaceSaveLoad } from '../../../src/composables/useWorkspaceSaveLoad'
import { loadWorkspaceFile } from '../../../src/services/workspaceFile'
import { useDefaultParametersStore } from '../../../src/stores/defaultParametersStore'
import { useBioTemplateStore } from '../../../src/stores/bioTemplateStore'
import { useInspectionModuleStore } from '../../../src/stores/inspectionModuleStore'
import { useLibraryStore } from '../../../src/stores/libraryStore'
import { useOmexStore } from '../../../src/stores/omexStore'
import { useSessionMetadataStore } from '../../../src/stores/sessionMetadataStore'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore'
import { PHLYNX_PROJECT_IDENTIFIER, PHLYNX_PROJECT_VERSION } from '../../../src/utils/constants'

const FLOW = { nodes: [{ id: 'n1', position: { x: 1, y: 2 } }], edges: [], viewport: { x: 5, y: 6, zoom: 2 } }
const COLLECTIONS = [['parts.cellml', ['modA', 'modB']]]
const PARAM = { value: '1.0', units: 'mM', data_reference: '', extra: {} }

const nodes = ref([])
const edges = ref([])
let saveDialogVisible
let flow
let view

function setup() {
  saveDialogVisible = ref(false)
  flow = {
    toObject: vi.fn(() => FLOW),
    fromObject: vi.fn(),
    setViewport: vi.fn(),
    rebuildNodeEdgeIndex: vi.fn(),
    recomputeMissingCouplings: vi.fn(),
  }
  view = useWorkspaceSaveLoad({ saveDialogVisible, nodes, edges, ...flow })
}

const readBlob = async (blob) => JSON.parse(await blob.text())

/** Fills the saved stores with recognisable state. */
function fillStores() {
  useLibraryStore().loadState({ availableCollections: COLLECTIONS })
  useSimulationSettingsStore().setSimulationSettings({ endingPoint: 42, maxSteps: 77 })
  useInspectionModuleStore().addModule({ id: 'insp-1', name: 'Flow probe', units: 'mL', variables: [] })
  useOmexStore().setArchive({ archiveName: 'model.omex', cellmlFileName: 'model.cellml' })
  useDefaultParametersStore().addSet(
    { ref: 'NKA', source: { file: 'NKA_parameters.json', importedAt: 'now' }, globals: new Map(), values: new Map([['K', PARAM]]) },
    { mathRef: 'NKA.cellml:NKA' }
  )
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  nodes.value = []
  edges.value = []
  setup()
})

describe('onSaveConfirm', () => {
  it('downloads the workspace as JSON under the chosen name with a .json extension', async () => {
    fillStores()
    await view.onSaveConfirm('my-model')

    expect(save.legacyDownload).toHaveBeenCalledOnce()
    const [name, blob] = save.legacyDownload.mock.calls[0]
    expect(name).toBe('my-model.json')
    expect(blob.type).toBe('application/json')

    const saved = await readBlob(blob)
    expect(saved.id).toBe(PHLYNX_PROJECT_IDENTIFIER)
    expect(saved.version).toBe(PHLYNX_PROJECT_VERSION)
    expect(saved.flow).toEqual(FLOW)
    expect(saved.store.availableCollections).toEqual(COLLECTIONS)
    expect(saved.simulation.simulationSettings).toMatchObject({ endingPoint: 42, maxSteps: 77 })
    expect(saved).toHaveProperty('inspectionModules')
    expect(saved).toHaveProperty('workspace')
    expect(saved.parameters.sets.map(([key]) => key)).toEqual(['NKA.cellml:NKA:NKA'])
  })

  it('notifies and remembers the name', async () => {
    await view.onSaveConfirm('my-model')

    expect(notify.success).toHaveBeenCalledWith({ title: 'Workflow saved!' })
    expect(useSessionMetadataStore().lastSaveName).toBe('my-model')
  })

  it('falls back to the last save name for the file but stores the empty name given', async () => {
    const session = useSessionMetadataStore()
    session.setLastSaveName('earlier')
    await view.onSaveConfirm('')

    expect(save.legacyDownload.mock.calls[0][0]).toBe('earlier.json')
    expect(session.lastSaveName).toBe('')
  })
})

describe('handleSaveWorkspace', () => {
  it('offers the last save name, with .json, to the native picker', async () => {
    useSessionMetadataStore().setLastSaveName('earlier')
    save.saveFileHandle.mockResolvedValue({ status: true, handle: null })
    await view.handleSaveWorkspace()

    expect(save.saveFileHandle).toHaveBeenCalledWith('earlier.json', expect.any(Array))
  })

  it('writes the workspace to the picked file and records its name', async () => {
    fillStores()
    const handle = { name: 'picked.json' }
    save.saveFileHandle.mockResolvedValue({ status: true, handle })
    await view.handleSaveWorkspace()

    expect(save.writeFileHandle).toHaveBeenCalledOnce()
    const [writtenTo, blob] = save.writeFileHandle.mock.calls[0]
    expect(writtenTo).toBe(handle)
    const saved = await readBlob(blob)
    expect(saved.id).toBe(PHLYNX_PROJECT_IDENTIFIER)
    expect(saved.store.availableCollections).toEqual(COLLECTIONS)
    expect(useSessionMetadataStore().lastSaveName).toBe('picked.json')
    expect(notify.success).toHaveBeenCalledWith({ title: 'Workflow saved!' })
    expect(trackEvent).toHaveBeenCalledWith('save_action', {
      category: 'Save',
      action: 'save_workflow',
      label: 'File: picked.json',
      file_type: 'json',
    })
    expect(save.legacyDownload).not.toHaveBeenCalled()
    expect(saveDialogVisible.value).toBe(false)
  })

  it('does nothing when the user cancels the picker', async () => {
    save.saveFileHandle.mockResolvedValue({ status: true, handle: null })
    await view.handleSaveWorkspace()

    expect(save.writeFileHandle).not.toHaveBeenCalled()
    expect(notify.success).not.toHaveBeenCalled()
    expect(notify.error).not.toHaveBeenCalled()
    expect(saveDialogVisible.value).toBe(false)
  })

  it('opens the save dialog when the browser has no native picker', async () => {
    save.saveFileHandle.mockResolvedValue({ status: false, handle: null })
    await view.handleSaveWorkspace()

    expect(saveDialogVisible.value).toBe(true)
    expect(save.writeFileHandle).not.toHaveBeenCalled()
  })

  it('reports a write that throws, without remembering the name', async () => {
    save.saveFileHandle.mockResolvedValue({ status: true, handle: { name: 'picked.json' } })
    save.writeFileHandle.mockImplementation(() => {
      throw new Error('disk full')
    })
    await view.handleSaveWorkspace()

    expect(notify.error).toHaveBeenCalledWith({ title: 'Error Saving Workflow', message: 'disk full' })
    expect(notify.success).not.toHaveBeenCalled()
    expect(useSessionMetadataStore().lastSaveName).not.toBe('picked.json')
    expect(trackEvent).toHaveBeenCalledWith('save_action', {
      category: 'Save',
      action: 'save_workflow',
      label: 'Error: disk full',
      file_type: 'json',
    })
  })

  it('does not await the write, so a user abort inside it (resolves true) still reads as saved', async () => {
    save.saveFileHandle.mockResolvedValue({ status: true, handle: { name: 'picked.json' } })
    save.writeFileHandle.mockResolvedValue(true)
    await view.handleSaveWorkspace()

    expect(notify.success).toHaveBeenCalledWith({ title: 'Workflow saved!' })
    expect(notify.error).not.toHaveBeenCalled()
  })
})

describe('applyWorkspaceState', () => {
  it.each([[{}], [{ foo: 1 }], [{ flow: FLOW }], [{ store: {} }]])('rejects %j untouched', async (bad) => {
    fillStores()
    const before = {
      library: useLibraryStore().getState(),
      simulation: useSimulationSettingsStore().getState(),
    }

    await expect(view.applyWorkspaceState(bad)).rejects.toThrow('Invalid workflow file format.')

    expect(clearWorkspace).not.toHaveBeenCalled()
    expect(flow.fromObject).not.toHaveBeenCalled()
    expect(useLibraryStore().getState()).toEqual(before.library)
    expect(useSimulationSettingsStore().getState()).toEqual(before.simulation)
    expect(notify.success).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith(
      'workflow_load_action',
      expect.objectContaining({ label: 'Error: Invalid workflow file format.', file_type: 'json' })
    )
  })

  it('shows the Failed to load notification when applied through loadWorkspaceFile', async () => {
    const file = new File(['{"foo":1}'], 'bad.json', { type: 'application/json' })

    expect(await loadWorkspaceFile(file, view.applyWorkspaceState)).toBe(false)

    expect(notify.error).toHaveBeenCalledWith({
      title: 'Failed to load workflow',
      message: 'Invalid workflow file format.',
    })
  })

  it('restores a saved workspace into fresh stores', async () => {
    fillStores()
    await view.onSaveConfirm('round-trip')
    const saved = await readBlob(save.legacyDownload.mock.calls[0][1])

    setActivePinia(createPinia())
    setup()
    expect(useLibraryStore().getState().availableCollections).toEqual([])

    nodes.value = [{ id: 'n1' }]
    edges.value = []
    await view.applyWorkspaceState(saved, { source: 'file' })

    expect(clearWorkspace).toHaveBeenCalledWith({ recordHistory: false })
    expect(flow.setViewport).toHaveBeenCalledWith(FLOW.viewport)
    expect(flow.fromObject).toHaveBeenCalledWith(expect.objectContaining({ nodes: FLOW.nodes }))
    expect(flow.rebuildNodeEdgeIndex).toHaveBeenCalledOnce()
    expect(flow.recomputeMissingCouplings).toHaveBeenCalledOnce()
    expect(useLibraryStore().getState().availableCollections).toEqual(COLLECTIONS)
    expect(useSimulationSettingsStore().simulationSettings).toMatchObject({ endingPoint: 42, maxSteps: 77 })
    expect(saved.inspectionModules).toHaveLength(1)
    expect(useInspectionModuleStore().getState()).toEqual(saved.inspectionModules)
    expect(useInspectionModuleStore().getState()[0]).toMatchObject({ id: 'insp-1', name: 'Flow probe' })
    expect(saved.workspace.archiveName).toBe('model.omex')
    expect(useOmexStore().getState()).toEqual(saved.workspace)
    expect(useDefaultParametersStore().getSet('NKA.cellml:NKA', 'NKA').values.get('K')).toEqual(PARAM)
    expect(notify.success).toHaveBeenCalledWith({ title: 'Workflow loaded successfully!' })
    expect(trackEvent).toHaveBeenCalledWith('workflow_load_action', {
      category: 'Workflow',
      action: 'load_workflow',
      label: 'Nodes: 1, Edges: 0',
      file_type: 'file',
    })
  })

  it('round trips module sidecars', async () => {
    const sidecar = '@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .\n'
    const data = { name: 'cell' }
    const annotatedFlow = { ...FLOW, nodes: [{ id: 'n1', position: { x: 1, y: 2 }, data }] }
    flow.toObject.mockReturnValue(annotatedFlow)
    useLibraryStore().setModuleAnnotations('pool.cellml:pool', sidecar)
    await view.onSaveConfirm('annotated')
    const saved = await readBlob(save.legacyDownload.mock.calls[0][1])

    expect(saved.version).toBe(PHLYNX_PROJECT_VERSION)
    expect(saved.store.moduleAnnotations).toEqual([['pool.cellml:pool', sidecar]])

    setActivePinia(createPinia())
    setup()
    await view.applyWorkspaceState(saved)

    expect(flow.fromObject).toHaveBeenCalledWith(expect.objectContaining({ nodes: annotatedFlow.nodes }))
    expect(useLibraryStore().getModuleAnnotations('pool.cellml:pool')).toBe(sidecar)
  })

  it('saves a workspace without sidecars as before, and loading one empties the library sidecars', async () => {
    fillStores()
    await view.onSaveConfirm('plain')
    const saved = await readBlob(save.legacyDownload.mock.calls[0][1])
    expect(saved.store).not.toHaveProperty('moduleAnnotations')

    useLibraryStore().setModuleAnnotations('stale.cellml:stale', '# stale')
    await view.applyWorkspaceState(saved)
    expect(useLibraryStore().moduleAnnotations.size).toBe(0)
  })

  it('round trips placed templates and their embedded definitions', async () => {
    const bound = { ...FLOW, nodes: [{ id: 'n1', position: { x: 1, y: 2 }, data: { bioView: { site: '' } } }] }
    const instance = useBioTemplateStore().addInstance('two-cell-epithelium', { x: 30, y: 40 }, 'Sheet')
    bound.nodes[0].data.bioView.site = `${instance.id}/a.apical`
    flow.toObject.mockReturnValue(bound)
    await view.onSaveConfirm('templated')
    const saved = await readBlob(save.legacyDownload.mock.calls[0][1])

    expect(saved.version).toBe(PHLYNX_PROJECT_VERSION)
    expect(saved.bioTemplates.instances).toEqual([instance])
    expect(Object.keys(saved.bioTemplates.templates)).toEqual(['two-cell-epithelium'])
    // As if the built-in changed after this workspace was saved: the embedded copy must still win.
    saved.bioTemplates.templates['two-cell-epithelium'].name = 'Old sheet'

    setActivePinia(createPinia())
    setup()
    await view.applyWorkspaceState(saved)

    expect(flow.fromObject).toHaveBeenCalledWith(expect.objectContaining({ nodes: bound.nodes }))
    expect(useBioTemplateStore().getState()).toEqual(saved.bioTemplates)
    expect(useBioTemplateStore().getDefinition('two-cell-epithelium').name).toBe('Old sheet')
  })

  it('saves a workspace without templates without the key, and loading one empties the template store', async () => {
    fillStores()
    await view.onSaveConfirm('plain')
    const saved = await readBlob(save.legacyDownload.mock.calls[0][1])
    expect(saved).not.toHaveProperty('bioTemplates')

    useBioTemplateStore().addInstance('epithelial-cell', { x: 0, y: 0 })
    await view.applyWorkspaceState(saved)
    expect(useBioTemplateStore().getState()).toBeNull()
  })

  it('clears the workspace before it restores the flow', async () => {
    const order = []
    clearWorkspace.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      order.push('clear')
    })
    flow.fromObject.mockImplementation(() => order.push('fromObject'))
    await view.applyWorkspaceState({
      id: PHLYNX_PROJECT_IDENTIFIER,
      version: PHLYNX_PROJECT_VERSION,
      flow: FLOW,
      store: {},
    })

    expect(order).toEqual(['clear', 'fromObject'])
  })

  it('drops annotated ports on variables the math lacks, with their couplings, and says so', async () => {
    const stale = { portType: 'general_ports', variables: ['I_K'], multiportType: 'True', annotation: { subject: 's' } }
    const kept = { portType: 'general_ports', variables: ['x'], multiportType: 'True', annotation: { subject: 't' } }
    flow.fromObject.mockImplementation(() => {
      nodes.value = [{ id: 'n1', data: { name: 'pump', variables: [{ name: 'x' }], ports: [stale, kept] } }]
      const couplings = [{ sourcePort: stale, targetPort: kept }]
      edges.value = [{ id: 'e1', source: 'n1', target: 'n1', data: { couplings } }]
    })
    const state = { id: PHLYNX_PROJECT_IDENTIFIER, version: PHLYNX_PROJECT_VERSION, flow: FLOW, store: {} }
    await view.applyWorkspaceState(state)

    expect(nodes.value[0].data.ports).toEqual([kept])
    expect(edges.value[0].data.couplings).toEqual([])
    const message = expect.stringContaining('pump.I_K')
    expect(notify.warning).toHaveBeenCalledWith(expect.objectContaining({ message }))
  })

  it('migrates an older workspace before it applies it', async () => {
    await view.applyWorkspaceState({
      id: PHLYNX_PROJECT_IDENTIFIER,
      version: '1.1.0',
      flow: FLOW,
      store: {},
      simulation: { simulationSettings: { maxSteps: 99 } },
      inspectionModules: [],
      workspace: {},
    })

    // The 1.1.0 -> 1.2.0 step restores the solver settings older files were run with.
    expect(useSimulationSettingsStore().simulationSettings.maxSteps).toBe(500)
  })
})
