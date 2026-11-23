import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useClearWorkspace } from '../../../src/composables/useClearWorkspace.js'
import { useDefaultParametersStore } from '../../../src/stores/defaultParametersStore.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { getBuiltInPieceTemplate } from '../../../src/services/bioView/pieces/builtInTemplates.js'
import { useBioPiecesStore } from '../../../src/stores/bioPiecesStore.js'
import { useSkinLibraryStore } from '../../../src/stores/skinLibraryStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { useSessionMetadataStore } from '../../../src/stores/sessionMetadataStore.js'
import { useWorkspaceAppearanceStore } from '../../../src/stores/workspaceAppearanceStore.js'
import { DEFAULT_PROJECT_NAME } from '../../../src/utils/constants.js'

vi.mock('@vue-flow/core', async (importOriginal) => {
  const actual = await importOriginal()

  return {
    ...actual,
    useVueFlow: () => ({
      nodes: ref([]),
      edges: ref([]),
      setViewport: vi.fn(),
      getViewport: () => ({ x: 0, y: 0, zoom: 1 }),
    }),
  }
})

const SET = {
  ref: 'NKA',
  source: { file: 'NKA_parameters.json', importedAt: 'now' },
  globals: new Map(),
  values: new Map([['K', { value: '1', units: 'mM', data_reference: '', extra: {} }]]),
}

describe('useClearWorkspace', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('clears only the workspace-scoped global constants and keeps session metadata intact', async () => {
    const libraryStore = useLibraryStore()
    const historyStore = useFlowHistoryStore()
    const sessionMetadataStore = useSessionMetadataStore()
    libraryStore.addMath('math:1', 'x = 1')
    libraryStore.addModule({
      moduleRef: 'module-1',
      mathRef: 'math:1',
      componentFile: 'component-1',
      name: 'Demo model',
    })
    libraryStore.assignGlobalConstant('gNa', 1, 'nS', 'data-ref-1')
    sessionMetadataStore.setLastSaveName('imported-archive')

    const { clearWorkspace } = useClearWorkspace()
    await clearWorkspace({ recordHistory: false })

    const state = libraryStore.getState()
    expect(state.availableMath).toEqual([['math:1', 'x = 1']])
    expect(state.availableModules).toEqual([
      ['module-1', { mathRef: 'math:1', componentFile: 'component-1', name: 'Demo model', moduleRef: 'module-1' }],
    ])
    expect(state.globalConstants).toEqual([])
    expect(sessionMetadataStore.lastSaveName).toBe(DEFAULT_PROJECT_NAME)
    expect(historyStore.canUndo).toBe(false)
    expect(historyStore.canRedo).toBe(false)
  })

  it('keeps the parameter sets on a clear without history, as a load replaces them itself', async () => {
    const parameters = useDefaultParametersStore()
    parameters.addSet(SET, { mathRef: 'NKA.cellml:NKA' })

    await useClearWorkspace().clearWorkspace({ recordHistory: false })
    expect(parameters.getSet('NKA.cellml:NKA', 'NKA')).not.toBeNull()
  })

  it('clears the parameter sets, and undo brings them back', async () => {
    const parameters = useDefaultParametersStore()
    const history = useFlowHistoryStore()
    parameters.addSet(SET, { mathRef: 'NKA.cellml:NKA' })

    await useClearWorkspace().clearWorkspace()
    expect(parameters.getState().sets).toEqual([])

    await history.undo()
    expect(parameters.getSet('NKA.cellml:NKA', 'NKA').values.get('K').value).toBe('1')
  })

  it('resets the pieces and their skins, and undo brings them back', async () => {
    const bioPiecesStore = useBioPiecesStore()
    const historyStore = useFlowHistoryStore()
    bioPiecesStore.addTemplate(getBuiltInPieceTemplate('epithelial-cell'), { x: 10, y: 20 })
    const skinStore = useSkinLibraryStore()
    skinStore.addSvg('art.svg', '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect/></svg>', {
      appliesTo: ['cytosol'],
    })
    const before = bioPiecesStore.getState()
    const skins = skinStore.snapshot()

    const { clearWorkspace } = useClearWorkspace()
    await clearWorkspace()
    expect(bioPiecesStore.getState()).toBeNull()
    expect(skinStore.definitions.size).toBe(0)

    await historyStore.undo()
    expect(bioPiecesStore.getState()).toEqual(before)
    expect(skinStore.snapshot()).toEqual(skins)

    await historyStore.redo()
    expect(bioPiecesStore.getState()).toBeNull()
  })

  it('undoes a clear so that an earlier edit to the pieces can still be undone', async () => {
    const bioPiecesStore = useBioPiecesStore()
    const historyStore = useFlowHistoryStore()
    const add = bioPiecesStore.edit(() => bioPiecesStore.addTemplate(getBuiltInPieceTemplate('cell'), { x: 0, y: 0 }))
    add.apply()

    const { clearWorkspace } = useClearWorkspace()
    await clearWorkspace()
    await historyStore.undo()

    expect(add.isAt('after')).toBe(true)
  })

  it('resets the default for new connections, and undo brings it back', async () => {
    const appearance = useWorkspaceAppearanceStore()
    const history = useFlowHistoryStore()
    appearance.setConnectionDefaults({ width: 'thick' })

    const { clearWorkspace } = useClearWorkspace()
    await clearWorkspace()
    history.startBatch()
    history.endBatch()
    expect(appearance.isDefault).toBe(true)

    await history.undo()
    expect(appearance.connectionDefaults).toEqual({ width: 'thick' })
  })
})
