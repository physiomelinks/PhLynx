import { reactive, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBioEdits } from '../../../src/composables/useBioEdits.js'
import { useBioTemplateStore } from '../../../src/stores/bioTemplateStore.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'

const nodes = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges: ref([]),
    findNode: (id) => nodes.value.find((node) => node.id === id),
    findEdge: () => undefined,
    updateNodeData: (id, patch, { replace = false } = {}) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (node) node.data = replace ? patch : { ...node.data, ...patch }
    },
  }),
}))

const node = (id, bioView) => reactive({ id, data: { name: id, ...(bioView && { bioView }) } })
const bioView = (id) => nodes.value.find((n) => n.id === id).data.bioView

describe('physiological view edits', () => {
  let history, templates, edits

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    templates = useBioTemplateStore()
    nodes.value = []
    edits = useBioEdits()
  })

  /** Places the epithelial template and binds a protein and a process card to it, as one undo step. */
  async function placeAndBind() {
    await edits.placeTemplate('epithelial-cell', { x: 10, y: 20 })
    const id = templates.instances[0].id
    nodes.value = [
      node('p', { role: 'membraneProtein', site: `${id}/cell.apical`, order: 0, glyph: 'pump' }),
      node('card', { role: 'cytosolic', site: `${id}/cell.metabolism`, order: 1, position: { x: 1, y: 2 } }),
      node('other', { role: 'region' }),
    ]
    return id
  }

  it('places a template as one step, which undo removes and redo puts back', async () => {
    expect(await edits.placeTemplate('epithelial-cell', { x: 10, y: 20 })).toBe(true)
    expect(templates.instances).toEqual([expect.objectContaining({ template: 'epithelial-cell', at: { x: 10, y: 20 } })])
    expect(templates.definitions.has('epithelial-cell')).toBe(true)

    await history.undo()
    expect(templates.instances).toEqual([])
    expect(templates.definitions.size).toBe(0)
    expect(history.canUndo).toBe(false)

    await history.redo()
    expect(templates.instances).toHaveLength(1)
  })

  it('places and moves templates by whole flow units', async () => {
    await edits.placeTemplate('epithelial-cell', { x: 10.30000000000001, y: 19.7 })
    const id = templates.instances[0].id
    expect(templates.getInstance(id).at).toEqual({ x: 10, y: 20 })
    expect(await edits.moveTemplate(id, { x: 0.4, y: -0.2 })).toBe(false)
    await edits.moveTemplate(id, { x: 2.6, y: 0 })
    expect(templates.getInstance(id).at).toEqual({ x: 13, y: 20 })
  })

  it('places nothing for a template it doesn’t know', async () => {
    expect(await edits.placeTemplate('nope', { x: 0, y: 0 })).toBe(false)
    expect(history.canUndo).toBe(false)
  })

  it('moves an instance as one step, and records nothing for no move', async () => {
    const id = await placeAndBind()
    expect(await edits.moveTemplate(id, { x: 0, y: 0 })).toBe(false)
    expect(await edits.moveTemplate(id, { x: 5, y: -5 })).toBe(true)
    expect(templates.getInstance(id).at).toEqual({ x: 15, y: 15 })

    await history.undo()
    expect(templates.getInstance(id).at).toEqual({ x: 10, y: 20 })
    // The next step back is placing it.
    await history.undo()
    expect(templates.instances).toEqual([])
    expect(history.canUndo).toBe(false)
  })

  it('renames an instance as one step, skipping a name it already has', async () => {
    const id = await placeAndBind()
    expect(await edits.renameTemplate(id, '  ')).toBe(false)
    expect(await edits.renameTemplate(id, 'Proximal tubule')).toBe(true)
    expect(templates.getInstance(id).label).toBe('Proximal tubule')
    await history.undo()
    expect(templates.getInstance(id).label).toBeUndefined()
  })

  it('re-lays out what is bound to an instance, keeping its sites', async () => {
    const id = await placeAndBind()
    expect(await edits.relayoutTemplate(id)).toBe(true)
    expect(bioView('p')).toEqual({ role: 'membraneProtein', site: `${id}/cell.apical`, glyph: 'pump' })
    expect(bioView('card')).toEqual({ role: 'cytosolic', site: `${id}/cell.metabolism` })
    expect(bioView('other')).toEqual({ role: 'region' })
  })

  it('removes an instance and unbinds what was bound to it in one step, which undo puts back', async () => {
    const id = await placeAndBind()
    expect(await edits.removeTemplate(id)).toBe(true)
    expect(templates.instances).toEqual([])
    expect(bioView('p')).toEqual({ role: 'membraneProtein', glyph: 'pump', facet: null })
    expect(bioView('card')).toEqual({ role: 'cytosolic', position: { x: 1, y: 2 } })

    await history.undo()
    expect(templates.getInstance(id)).toMatchObject({ template: 'epithelial-cell' })
    expect(templates.definitions.has('epithelial-cell')).toBe(true)
    expect(bioView('p')).toEqual({ role: 'membraneProtein', site: `${id}/cell.apical`, order: 0, glyph: 'pump' })
    expect(bioView('card').site).toBe(`${id}/cell.metabolism`)

    await history.redo()
    expect(templates.instances).toEqual([])
    expect(bioView('p').site).toBeUndefined()
  })

  it('writes node bioViews and a template move as one step', async () => {
    const id = await placeAndBind()
    const plan = new Map([['other', { role: 'region', rect: { x: 0, y: 0, width: 10, height: 10 } }]])
    await edits.applyPlan(plan, 'bio-layout', edits.templateMoves(new Map([[id, { x: 1, y: 1 }]])))
    await history.undo()
    expect(templates.getInstance(id).at).toEqual({ x: 10, y: 20 })
    expect(bioView('other')).toEqual({ role: 'region' })
  })
})
