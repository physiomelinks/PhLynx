import { reactive, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBioEdits } from '../../../src/composables/useBioEdits.js'
import { dropSites, planSiteBind } from '../../../src/services/bioView/drop.js'
import { getBuiltInPieceTemplate } from '../../../src/services/bioView/pieces/builtInTemplates.js'
import { relabelPiece, removePieces } from '../../../src/services/bioView/pieces/edits.js'
import { layoutPieces } from '../../../src/services/bioView/pieces/layout.js'
import { validatePieces } from '../../../src/services/bioView/pieces/model.js'
import { resolveBioRole } from '../../../src/services/bioView/roles.js'
import { useBioPiecesStore } from '../../../src/stores/bioPiecesStore.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'

const nodes = ref([])
const removals = []

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges: ref([]),
    findNode: (id) => nodes.value.find((node) => node.id === id),
    findEdge: () => undefined,
    removeNodes: (ids) => {
      const going = [...ids]
      const removed = nodes.value.filter((node) => going.includes(node.id))
      nodes.value = nodes.value.filter((node) => !going.includes(node.id))
      // As the diagram's history records a removal.
      removals.push(removed)
    },
    updateNodeData: (id, update, { replace = false } = {}) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (!node) return
      const patch = typeof update === 'function' ? update(node) : update
      node.data = replace ? patch : { ...node.data, ...patch }
    },
  }),
}))

const node = (id, bioView) => reactive({ id, data: { name: id, ...(bioView && { bioView }) } })
const bioView = (id) => nodes.value.find((n) => n.id === id).data.bioView

describe('physiological view edits', () => {
  let history, pieces, edits

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    pieces = useBioPiecesStore()
    nodes.value = []
    edits = useBioEdits()
  })

  const epithelial = () => getBuiltInPieceTemplate('epithelial-cell')
  const valid = (raw) => validatePieces(raw).pieces

  /** Places the epithelial cell's pieces and binds a protein and a process card to them, as one undo step. */
  async function placeAndBind() {
    await edits.placePiecesTemplate(epithelial(), { x: 10, y: 20 })
    nodes.value = [
      node('p', { role: 'membraneProtein', site: 'pieces/plasma-membrane.apical', order: 0, skin: 'pump' }),
      node('card', { role: 'cytosolic', site: 'pieces/metabolism', order: 1, position: { x: 1, y: 2 } }),
      node('other', { role: 'region' }),
    ]
  }

  it('renames an instance as the diagram does, as one step, refusing a name another has', async () => {
    nodes.value = [node('a'), node('b')]
    expect(edits.nameError('a', 'b')).toMatch(/already exists/)
    expect(await edits.renameInstance('a', 'b')).toMatch(/already exists/)
    expect(nodes.value[0].data.name).toBe('a')

    expect(await edits.renameInstance('a', ' Na pump! ')).toBeNull()
    expect(nodes.value[0].data.name).toBe('Na_pump')
    expect(history.canUndo).toBe(true)
    // A blank name, or the same one, is no step.
    expect(await edits.renameInstance('a', '  ')).toBeNull()
    expect(await edits.renameInstance('a', 'Na_pump')).toBeNull()

    await history.undo()
    expect(nodes.value[0].data.name).toBe('a')
    expect(history.canUndo).toBe(false)
  })

  it('places a template’s pieces as one step, which undo removes and redo puts back', async () => {
    expect(await edits.placePiecesTemplate(epithelial(), { x: 10.3, y: 19.7 })).toEqual([])
    expect(pieces.pieces.map((piece) => piece.id)).toEqual(epithelial().pieces.map((piece) => piece.id))
    expect(history.undoLabel).toBe('Add template')

    await history.undo()
    expect(pieces.pieces).toEqual([])
    expect(history.canUndo).toBe(false)

    await history.redo()
    expect(pieces.pieces).toHaveLength(epithelial().pieces.length)
  })

  it('places a second copy beside the first, under ids of its own', async () => {
    await edits.placePiecesTemplate(epithelial(), { x: 0, y: 0 })
    await edits.placePiecesTemplate(epithelial(), { x: 800, y: 0 })
    expect(pieces.pieces).toHaveLength(2 * epithelial().pieces.length)
    expect(new Set(pieces.pieces.map((piece) => piece.id)).size).toBe(pieces.pieces.length)
  })

  it('edits the pieces as one step, which undo takes back', async () => {
    await placeAndBind()
    const before = pieces.pieces
    expect(await edits.editPieces(valid(relabelPiece(before, 'cell', 'Enterocyte')), 'bio-pieces-rename')).toBe(true)
    expect(pieces.pieces.find((piece) => piece.id === 'cell').label).toBe('Enterocyte')
    expect(history.undoLabel).toBe('Rename piece')
    await history.undo()
    expect(pieces.pieces).toBe(before)
    await history.redo()
    expect(pieces.pieces.find((piece) => piece.id === 'cell').label).toBe('Enterocyte')
  })

  it('removes a piece, deleting what was on what goes, as one step', async () => {
    await placeAndBind()
    nodes.value.push(node('wall', { site: 'pieces/plasma-membrane' }))
    const { pieces: raw } = removePieces(pieces.pieces, ['plasma-membrane'])
    const next = valid(raw)
    expect(edits.strandedBy(next).map((n) => n.id)).toEqual(['p', 'wall'])
    expect(await edits.editPieces(next, 'bio-pieces-remove')).toBe(true)
    expect(removals.at(-1).map((n) => n.id)).toEqual(['p', 'wall'])
    expect(nodes.value.map((n) => n.id)).toEqual(['card', 'other'])
    expect(bioView('card').site).toBe('pieces/metabolism')
    expect(history.undoLabel).toBe('Remove piece')
    await history.undo()
    expect(pieces.pieces.some((piece) => piece.id === 'plasma-membrane')).toBe(true)
  })

  it('unbinds a module whose span an edit takes away, keeping its piece', async () => {
    await placeAndBind()
    const next = valid(
      pieces.pieces.map((piece) =>
        piece.id === 'plasma-membrane'
          ? {
              ...piece,
              sides: Object.fromEntries(
                Object.entries(piece.sides).map(([side, spans]) => [
                  side,
                  spans.map((span) => (span.id === 'apical' ? { ...span, site: false } : span)),
                ]),
              ),
            }
          : piece,
      ),
    )
    expect(edits.strandedBy(next).map((n) => n.id)).toEqual(['p'])
    const removed = removals.length
    expect(await edits.editPieces(next, 'bio-pieces-edit')).toBe(true)
    expect(removals).toHaveLength(removed)
    expect(bioView('p')).toEqual({ skin: 'pump' })
  })

  it('adds a module dropped on an occupied site and deletes the occupant as one step', async () => {
    await placeAndBind()
    nodes.value.push(node('lumen', { role: 'region', site: 'pieces/apical-fluid' }))
    const roles = new Map(nodes.value.map((n) => [n.id, resolveBioRole(n.data)]))
    const { places, sites } = layoutPieces(pieces.pieces, { nodes: nodes.value })
    const site = dropSites(sites).find((target) => target.ref === 'pieces/apical-fluid')
    expect(site.occupant).toBe('lumen')

    // As BioFlow's addModuleAt does: the occupant deleted, then the new instance and its binding, in one batch.
    history.startBatch()
    const lumen = nodes.value.find((n) => n.id === 'lumen')
    nodes.value = nodes.value.filter((n) => n !== lumen)
    history.addCommand({ type: 'remove', undo: () => nodes.value.push(lumen), redo: () => {} })
    const added = node('saline', { role: 'region', facet: null })
    nodes.value.push(added)
    history.addCommand({
      type: 'add',
      undo: () => nodes.value.splice(nodes.value.indexOf(added), 1),
      redo: () => nodes.value.push(added),
    })
    const bioViews = new Map(nodes.value.map((n) => [n.id, n.data.bioView]))
    const plan = planSiteBind({ id: 'saline', site, layout: places, roles, bioViews })
    // The occupant is the caller's to delete, never set loose.
    expect([...plan.keys()]).toEqual(['saline'])
    await edits.applyPlan(plan, 'bio-add')
    history.endBatch()

    expect(bioView('saline')).toEqual({ site: 'pieces/apical-fluid' })
    await history.undo()
    expect(nodes.value.some((n) => n.id === 'saline')).toBe(false)
    expect(bioView('lumen')).toEqual({ role: 'region', site: 'pieces/apical-fluid' })
    // The step before is placing the template.
    await history.undo()
    expect(pieces.pieces).toEqual([])
  })

  it('writes node bioViews and a change to the pieces as one step', async () => {
    await placeAndBind()
    const before = pieces.pieces
    const plan = new Map([['other', { role: 'region', rect: { x: 0, y: 0, width: 10, height: 10 } }]])
    const renamed = valid(relabelPiece(before, 'cell', 'Enterocyte'))
    await edits.applyPlan(
      plan,
      'bio-layout',
      pieces.edit(() => pieces.setPieces(renamed)),
    )
    await history.undo()
    expect(pieces.pieces).toBe(before)
    expect(bioView('other')).toEqual({ role: 'region' })
  })
})
