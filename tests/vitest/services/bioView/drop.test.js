import { describe, expect, it } from 'vitest'

import {
  dragCompanions,
  dropTargets,
  patchBioView,
  planCellMove,
  planRelayout,
  planSlotDrop,
  planUnplace,
} from '../../../../src/services/bioView/drop.js'
import { nearestSlot } from '../../../../src/services/bioView/geometry.js'
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
    expect(dropTargets(layout)).toEqual([
      {
        id: 'cell',
        rect: layout.get('cell').rect,
        counts: { apical: 3, basolateral: 1, 'lateral-left': 0, 'lateral-right': 0 },
        widths: layout.get('cell').widths,
      },
    ])
    // Each row's names, as drawn, so slots are where the proteins are.
    expect(layout.get('cell').widths.apical).toHaveLength(3)
  })

  it('moves a protein to another facet, closing up the one it left', () => {
    const { layout, roles, bioViews } = epithelium()
    const plan = planSlotDrop({ id: 'a', slot: { cellId: 'cell', part: 'basolateral', facet: 'basolateral', order: 0 }, layout, roles, bioViews })
    expect(Object.fromEntries(plan)).toEqual({
      b: { order: 0 },
      c: { order: 1 },
      a: { order: 0, cell: 'cell', facet: 'basolateral' },
      d: { order: 1 },
    })
  })

  it('reorders within a facet', () => {
    const { layout, roles, bioViews } = epithelium()
    const plan = planSlotDrop({ id: 'c', slot: { cellId: 'cell', part: 'apical', facet: 'apical', order: 0 }, layout, roles, bioViews })
    expect(['c', 'a', 'b'].map((id) => plan.get(id).order)).toEqual([0, 1, 2])
  })

  it('makes anything dropped into a membrane a membrane protein', () => {
    const { layout, roles, bioViews } = epithelium()
    const slot = { cellId: 'cell', part: 'lateral-right', facet: 'lateral', at: 'right', order: 0 }
    const plan = planSlotDrop({ id: 'card', slot, layout, roles, bioViews })
    // A lateral protein keeps the side it was dropped on.
    expect(plan.get('card')).toEqual({ order: 0, at: 'right', cell: 'cell', facet: 'lateral', role: 'membraneProtein' })
  })

  it('takes a protein out of its membrane to where it was dropped', () => {
    const { layout, bioViews } = epithelium()
    const plan = planUnplace({ id: 'b', position: { x: -300, y: 40 }, layout, bioViews })
    expect(Object.fromEntries(plan)).toEqual({ a: { order: 0 }, c: { order: 1 }, b: { facet: null, position: { x: -300, y: 40 } } })
  })

  it('leaves a dragged protein out of its own facet’s count, so its own place is one of the slots', () => {
    const { layout } = epithelium()
    expect(dropTargets(layout, 'b')[0].counts).toMatchObject({ apical: 2, basolateral: 1 })
    const { x, y } = layout.get('b')
    expect(nearestSlot(dropTargets(layout, 'b'), { x: x + 3, y: y + 2 })).toMatchObject({ part: 'apical', order: 1, x, y })
  })

  it('plans nothing when a protein is dropped back in its own slot', () => {
    const { layout, roles, bioViews } = epithelium()
    const slot = { cellId: 'cell', part: 'apical', facet: 'apical', order: 1 }
    expect(planSlotDrop({ id: 'b', slot, layout, roles, bioViews }).size).toBe(0)
  })

  it('saves where a protein was taken out to in whole flow units', () => {
    const { layout, bioViews } = epithelium()
    const plan = planUnplace({ id: 'b', position: { x: -300.4, y: 40.6 }, layout, bioViews })
    expect(plan.get('b').position).toEqual({ x: -300, y: 41 })
  })

  it('lays out again, keeping only the user’s role and glyph', () => {
    const bioViews = new Map([
      ['a', { role: 'membraneProtein', glyph: 'pump', facet: 'lateral', at: 'left', order: 2 }],
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

describe('dropping without moving untouched lateral proteins', () => {
  /** A cell with four lateral proteins that have no side yet, so layout shares them out. */
  function lateralCell() {
    const nodes = ['cell', 'A', 'B', 'C', 'D'].map((id) => ({ id, data: { name: id } }))
    const roles = new Map([
      ['cell', role('cytosol')],
      ...['A', 'B', 'C', 'D'].map((id) => [id, role('membraneProtein', { cell: 'cell', facet: 'lateral' })]),
    ])
    return { nodes, roles, layout: layoutBioView(nodes, roles), bioViews: new Map(nodes.map((n) => [n.id, undefined])) }
  }

  /** Lays out again with a plan applied, the way the resolver would read it back. */
  function sidesAfter({ nodes, roles }, plan) {
    const next = nodes.map((n) => ({ ...n, data: { ...n.data, bioView: plan.has(n.id) ? plan.get(n.id) : n.data.bioView } }))
    const nextRoles = new Map(
      [...roles].map(([id, r]) => {
        const bioView = plan.get(id)
        if (!bioView) return [id, r]
        return [id, { ...r, facet: bioView.facet === null ? null : (bioView.facet ?? r.facet), at: bioView.at ?? null }]
      })
    )
    const layout = layoutBioView(next, nextRoles)
    return Object.fromEntries(['A', 'B', 'C', 'D'].map((id) => [id, layout.get(id).part ?? layout.get(id).kind]))
  }

  it('keeps every other lateral protein on its side when one moves to another facet', () => {
    const cell = lateralCell()
    const before = Object.fromEntries(['B', 'C', 'D'].map((id) => [id, cell.layout.get(id).part]))
    const plan = planSlotDrop({ id: 'A', slot: { cellId: 'cell', part: 'apical', facet: 'apical', order: 0 }, ...cell })
    const after = sidesAfter(cell, plan)
    expect(after.A).toBe('apical')
    expect({ B: after.B, C: after.C, D: after.D }).toEqual(before)
  })

  it('keeps every other lateral protein on its side when one is taken out of the membrane', () => {
    const cell = lateralCell()
    const before = Object.fromEntries(['B', 'C', 'D'].map((id) => [id, cell.layout.get(id).part]))
    const plan = planUnplace({ id: 'A', position: { x: -300, y: 0 }, layout: cell.layout, bioViews: cell.bioViews })
    const after = sidesAfter(cell, plan)
    expect(after.A).toBe('tray')
    expect({ B: after.B, C: after.C, D: after.D }).toEqual(before)
  })
})

describe('dropping a new protein from the library', () => {
  it('leaves the other lateral proteins on their sides when it lands on a lateral slot', () => {
    // b_A and c_B have no side; a_X is new, made outside any membrane, and sorts first by name.
    const nodes = ['cell', 'b_A', 'c_B', 'a_X'].map((id) => ({ id, data: { name: id } }))
    const roles = new Map([
      ['cell', role('cytosol')],
      ['b_A', role('membraneProtein', { cell: 'cell', facet: 'lateral' })],
      ['c_B', role('membraneProtein', { cell: 'cell', facet: 'lateral' })],
      ['a_X', role('membraneProtein')],
    ])
    const layout = layoutBioView(nodes, roles)
    expect(layout.get('a_X').kind).toBe('tray')
    const sides = { b_A: layout.get('b_A').part, c_B: layout.get('c_B').part }

    const slot = { cellId: 'cell', part: 'lateral-right', facet: 'lateral', at: 'right', order: 1 }
    const plan = planSlotDrop({ id: 'a_X', slot, layout, roles, bioViews: new Map() })
    const at = (id) => `lateral-${plan.get(id).at}`
    expect({ b_A: at('b_A'), c_B: at('c_B') }).toEqual(sides)
    expect(plan.get('a_X')).toMatchObject({ cell: 'cell', facet: 'lateral', at: 'right', order: 1 })
  })
})

describe('dragging a structure or a part', () => {
  /** A hand-added cell with a card kept at its own place, a region against it alone and one against nothing. */
  function handAdded() {
    const nodes = [
      { id: 'cell', data: { name: 'cell', bioView: { role: 'cytosol', added: true, rect: { x: 0, y: 0, width: 400, height: 300 } } } },
      { id: 'p', data: { name: 'p' } },
      { id: 'kept', data: { name: 'kept', bioView: { role: 'cytosolic', cell: 'cell', position: { x: 40, y: 120 } } } },
      { id: 'laid', data: { name: 'laid' } },
      { id: 'lumen', data: { name: 'lumen', bioView: { role: 'region', rect: { x: -80, y: -200, width: 560, height: 140 } } } },
      { id: 'blood', data: { name: 'blood' } },
      { id: 'free', data: { name: 'free', bioView: { role: 'region', rect: { x: 0, y: 900, width: 300, height: 140 } } } },
    ]
    const against = (facet) => [{ cell: 'cell', facet }]
    const roles = new Map([
      ['cell', role('cytosol')],
      ['p', role('membraneProtein', { cell: 'cell', facet: 'apical' })],
      ['kept', role('cytosolic', { cell: 'cell' })],
      ['laid', role('cytosolic', { cell: 'cell' })],
      ['lumen', role('region', { adjacent: against('apical') })],
      ['blood', role('region', { adjacent: against('basolateral') })],
      ['free', role('region')],
    ])
    const layout = layoutBioView(nodes, roles)
    const bioViews = new Map(nodes.map((n) => [n.id, n.data.bioView]))
    return { layout, bioViews }
  }

  it('takes the regions against only a hand-added cell along, but not its own children or parts', () => {
    const { layout } = handAdded()
    expect(dragCompanions(layout, { id: 'cell', type: 'bioCell' }).sort()).toEqual(['blood', 'lumen'])
    // Its outline stands for the cell.
    layout.set('wall', { kind: 'membrane', cell: 'cell' })
    expect(dragCompanions(layout, { id: 'wall', type: 'bioMembrane' }).sort()).toEqual(['blood', 'lumen'])
    // Parts, and a node-owned region, move alone.
    for (const [id, type] of [['p', 'bioProtein'], ['kept', 'bioCard'], ['lumen', 'bioRegion'], ['free', 'bioRegion']]) {
      expect(dragCompanions(layout, { id, type })).toEqual([])
    }
  })

  it('takes a template’s other pieces and its name along, from any of its handles', () => {
    const layout = new Map([
      ['tpl:bt-1/cell', { kind: 'cell', instance: 'bt-1', rect: {} }],
      ['tpl:bt-1/lumen', { kind: 'region', instance: 'bt-1', rect: {} }],
      ['cyto', { kind: 'cell', instance: 'bt-1', rect: {} }],
      ['pump', { kind: 'protein', instance: 'bt-1', cell: 'cyto' }],
      ['wall', { kind: 'membrane', instance: 'bt-1', cell: 'cyto' }],
      ['tpl:bt-2/cell', { kind: 'cell', instance: 'bt-2', rect: {} }],
    ])
    expect(dragCompanions(layout, { id: 'tpl:bt-1/lumen', type: 'bioRegion' })).toEqual(['tpl:bt-1/cell', 'cyto', 'tpl:bt-1'])
    expect(dragCompanions(layout, { id: 'wall', type: 'bioMembrane' })).toEqual(['tpl:bt-1/cell', 'tpl:bt-1/lumen', 'tpl:bt-1'])
    expect(dragCompanions(layout, { id: 'tpl:bt-1', type: 'bioTemplateTitle', data: { instance: 'bt-1' } })).toEqual([
      'tpl:bt-1/cell',
      'tpl:bt-1/lumen',
      'cyto',
    ])
    expect(dragCompanions(layout, { id: 'pump', type: 'bioProtein' })).toEqual([])
  })

  it('shifts a moved cell’s kept cards and regions with it, leaving laid-out ones to follow', () => {
    const { layout, bioViews } = handAdded()
    const plan = planCellMove({ id: 'cell', delta: { x: 100.4, y: -50 }, layout, bioViews })
    expect([...plan.keys()].sort()).toEqual(['kept', 'lumen'])
    expect(plan.get('kept')).toEqual({ role: 'cytosolic', cell: 'cell', position: { x: 140, y: 70 } })
    expect(plan.get('lumen').rect).toEqual({ x: 20, y: -250, width: 560, height: 140 })
    expect(planCellMove({ id: 'cell', delta: { x: 0.2, y: 0 }, layout, bioViews }).size).toBe(0)
  })
})
