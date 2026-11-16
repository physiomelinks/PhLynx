// @vitest-environment happy-dom
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { reactive, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useSidecarImport } from '../../../src/composables/useSidecarImport.js'
import { notify } from '../../../src/utils/notify'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'

const nodes = ref([])
const edges = ref([])
const confirm = vi.fn()

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges,
    findNode: (id) => nodes.value.find((node) => node.id === id),
    findEdge: (id) => edges.value.find((edge) => edge.id === id),
    updateNodeData: (id, update, options = { replace: false }) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (!node) return
      const patch = typeof update === 'function' ? update(node) : update
      node.data = options.replace ? patch : { ...node.data, ...patch }
    },
  }),
}))
vi.mock('../../../src/composables/useConfirmDialog', () => ({ useConfirmDialog: () => ({ confirm }) }))
vi.mock('../../../src/utils/notify', () => ({
  notify: Object.assign(vi.fn(), { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() }),
}))

const TOY = resolve(__dirname, '../fixtures/annotations/toy')
const read = (name) => readFileSync(resolve(TOY, name), 'utf8')
const POOL = 'pool.cellml:pool'
const sidecarFile = { name: 'pool.ttl', text: read('pool.ttl'), mathRef: POOL }

describe('useSidecarImport', () => {
  let history, library, importSidecars

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    library = useLibraryStore()
    library.addMath(POOL, read('pool.cellml'))
    confirm.mockReset()
    nodes.value = [
      reactive({
        id: 'lumen',
        data: { name: 'lumen', mathRef: POOL, variables: ['c_A', 'v_A', 'volume', 'area'].map((name) => ({ name })), ports: [] },
      }),
    ]
    edges.value = []
    ;({ importSidecars } = useSidecarImport())
  })

  it('annotates the module, adds annotated ports to its instances, and undoes as one step', async () => {
    expect(await importSidecars([sidecarFile, { name: 'stray.ttl', text: 'x', mathRef: 'stray.cellml:stray' }])).toBe(1)
    expect(library.getModuleAnnotations(POOL)).toBe(sidecarFile.text)
    expect(nodes.value[0].data.ports.length).toBeGreaterThan(0)
    // The parse couplings are driven from stays in place.
    expect(library.getParsedModuleAnnotations(POOL)).not.toBeNull()
    expect(confirm).not.toHaveBeenCalled()

    await history.undo()
    expect(library.getModuleAnnotations(POOL)).toBeNull()
    expect(nodes.value[0].data.ports).toEqual([])

    await history.redo()
    expect(library.getModuleAnnotations(POOL)).toBe(sidecarFile.text)
  })

  it('asks before replacing a module’s annotations, and leaves them on cancel', async () => {
    library.setModuleAnnotations(POOL, `${sidecarFile.text}\n# older`)
    confirm.mockResolvedValue(false)
    expect(await importSidecars([sidecarFile])).toBe(0)
    expect(confirm).toHaveBeenCalledOnce()
    expect(library.getModuleAnnotations(POOL)).toMatch(/# older$/)
  })

  it('lists the terms whose ids don’t fit, and then those OLS doesn’t know, never changing them', async () => {
    const lookup = vi.fn(async () => null)
    ;({ importSidecars } = useSidecarImport(undefined, { lookup }))
    const text = sidecarFile.text.replace('opb:00154', 'opb:0006096').replace('chebi:29101', 'chebi:99999999')
    expect(await importSidecars([{ ...sidecarFile, text }])).toBe(1)
    expect(library.getModuleAnnotations(POOL)).toBe(text)
    expect(notify.warning).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Annotations Imported',
        message: expect.stringContaining('pool.ttl: volume: OPB:0006096 doesn’t fit OPB’s ids, such as OPB:00340'),
      })
    )
    await vi.waitFor(() =>
      expect(notify.warning).toHaveBeenCalledWith({
        title: 'Unknown Ontology Terms',
        message: expect.stringContaining('pool.ttl: c_A: OLS has no term CHEBI:99999999'),
      })
    )
    expect(lookup.mock.calls.map(([curie]) => curie)).toEqual(['CHEBI:99999999'])
  })

  it('changes nothing when no file matches a module', async () => {
    expect(await importSidecars([{ name: 'stray.ttl', text: 'x', mathRef: null }])).toBe(0)
    expect(library.moduleAnnotations.size).toBe(0)
    expect(history.canUndo).toBe(false)
  })
})
