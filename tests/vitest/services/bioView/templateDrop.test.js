import { describe, expect, it } from 'vitest'

import { BUILT_IN_TEMPLATES } from '../../../../src/services/bioView/builtInTemplates.js'
import {
  MEMBRANE_CHIP,
  dropSites,
  nearestSite,
  AREA_SNAP,
  planSiteBind,
  planSlotDrop,
  planUnbind,
} from '../../../../src/services/bioView/drop.js'
import { layoutPhysiology } from '../../../../src/services/bioView/layout.js'
import { resolveBioRole } from '../../../../src/services/bioView/roles.js'

const definitions = new Map(BUILT_IN_TEMPLATES.map((template) => [template.id, template]))
const node = (id, bioView) => ({ id, data: { name: id, ...(bioView && { bioView }) } })

/** Lays out nodes on one epithelial (or other) template, with roles resolved as the view does. */
function view(nodes, template = 'epithelial-cell') {
  const roles = new Map(nodes.map((n) => [n.id, resolveBioRole(n.data)]))
  const { places, sites } = layoutPhysiology(nodes, roles, {
    instances: [{ id: 'bt-1', template, at: { x: 0, y: 0 } }],
    definitions,
  })
  const bioViews = new Map(nodes.map((n) => [n.id, n.data.bioView]))
  return { nodes, roles, layout: places, sites, targets: dropSites(sites), bioViews }
}

/** Applies a plan to the nodes, as applyPlan would. */
const after = (nodes, plan) =>
  nodes.map((n) => (plan.has(n.id) ? { ...n, data: { ...n.data, bioView: plan.get(n.id) } } : n))

const find = (targets, ref, extra = {}) =>
  targets.find((t) => t.ref === ref && Object.entries(extra).every(([key, value]) => t[key] === value))
const centre = ({ x, y, width, height }) => ({ x: x + width / 2, y: y + height / 2 })

describe('template drop sites', () => {
  it('offers each slot of a facet and a process area, spare or taken, and each area', () => {
    const { targets } = view([node('p', { role: 'membraneProtein', site: 'bt-1/cell.apical' })])
    const apical = targets.filter((t) => t.ref === 'bt-1/cell.apical')
    expect(apical.map((t) => [t.type, t.order, t.occupant])).toEqual([
      ['slot', 0, 'p'],
      ['slot', 1, null],
    ])
    expect(targets.filter((t) => t.type === 'area').map((t) => [t.area, t.ref])).toEqual([
      ['cell', 'bt-1/cell'],
      ['membrane', 'bt-1/cell.membrane'],
      ['process', 'bt-1/cell.metabolism'],
      ['compartment', 'bt-1/apical-fluid'],
      ['compartment', 'bt-1/basolateral-fluid'],
      ['compartment', 'bt-1/paracellular'],
    ])
    expect(find(targets, 'bt-1/cell.membrane').rect).toMatchObject(MEMBRANE_CHIP)
  })

  it('snaps to the nearest slot, else picks a process, then the membrane, then the cell, then a compartment', () => {
    const { targets, layout } = view([])
    const slot = find(targets, 'bt-1/cell.apical', { order: 0 })
    expect(nearestSite(targets, { x: slot.x + 10, y: slot.y - 10 })).toMatchObject({ type: 'slot', order: 0 })
    // In the lumen just beyond AREA_SNAP the lumen wins; outside every area the slot still reaches 60.
    expect(nearestSite(targets, { x: slot.x, y: slot.y - AREA_SNAP - 8 })).toMatchObject({ area: 'compartment' })
    expect(nearestSite(targets.filter((t) => t.type === 'slot'), { x: slot.x, y: slot.y - 50 })).toMatchObject({
      type: 'slot',
    })
    expect(nearestSite(targets, { x: slot.x, y: slot.y - 100 }, 60, { areas: false })).toBeNull()

    // Away from every slot, the areas holding the point, most specific first.
    const areas = targets.filter((t) => t.type === 'area')
    const zone = find(targets, 'bt-1/cell.metabolism', { type: 'area' }).rect
    expect(nearestSite(areas, centre(zone))).toMatchObject({ area: 'process' })
    const chip = find(targets, 'bt-1/cell.membrane').rect
    // The chip crosses the cell's corner and the basolateral fluid.
    expect(nearestSite(areas, { x: chip.x + chip.width - 10, y: chip.y + 4 })).toMatchObject({ area: 'membrane' })
    const cell = layout.get('tpl:bt-1/cell').rect
    expect(nearestSite(areas, { x: cell.x + cell.width - 50, y: cell.y + cell.height - 50 })).toMatchObject({ area: 'cell' })
    const lumen = layout.get('tpl:bt-1/apical-fluid').rect
    expect(nearestSite(areas, { x: lumen.x + 10, y: lumen.y + 10 })).toMatchObject({ area: 'compartment', ref: 'bt-1/apical-fluid' })
    expect(nearestSite(targets, { x: -5000, y: -5000 })).toBeNull()
  })
})

describe('binding to a template site', () => {
  const apical = (order) => ({ role: 'membraneProtein', site: 'bt-1/cell.apical', order })

  it('inserts into a facet’s slot, moving the rest along', () => {
    const state = view([node('a', apical(0)), node('b', apical(1)), node('n', { role: 'none', position: { x: 1, y: 2 } })])
    const site = find(state.targets, 'bt-1/cell.apical', { order: 1 })
    const plan = planSiteBind({ id: 'n', site, ...state })
    expect(Object.fromEntries(plan)).toEqual({
      a: apical(0),
      n: { role: 'membraneProtein', site: 'bt-1/cell.apical', order: 1 },
      b: apical(2),
    })
    const { layout } = view(after(state.nodes, plan))
    expect(['a', 'n', 'b'].map((id) => layout.get(id).order)).toEqual([0, 1, 2])
  })

  it('moves a protein to another facet, closing up the one it left', () => {
    const state = view([node('a', apical(0)), node('b', apical(1))])
    const site = find(state.targets, 'bt-1/cell.basolateral', { order: 0 })
    const plan = planSiteBind({ id: 'a', site, ...state })
    expect(plan.get('b')).toEqual(apical(0))
    expect(plan.get('a')).toEqual({ role: 'membraneProtein', site: 'bt-1/cell.basolateral', order: 0 })
  })

  it('puts a card in a process slot, or at the end of the row when dropped on the area', () => {
    const state = view([node('g', { role: 'cytosolic', site: 'bt-1/cell.metabolism', order: 0 }), node('n', { role: 'none' })])
    const slot = find(state.targets, 'bt-1/cell.metabolism', { type: 'slot', order: 0 })
    expect(Object.fromEntries(planSiteBind({ id: 'n', site: slot, ...state }))).toEqual({
      n: { role: 'cytosolic', site: 'bt-1/cell.metabolism', order: 0 },
      g: { role: 'cytosolic', site: 'bt-1/cell.metabolism', order: 1 },
    })
    const area = find(state.targets, 'bt-1/cell.metabolism', { type: 'area' })
    expect(planSiteBind({ id: 'n', site: area, ...state }).get('n')).toMatchObject({ order: 1 })
  })

  it('binds a cell, its membrane and a compartment, clearing where the node was put', () => {
    const state = view([
      node('c', { role: 'region', rect: { x: 0, y: 0, width: 1, height: 1 }, adjacent: [{ cell: 'x', facet: 'apical' }] }),
      node('m', { role: 'membrane', cell: 'x' }),
      node('r', { position: { x: 5, y: 5 } }),
    ])
    const bind = (id, ref) => planSiteBind({ id, site: find(state.targets, ref), ...state }).get(id)
    expect(bind('c', 'bt-1/cell')).toEqual({ role: 'cytosol', site: 'bt-1/cell' })
    expect(bind('m', 'bt-1/cell.membrane')).toEqual({ role: 'membrane', site: 'bt-1/cell.membrane' })
    expect(bind('r', 'bt-1/apical-fluid')).toEqual({ role: 'region', site: 'bt-1/apical-fluid' })

    const plan = new Map([['r', bind('r', 'bt-1/apical-fluid')]])
    const { layout } = view(after(state.nodes, plan))
    expect(layout.get('r')).toMatchObject({ kind: 'region', site: 'bt-1/apical-fluid', empty: false })
  })

  it('replaces a one-module site’s occupant, which becomes a card', () => {
    const state = view([node('old', { role: 'region', site: 'bt-1/apical-fluid' }), node('new', { role: 'none' })])
    const site = find(state.targets, 'bt-1/apical-fluid')
    expect(site.occupant).toBe('old')
    const plan = planSiteBind({ id: 'new', site, ...state })
    expect(Object.fromEntries(plan)).toEqual({
      old: { role: 'none' },
      new: { role: 'region', site: 'bt-1/apical-fluid' },
    })
    const { layout } = view(after(state.nodes, plan))
    expect(layout.get('new')).toMatchObject({ kind: 'region', site: 'bt-1/apical-fluid' })
    expect(layout.get('old').kind).toBe('card')
  })

  it('unbinds a protein to the tray, closing up its row', () => {
    const state = view([node('a', apical(0)), node('b', apical(1)), node('c', apical(2))])
    const plan = planUnbind({ id: 'b', position: { x: -300, y: 0 }, ...state })
    expect(Object.fromEntries(plan)).toEqual({
      a: apical(0),
      c: apical(1),
      b: { role: 'membraneProtein', facet: null, position: { x: -300, y: 0 } },
    })
    const { layout } = view(after(state.nodes, plan))
    expect(layout.get('b').kind).toBe('tray')
    expect(layout.get('c').order).toBe(1)
  })

  it('empties a site when its node is deleted, and binds it again when the node comes back', () => {
    const lumen = node('lumen', { role: 'region', site: 'bt-1/apical-fluid' })
    expect(find(view([]).targets, 'bt-1/apical-fluid').occupant).toBeNull()
    expect(find(view([lumen]).targets, 'bt-1/apical-fluid').occupant).toBe('lumen')
  })

  it('unbinds a compartment, keeping its role', () => {
    const state = view([node('r', { role: 'region', site: 'bt-1/apical-fluid' })])
    expect(planUnbind({ id: 'r', ...state }).get('r')).toEqual({ role: 'region' })
  })

  it('moves a protein from a node-owned cell to a template slot and back', () => {
    const nodes = [
      node('cell', { role: 'cytosol' }),
      node('x', { role: 'membraneProtein', cell: 'cell', facet: 'apical', order: 0 }),
      node('y', { role: 'membraneProtein', cell: 'cell', facet: 'apical', order: 1 }),
    ]
    const state = view(nodes)
    expect(state.layout.get('x')).toMatchObject({ kind: 'protein', cell: 'cell' })
    const site = find(state.targets, 'bt-1/cell.basolateral', { order: 0 })
    const plan = planSiteBind({ id: 'x', site, ...state })
    expect(plan.get('y')).toMatchObject({ order: 0 })
    expect(plan.get('x')).toEqual({ role: 'membraneProtein', site: 'bt-1/cell.basolateral', order: 0 })
    const moved = view(after(nodes, plan))
    expect(moved.layout.get('x')).toMatchObject({ kind: 'protein', instance: 'bt-1', part: 'basolateral' })

    // And back into the node-owned cell's apical facet.
    const slot = { cellId: 'cell', part: 'apical', facet: 'apical', order: 0 }
    const back = planSlotDrop({ id: 'x', slot, ...moved })
    expect(back.get('x')).toEqual({ role: 'membraneProtein', cell: 'cell', facet: 'apical', order: 0 })
    expect(back.get('y')).toMatchObject({ order: 1 })
    const home = view(after(moved.nodes, back))
    expect(home.layout.get('x')).toMatchObject({ kind: 'protein', cell: 'cell', part: 'apical', order: 0 })
  })

  it('closes up a template row when a protein leaves it for a node-owned cell', () => {
    const nodes = [node('cell', { role: 'cytosol' }), node('a', apical(0)), node('b', apical(1))]
    const state = view(nodes)
    const slot = { cellId: 'cell', part: 'apical', facet: 'apical', order: 0 }
    const plan = planSlotDrop({ id: 'a', slot, ...state })
    expect(plan.get('b')).toEqual(apical(0))
    expect(plan.get('a').site).toBeUndefined()
  })

  it('binds a protein to a chemical synapse’s active zone, turned by its edge', () => {
    const state = view([node('vgcc', { role: 'none' })], 'chemical-synapse')
    const site = find(state.targets, 'bt-1/pre.active-zone', { order: 0 })
    const plan = planSiteBind({ id: 'vgcc', site, ...state })
    const { layout } = view(after(state.nodes, plan), 'chemical-synapse')
    expect(layout.get('vgcc')).toMatchObject({ kind: 'protein', facet: 'active-zone', part: 'active-zone', rotation: 180, outward: 'bottom' })
  })
})
