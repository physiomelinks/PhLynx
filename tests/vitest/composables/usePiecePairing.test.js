import { nextTick, reactive, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { usePiecePairing } from '../../../src/composables/usePiecePairing.js'
import { useBioPiecesStore } from '../../../src/stores/bioPiecesStore.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'

const nodes = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    findNode: (id) => nodes.value.find((node) => node.id === id),
    updateNodeData: (id, update, { replace = false } = {}) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (node) node.data = replace ? update : { ...node.data, ...update }
    },
  }),
}))

/** Waits out the history's batching timer. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 60))

const node = (id, mathRef, bioView) => reactive({ id, data: { name: id, mathRef, ...(bioView && { bioView }) } })

describe('usePiecePairing', () => {
  let history, pieces, pairing

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    pieces = useBioPiecesStore()
    const library = useLibraryStore()
    // A compartment's sidecar for 'lumen.cellml', none for the rest.
    vi.spyOn(library, 'getParsedModuleAnnotations').mockImplementation((mathRef) =>
      mathRef === 'lumen.cellml:lumen' ? { component: { kind: 'compartment' } } : null,
    )
    nodes.value = []
    pairing = usePiecePairing()
  })

  it('gives a compartment’s module added on no piece a compartment, in the step that added it', async () => {
    const lumen = node('lumen', 'lumen.cellml:lumen', { position: { x: 10, y: 20 } })
    nodes.value = [lumen, node('pump', 'pump.cellml:pump')]
    history.addCommand({
      type: 'add',
      undo: () => (nodes.value = nodes.value.filter((n) => n !== lumen)),
      redo: () => {},
    })
    await nextTick()

    expect(pieces.pieces).toHaveLength(1)
    expect(pieces.pieces[0]).toMatchObject({ kind: 'compartment', label: 'lumen', frame: { x: 10, y: 20 } })
    expect(lumen.data.bioView).toEqual({ site: `pieces/${pieces.pieces[0].id}` })

    await settle()
    expect(history.pointerIndex).toBe(0)
    await history.undo()
    expect(pieces.pieces).toEqual([])
    expect(nodes.value.map((n) => n.id)).toEqual(['pump'])
  })

  it('leaves what an undo puts back as it was', async () => {
    const lumen = node('lumen', 'lumen.cellml:lumen')
    nodes.value = [lumen]
    await nextTick()
    await settle()
    expect(pieces.pieces).toHaveLength(1)

    await history.undo()
    await nextTick()
    await settle()
    // Owed again, but by the history's doing: no compartment is made, and redo is still there.
    expect(pieces.pieces).toEqual([])
    expect(history.canRedo).toBe(true)
  })

  it('makes no step, and gives none meanwhile, while paused', async () => {
    await pairing.whilePaused(async () => {
      nodes.value = [node('lumen', 'lumen.cellml:lumen')]
      await nextTick()
      expect(pieces.pieces).toEqual([])
      expect(pairing.giveCompartments(['lumen'], { record: false })).toBe(true)
    })
    await settle()
    expect(pieces.pieces).toHaveLength(1)
    expect(history.canUndo).toBe(false)
  })
})
