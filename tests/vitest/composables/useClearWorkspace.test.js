import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useClearWorkspace } from '../../../src/composables/useClearWorkspace.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useAnnotationStore } from '../../../src/stores/annotationStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { useSessionMetadataStore } from '../../../src/stores/sessionMetadataStore.js'
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

  it('resets the annotation store, keeps library sidecars, and undo brings the annotation state back', async () => {
    const libraryStore = useLibraryStore()
    const annotationStore = useAnnotationStore()
    const historyStore = useFlowHistoryStore()
    libraryStore.setModuleAnnotations('math:1', '# sidecar')
    annotationStore.addInstanceSource({ location: 'apicoords.ttl', text: '# coords' })
    annotationStore.dismissSuggestion('a|b|x')
    const before = annotationStore.getState()

    const { clearWorkspace } = useClearWorkspace()
    await clearWorkspace()
    expect(annotationStore.getState()).toEqual({ instanceSources: [], dismissedSuggestions: [] })
    expect(libraryStore.getModuleAnnotations('math:1')).toBe('# sidecar')

    await historyStore.undo()
    expect(annotationStore.getState()).toEqual(before)
  })
})
