import { describe, expect, it } from 'vitest'

import { dropTargets, patchBioView, planRelayout, planSlotDrop, planUnplace } from '../../../../src/services/bioView/drop.js'
import { layoutBioView } from '../../../../src/services/bioView/layout.js'

const role = (role, extra = {}) => ({ role, facet: null, cell: null, side: null, glyph: null, ...extra })

/** A cell with a, b, c on its apical facet, d on its basolateral facet, and a loose card. */
function epithelium() {
  const nodes = ['cell', 'a', 'b', 'c', 'd', 'card'].map((id) => ({ id, data: { name: id } }))
  const roles = new Map([
    ['cell', role('cytosol')],
    ['a', role('membraneProtein', { cell: 'cell', facet: 'apical' })],
    ['b', role('membraneProtein', { cell: 'cell', facet: 'apical' })],
    ['c', role('membraneProtein', { cell: 'cell', facet: 'apical' })],
    ['d', role('membraneProtein', { cell: 'cell', facet: 'basolateral' })],
    ['card', role('none')],
  ])
  const layout = layoutBioView(nodes, roles)
  const bioViews = new Map(nodes.map((n) => [n.id, n.data.bioView]))
  return { layout, roles, bioViews }
}

describe('dropping in the physiological view', () => {
  it('offers each cell’s slots with how many proteins each facet has', () => {
    const { layout } = epithelium()
    expect(dropTargets(layout)).toEqual([{ id: 'cell', rect: layout.get('cell').rect, counts: { apical: 3, basolateral: 1, lateral: 0 } }])
  })

  it('moves a protein to another facet, closing up the one it left', () => {
    const { layout, roles, bioViews } = epithelium()
    const plan = planSlotDrop({ id: 'a', slot: { cellId: 'cell', facet: 'basolateral', order: 0 }, layout, roles, bioViews })
    expect(Object.fromEntries(plan)).toEqual({
      b: { order: 0 },
      c: { order: 1 },
      a: { order: 0, cell: 'cell', facet: 'basolateral' },
      d: { order: 1 },
    })
  })

  it('reorders within a facet', () => {
    const { layout, roles, bioViews } = epithelium()
    const plan = planSlotDrop({ id: 'c', slot: { cellId: 'cell', facet: 'apical', order: 0 }, layout, roles, bioViews })
    expect(['c', 'a', 'b'].map((id) => plan.get(id).order)).toEqual([0, 1, 2])
  })

  it('makes anything dropped into a membrane a membrane protein', () => {
    const { layout, roles, bioViews } = epithelium()
    const plan = planSlotDrop({ id: 'card', slot: { cellId: 'cell', facet: 'lateral', order: 0 }, layout, roles, bioViews })
    expect(plan.get('card')).toEqual({ order: 0, cell: 'cell', facet: 'lateral', role: 'membraneProtein' })
  })

  it('takes a protein out of its membrane to where it was dropped', () => {
    const { layout, bioViews } = epithelium()
    const plan = planUnplace({ id: 'b', position: { x: -300, y: 40 }, layout, bioViews })
    expect(Object.fromEntries(plan)).toEqual({ a: { order: 0 }, c: { order: 1 }, b: { facet: null, position: { x: -300, y: 40 } } })
  })

  it('lays out again, keeping only the user’s role and glyph', () => {
    const bioViews = new Map([
      ['a', { role: 'membraneProtein', glyph: 'pump', facet: 'lateral', order: 2 }],
      ['b', { glyph: 'channel' }],
      ['c', undefined],
      ['cell', { rect: { x: 0, y: 0, width: 1, height: 1 } }],
    ])
    expect(Object.fromEntries(planRelayout(bioViews))).toEqual({ a: { role: 'membraneProtein', glyph: 'pump' }, cell: {} })
  })

  it('drops fields set to undefined when patching', () => {
    expect(patchBioView({ facet: 'apical', order: 1 }, { order: undefined, cell: 'x' })).toEqual({ facet: 'apical', cell: 'x' })
  })
})
