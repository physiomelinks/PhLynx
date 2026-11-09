import { describe, expect, it } from 'vitest'

import { BUILT_IN_TEMPLATES } from '../../../../src/services/bioView/builtInTemplates.js'
import {
  FACET_BAND,
  dropSites,
  nearestSite,
  neighbourNodes,
  replacedOccupant,
  AREA_SNAP,
  planSiteBind,
  planSlotDrop,
  planUnbind,
} from '../../../../src/services/bioView/drop.js'
import { CARD, cellHint, layoutPhysiology } from '../../../../src/services/bioView/layout.js'
import { CELL_RADIUS, GLYPH_WIDTH, MEMBRANE_BAND_HALF } from '../../../../src/services/bioView/geometry.js'
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
    // The membrane is the cell's outline; a facet's slots know their edge.
    expect(find(targets, 'bt-1/cell.membrane').rect).toEqual(find(targets, 'bt-1/cell').rect)
    expect(find(targets, 'bt-1/cell.apical', { order: 0 })).toMatchObject({ edge: 'top' })
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
    const cards = find(targets, 'bt-1/cell.metabolism', { type: 'area' }).rect
    expect(nearestSite(areas, centre(cards))).toMatchObject({ area: 'process' })
    const cell = layout.get('tpl:bt-1/cell').rect
    // The membrane reaches MEMBRANE_BAND_HALF either side of the cell's outline, over the fluids beside it.
    expect(nearestSite(areas, { x: cell.x + 100, y: cell.y - MEMBRANE_BAND_HALF + 2 })).toMatchObject({ area: 'membrane' })
    expect(nearestSite(areas, { x: cell.x + 100, y: cell.y + MEMBRANE_BAND_HALF - 2 })).toMatchObject({ area: 'membrane' })
    const beyond = { x: cell.x + 100, y: cell.y - MEMBRANE_BAND_HALF - 4 }
    expect(nearestSite(areas, beyond)).toMatchObject({ area: 'compartment' })
    expect(nearestSite(areas, { x: cell.x + cell.width - 50, y: cell.y + cell.height - 50 })).toMatchObject({ area: 'cell' })
    const lumen = layout.get('tpl:bt-1/apical-fluid').rect
    expect(nearestSite(areas, { x: lumen.x + 10, y: lumen.y + 10 })).toMatchObject({ area: 'compartment', ref: 'bt-1/apical-fluid' })
    expect(nearestSite(targets, { x: -5000, y: -5000 })).toBeNull()
  })

  it('goes to the nearest edge’s facet within FACET_BAND inside a cell, past the membrane’s band', () => {
    const { targets, layout } = view([node('p', { role: 'membraneProtein', site: 'bt-1/cell.basolateral' })])
    const cell = layout.get('tpl:bt-1/cell').rect
    // Above the basolateral membrane's label, far from its slots' centres: still that facet's nearest slot.
    const near = { x: cell.x + cell.width - 70, y: cell.y + cell.height - FACET_BAND + 4 }
    const hit = nearestSite(targets, near)
    expect(hit).toMatchObject({ type: 'slot', ref: 'bt-1/cell.basolateral', order: 1 })
    expect(hit.distance).toBeGreaterThan(AREA_SNAP)
    // Deeper in, the cell.
    expect(nearestSite(targets, { x: near.x, y: cell.y + cell.height - FACET_BAND - 20 })).toMatchObject({
      area: 'cell',
    })
    // Where two bands meet, the nearer edge's facet; a protein moved along its membrane finds slots in the band too.
    const corner = { x: cell.x + 16, y: cell.y + 48 }
    expect(nearestSite(targets, corner)).toMatchObject({ ref: 'bt-1/cell.lateral-left' })
    // Inside the bottom outline, clear of the basolateral glyphs.
    const onBand = { x: cell.x + CELL_RADIUS + 20, y: cell.y + cell.height - 4 }
    expect(nearestSite(targets, onBand)).toMatchObject({ area: 'membrane' })
    expect(nearestSite(targets, onBand, 60, { membrane: false })).toMatchObject({ ref: 'bt-1/cell.basolateral' })
  })

  it('drops on the membrane along the drawn bilayer, inside the outline too, and on the cell within it', () => {
    const { targets, layout } = view([node('p', { role: 'membraneProtein', site: 'bt-1/cell.apical' })])
    const cell = layout.get('tpl:bt-1/cell').rect
    const slot = find(targets, 'bt-1/cell.apical', { order: 0 })
    // Inside the top outline, between the protein's glyph and the corner.
    const between = { x: (cell.x + CELL_RADIUS + slot.x - GLYPH_WIDTH / 2) / 2, y: cell.y + 6 }
    expect(nearestSite(targets, between)).toMatchObject({ area: 'membrane', ref: 'bt-1/cell.membrane' })
    // On a rounded corner's arc, the membrane; just inside it, the facets' band rather than the corner's box.
    const diagonal = CELL_RADIUS * (1 - Math.SQRT1_2)
    expect(nearestSite(targets, { x: cell.x + diagonal, y: cell.y + diagonal })).toMatchObject({ area: 'membrane' })
    expect(nearestSite(targets, { x: cell.x + 2, y: cell.y + 2 })).toMatchObject({ area: 'compartment' })
    // On a protein's glyph, its slot, even within the band.
    expect(nearestSite(targets, { x: slot.x + GLYPH_WIDTH / 2 - 2, y: slot.y + 4 })).toMatchObject({ type: 'slot', order: 0 })
    // Away from the band, deeper than it, the facet's slot.
    expect(nearestSite(targets, { x: between.x, y: cell.y + 20 })).toMatchObject({ ref: 'bt-1/cell.apical' })
  })

  it('takes a drop on the empty cell’s hint, and beside the process cards, as the cell', () => {
    const { targets, layout } = view([])
    const place = layout.get('tpl:bt-1/cell')
    const cell = place.rect
    const hint = cellHint(place.rect, place.zones)
    expect(nearestSite(targets, { x: place.rect.x + hint.x, y: place.rect.y + hint.y })).toMatchObject({ area: 'cell' })
    const zone = place.zones[0].rect
    const cards = find(targets, 'bt-1/cell.metabolism', { type: 'area' }).rect
    expect(cards.width).toBe(CARD.width + 16)
    // Right of the cards, and deeper than the lateral facet's reach.
    const beside = { x: cell.x + cell.width - FACET_BAND - 10, y: zone.y + zone.height / 2 }
    expect(nearestSite(targets, beside)).toMatchObject({ area: 'cell', ref: 'bt-1/cell' })
  })

  it('gives the nodes on the sites next to a drop, skipping the dropped node and pairs already joined', () => {
    const { targets } = view([
      node('cyto', { role: 'cytosol', site: 'bt-1/cell' }),
      node('mem', { role: 'membrane', site: 'bt-1/cell.membrane' }),
      node('lumen', { role: 'region', site: 'bt-1/apical-fluid' }),
      node('blood', { role: 'region', site: 'bt-1/basolateral-fluid' }),
      node('p', { role: 'membraneProtein', site: 'bt-1/cell.apical', order: 0 }),
      node('q', { role: 'membraneProtein', site: 'bt-1/cell.apical', order: 1 }),
    ])
    const neighbours = [
      { ref: 'bt-1/cell', relation: 'inside' },
      { ref: 'bt-1/cell.membrane', relation: 'membrane' },
      { ref: 'bt-1/apical-fluid', relation: 'outside' },
    ]
    expect(neighbourNodes(targets, neighbours, { id: 'p' })).toEqual([
      { id: 'cyto', ref: 'bt-1/cell', relation: 'inside' },
      { id: 'mem', ref: 'bt-1/cell.membrane', relation: 'membrane' },
      { id: 'lumen', ref: 'bt-1/apical-fluid', relation: 'outside' },
    ])
    const edges = [{ source: 'lumen', target: 'p' }, { source: 'q', target: 'mem' }]
    expect(neighbourNodes(targets, neighbours, { id: 'p', edges }).map((n) => n.id)).toEqual(['cyto', 'mem'])
    // A compartment's neighbours are every protein on the facets against it, the dropped one left out.
    const facet = [{ ref: 'bt-1/cell.apical', relation: 'protein' }]
    expect(neighbourNodes(targets, facet, { id: 'lumen' }).map((n) => n.id)).toEqual(['p', 'q'])
    expect(neighbourNodes(dropSites(view([]).sites), neighbours, { id: 'new' })).toEqual([])
  })

  it('replaces only another node on a one-module site', () => {
    const { targets } = view([node('cyto', { role: 'cytosol', site: 'bt-1/cell' }), node('p', apicalAt(0))])
    expect(replacedOccupant(find(targets, 'bt-1/cell'), null)).toBe('cyto')
    expect(replacedOccupant(find(targets, 'bt-1/cell'), 'cyto')).toBeNull()
    expect(replacedOccupant(find(targets, 'bt-1/cell.apical', { order: 0 }), null)).toBeNull()
    expect(replacedOccupant(find(targets, 'bt-1/apical-fluid'), null)).toBeNull()
  })
})

const apicalAt = (order) => ({ role: 'membraneProtein', site: 'bt-1/cell.apical', order })

describe('binding to a template site', () => {
  const apical = (order) => ({ role: 'membraneProtein', site: 'bt-1/cell.apical', order })

  it('offers a dragged node’s row without it, so its own place is one of the slots', () => {
    const state = view([node('a', apical(0)), node('b', apical(1)), node('c', apical(2))])
    const row = (targets) => targets.filter((t) => t.ref === 'bt-1/cell.apical' && t.type === 'slot')
    const dragged = row(dropSites(state.sites, 'b'))
    expect(dragged.map((t) => t.occupant)).toEqual(['a', 'c', null])
    const { x, y } = state.layout.get('b')
    expect(dragged[1]).toMatchObject({ x, y })
    expect(planSiteBind({ id: 'b', site: dragged[1], ...state }).size).toBe(0)
  })

  it('puts a facet’s slots on its proteins as drawn, with one spare past them that appends', () => {
    const state = view([node('a', apical(0)), node('b', apical(1))])
    const row = state.targets.filter((t) => t.ref === 'bt-1/cell.apical' && t.type === 'slot')
    expect(row.slice(0, 2).map(({ x, y }) => ({ x, y }))).toEqual(
      ['a', 'b'].map((id) => ({ x: state.layout.get(id).x, y: state.layout.get(id).y }))
    )
    expect(row.map((t) => [t.order, t.spare, t.occupant])).toEqual([
      [0, false, 'a'],
      [1, false, 'b'],
      [2, true, null],
    ])
    // On a protein the drop goes before it; on the spare, last.
    const before = planSiteBind({ id: 'new', site: row[1], ...state })
    expect([...before].map(([id, bioView]) => [id, bioView.order])).toEqual([
      ['new', 1],
      ['a', 0],
      ['b', 2],
    ])
    expect(planSiteBind({ id: 'new', site: row[2], ...state }).get('new').order).toBe(2)
    // A dragged node's own row has no spare.
    expect(dropSites(state.sites, 'b').filter((t) => t.ref === 'bt-1/cell.apical' && t.spare)).toEqual([])
  })

  it('offers a dragged card’s process row without its spare slot', () => {
    const cytosolic = (order) => ({ role: 'cytosolic', site: 'bt-1/cell.metabolism', order })
    const state = view([node('g', cytosolic(0)), node('h', cytosolic(1))])
    const slots = dropSites(state.sites, 'g').filter((t) => t.ref === 'bt-1/cell.metabolism' && t.type === 'slot')
    expect(slots.map((t) => t.occupant)).toEqual(['h', null])
    expect(planSiteBind({ id: 'g', site: slots[0], ...state }).size).toBe(0)
  })

  it('clears a stale order when binding to a one-module site', () => {
    const state = view([node('r', { role: 'region', order: 3, position: { x: 1, y: 2 } })])
    const plan = planSiteBind({ id: 'r', site: find(state.targets, 'bt-1/apical-fluid'), ...state })
    expect(plan.get('r')).toEqual({ role: 'region', site: 'bt-1/apical-fluid' })
  })

  it('saves where an unbound protein was dropped in whole flow units', () => {
    const state = view([node('a', apical(0))])
    expect(planUnbind({ id: 'a', position: { x: 10.5, y: -3.2 }, ...state }).get('a').position).toEqual({ x: 11, y: -3 })
  })

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
