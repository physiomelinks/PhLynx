import { describe, expect, it } from 'vitest'

import { CARD, layoutBioView, layoutPhysiology } from '../../../../src/services/bioView/layout.js'
import { proteinBoxes } from '../../../../src/services/bioView/speciesLayout.js'
import { resolveBioRole } from '../../../../src/services/bioView/roles.js'

const node = (id, bioView) => ({ id, data: { name: id, ...(bioView && { bioView }) } })
const role = (role, extra = {}) => ({ role, facet: null, cell: null, side: null, glyph: null, ...extra })

/** A cell with a membrane, three apical proteins and one basolateral, the regions either side, and a loose card. */
function epithelium(bioViews = {}) {
  const nodes = ['cell', 'wall', 'p1', 'p2', 'p3', 'q', 'lumen', 'blood', 'plain', 'loose'].map((id) => node(id, bioViews[id]))
  const roles = new Map([
    ['cell', role('cytosol')],
    ['wall', role('membrane', { cell: 'cell' })],
    ['p1', role('membraneProtein', { cell: 'cell', facet: 'apical' })],
    ['p2', role('membraneProtein', { cell: 'cell', facet: 'apical' })],
    ['p3', role('membraneProtein', { cell: 'cell', facet: 'apical' })],
    ['q', role('membraneProtein', { cell: 'cell', facet: 'basolateral' })],
    ['lumen', role('region', { side: 'apical' })],
    ['blood', role('region', { side: 'basolateral' })],
    ['plain', role('none')],
    ['loose', role('membraneProtein')],
  ])
  return { nodes, roles }
}

describe('physiological view layout', () => {
  it('puts proteins in slots on their facets, regions either side, and the rest aside', () => {
    const { nodes, roles } = epithelium()
    const layout = layoutBioView(nodes, roles)
    const cell = layout.get('cell')
    expect(cell).toMatchObject({ kind: 'cell', membrane: 'wall' })
    expect(layout.get('wall')).toEqual({ kind: 'membrane', cell: 'cell' })
    expect(['p1', 'p2', 'p3'].map((id) => layout.get(id).order)).toEqual([0, 1, 2])
    expect(['p1', 'p2', 'p3'].every((id) => layout.get(id).y === cell.rect.y)).toBe(true)
    expect(layout.get('q')).toMatchObject({ kind: 'protein', facet: 'basolateral', order: 0, y: cell.rect.y + cell.rect.height, rotation: 180 })
    // The regions meet the membrane, so the proteins in it sit in both the region and the cell.
    const within = (y, rect) => y >= rect.y && y <= rect.y + rect.height
    const lumen = layout.get('lumen').rect
    const blood = layout.get('blood').rect
    expect(lumen.y).toBeLessThan(cell.rect.y)
    expect(within(layout.get('p1').y, lumen)).toBe(true)
    expect(blood.y + blood.height).toBeGreaterThan(cell.rect.y + cell.rect.height)
    expect(within(layout.get('q').y, blood)).toBe(true)
    // Each band stays on its own side of the cell's middle.
    expect(lumen.y + lumen.height).toBeLessThan(cell.rect.y + cell.rect.height / 2)
    expect(blood.y).toBeGreaterThan(cell.rect.y + cell.rect.height / 2)
    expect(layout.get('loose').kind).toBe('tray')
    expect(layout.get('loose').x).toBeLessThan(cell.rect.x)
    expect(layout.get('plain').kind).toBe('card')
    expect(layout.get('plain').x).toBeGreaterThan(cell.rect.x + cell.rect.width)
  })

  it('spaces neighbouring apical proteins so their names, and what they carry, keep clear', () => {
    const { nodes, roles } = epithelium()
    const named = nodes.map((each) =>
      each.id === 'p2' || each.id === 'p3' ? { ...each, data: { ...each.data, name: `${each.id}_sodium_glucose_cotransporter` } } : each
    )
    const detailOf = (id) => (id === 'p1' ? 'Na⁺ · K⁺ · Cl⁻ · HCO₃⁻ · H⁺' : '')
    const { places } = layoutPhysiology(named, roles, { detailOf })
    const label = (id) => {
      const name = named.find((each) => each.id === id).data.name
      return proteinBoxes(places.get(id), { name, detail: detailOf(id) })[1]
    }
    const [a, b, c] = ['p1', 'p2', 'p3'].map(label)
    expect(a.x + a.width).toBeLessThanOrEqual(b.x)
    expect(b.x + b.width).toBeLessThanOrEqual(c.x)
    // The cell grows to hold them.
    const { rect } = places.get('cell')
    expect(places.get('p3').x).toBeLessThan(rect.x + rect.width)
  })

  it('keeps the order and places the user chose, and fits the rest around them', () => {
    const rect = { x: 500, y: 400, width: 600, height: 400 }
    const { nodes, roles } = epithelium({ p3: { order: 0 }, cell: { rect }, plain: { position: { x: 7, y: 8 } } })
    const layout = layoutBioView(nodes, roles)
    expect(['p3', 'p1', 'p2'].map((id) => layout.get(id).order)).toEqual([0, 1, 2])
    expect(layout.get('cell').rect).toEqual(rect)
    expect(layout.get('plain')).toEqual({ kind: 'card', x: 7, y: 8 })
  })

  it('lays out the same way every time, whatever order the nodes come in', () => {
    const { nodes, roles } = epithelium()
    expect(layoutBioView([...nodes].reverse(), roles)).toEqual(layoutBioView(nodes, roles))
  })

  it('stacks cards without overlap when nothing is physiological', () => {
    const nodes = [node('a'), node('b')]
    const layout = layoutBioView(nodes, new Map())
    expect(layout.get('b').y - layout.get('a').y).toBeGreaterThanOrEqual(CARD.height)
  })
})

describe('physiological view layout of proteins the user placed', () => {
  it('puts every protein in a slot of its cell, apical above basolateral, with no two in one slot', () => {
    const facets = { a1: 'apical', a2: 'apical', a3: 'apical', b1: 'basolateral', b2: 'basolateral' }
    const nodes = [
      node('cell', { role: 'cytosol' }),
      ...Object.entries(facets).map(([id, facet]) => node(id, { role: 'membraneProtein', cell: 'cell', facet })),
    ]
    const roles = new Map(nodes.map((n) => [n.id, resolveBioRole(n.data)]))
    const layout = layoutBioView(nodes, roles)

    const proteins = Object.keys(facets).map((id) => layout.get(id))
    expect(proteins.every((p) => p.kind === 'protein')).toBe(true)
    const slots = proteins.map((p) => `${p.cell}/${p.facet}/${p.order}`)
    expect(new Set(slots).size).toBe(slots.length)
    const apical = proteins.filter((p) => p.facet === 'apical').map((p) => p.y)
    const basolateral = proteins.filter((p) => p.facet === 'basolateral').map((p) => p.y)
    expect(Math.max(...apical)).toBeLessThan(Math.min(...basolateral))
  })
})

describe('physiological view layout by adjacency', () => {
  /** Two cells, a paracellular space down a's right side, a lumen against b only, and lateral proteins. */
  function twoCells() {
    const nodes = ['a', 'b', 'para', 'lumen', 'l1', 'l2', 'l3', 'r1'].map((id) => node(id))
    const roles = new Map([
      ['a', role('cytosol')],
      ['b', role('cytosol')],
      ['para', role('region', { adjacent: [{ cell: 'a', facet: 'lateral', at: 'right' }] })],
      ['lumen', role('region', { adjacent: [{ cell: 'b', facet: 'apical' }] })],
      ['l1', role('membraneProtein', { cell: 'a', facet: 'lateral' })],
      ['l2', role('membraneProtein', { cell: 'a', facet: 'lateral' })],
      ['l3', role('membraneProtein', { cell: 'a', facet: 'lateral' })],
      ['r1', role('membraneProtein', { cell: 'a', facet: 'lateral', at: 'right' })],
    ])
    return layoutBioView(nodes, roles)
  }

  it('runs a paracellular region down one cell’s side, moving its neighbour along to make room', () => {
    const layout = twoCells()
    const a = layout.get('a').rect
    const b = layout.get('b').rect
    const para = layout.get('para')
    expect(para.side).toBe('lateral')
    // Against a's right side, from its top to its bottom, overlapping under its rounded corners.
    expect(para.rect.x).toBeLessThan(a.x + a.width)
    expect(para.rect.x + para.rect.width).toBeGreaterThan(a.x + a.width)
    expect([para.rect.y, para.rect.height]).toEqual([a.y, a.height])
    // Clear of the next cell.
    expect(para.rect.x + para.rect.width).toBeLessThanOrEqual(b.x)
  })

  it('puts a region against only the cells it is adjacent to', () => {
    const layout = twoCells()
    const b = layout.get('b').rect
    const lumen = layout.get('lumen').rect
    expect(lumen.x).toBeGreaterThan(layout.get('a').rect.x + layout.get('a').rect.width)
    expect(lumen.y + lumen.height).toBeGreaterThan(b.y)
    expect(lumen.y).toBeLessThan(b.y)
  })

  it('puts lateral proteins on their side, and spreads those without one over both', () => {
    const layout = twoCells()
    const parts = ['l1', 'l2', 'l3', 'r1'].map((id) => layout.get(id).part)
    expect(layout.get('r1').part).toBe('lateral-right')
    expect(parts.filter((part) => part === 'lateral-left')).toHaveLength(2)
    expect(parts.filter((part) => part === 'lateral-right')).toHaveLength(2)
    expect(layout.get('r1')).toMatchObject({ rotation: 90, x: layout.get('a').rect.x + layout.get('a').rect.width })
  })

  it('stacks a region against a cell that isn’t there with the others below', () => {
    const nodes = [node('c'), node('lost')]
    const roles = new Map([
      ['c', role('cytosol')],
      ['lost', role('region', { adjacent: [{ cell: 'gone', facet: 'apical' }] })],
    ])
    const layout = layoutBioView(nodes, roles)
    expect(layout.get('lost').rect.y).toBeGreaterThan(layout.get('c').rect.y + layout.get('c').rect.height)
  })
})

describe('physiological view layout of regions sharing a place', () => {
  it('stacks regions against the same side outward, and makes room for each down a cell’s side', () => {
    const nodes = ['a', 'b', 'p1', 'p2', 'l1', 'l2'].map((id) => node(id))
    const right = [{ cell: 'a', facet: 'lateral', at: 'right' }]
    const roles = new Map([
      ['a', role('cytosol')],
      ['b', role('cytosol')],
      ['p1', role('region', { adjacent: right })],
      ['p2', role('region', { adjacent: right })],
      ['l1', role('region', { side: 'apical' })],
      ['l2', role('region', { side: 'apical' })],
    ])
    const layout = layoutBioView(nodes, roles)
    const [p1, p2, l1, l2] = ['p1', 'p2', 'l1', 'l2'].map((id) => layout.get(id).rect)
    expect(p2.x).toBeGreaterThanOrEqual(p1.x + p1.width)
    expect(p2.x + p2.width).toBeLessThanOrEqual(layout.get('b').rect.x)
    expect(l2.y + l2.height).toBeLessThanOrEqual(l1.y)
  })

  it('puts a region back where its annotations say when the cell it lay against is gone', () => {
    const nodes = [node('c'), node('lumen')]
    const roles = new Map([
      ['c', role('cytosol')],
      ['lumen', role('region', { side: 'apical', adjacent: [{ cell: 'gone', facet: 'lateral', at: 'right' }] })],
    ])
    const place = layoutBioView(nodes, roles).get('lumen')
    expect(place).toMatchObject({ side: 'apical', adjacent: null })
    expect(place.rect.y).toBeLessThan(layoutBioView(nodes, roles).get('c').rect.y)
  })
})

describe('physiological view layout with cells the user added', () => {
  it('keeps a cell’s processes inside its membrane, in an area drawn round them, and grows the cell for a row of them', () => {
    const ids = ['a', 'b', 'c']
    const roles = new Map([['cell', role('cytosol')], ...ids.map((id) => [id, role('cytosolic', { cell: 'cell' })])])
    const cellAt = { rect: { x: 100, y: 100, width: 320, height: 240 } }
    // One left over the bottom membrane, as a drag to the cell's edge used to leave it.
    const nodes = [node('cell', cellAt), node('a'), node('b'), node('c', { position: { x: 150, y: 330 } })]
    const layout = layoutBioView(nodes, roles)
    const cell = layout.get('cell')
    for (const id of ids) {
      const card = layout.get(id)
      expect(card.x).toBeGreaterThanOrEqual(cell.rect.x + 16)
      expect(card.x + CARD.width).toBeLessThanOrEqual(cell.rect.x + cell.rect.width - 16)
      expect(card.y + CARD.height).toBeLessThanOrEqual(cell.rect.y + cell.rect.height - 16)
    }
    expect(layout.get('c').y).toBe(100 + 240 - 16 - CARD.height)
    // Wide enough for the three in a row, and the area holds all of them.
    expect(cell.rect.width).toBeGreaterThanOrEqual(2 * 40 + 3 * CARD.width + 2 * 16)
    const [zone] = cell.zones
    expect(zone).toMatchObject({ label: null, filled: true })
    for (const id of ids) {
      expect(layout.get(id).x).toBeGreaterThan(zone.rect.x)
      expect(layout.get(id).y + CARD.height).toBeLessThan(zone.rect.y + zone.rect.height)
    }
    // A cell with none has no such area.
    expect(layoutBioView([node('cell', cellAt)], new Map([['cell', role('cytosol')]])).get('cell').zones).toBeUndefined()
  })

  it('keeps a region against its cell as the cell moves and grows, whatever place the region had', () => {
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
    const roles = new Map([
      ['cell', role('cytosol')],
      ['lumen', role('region', { adjacent: [{ cell: 'cell', facet: 'apical' }] })],
      ['far', role('region')],
      ...ids.map((id) => [id, role('membraneProtein', { cell: 'cell', facet: 'apical' })]),
    ])
    const kept = { x: -900, y: -900, width: 300, height: 100 }
    const nodes = [
      node('cell', { rect: { x: 500, y: 300, width: 320, height: 240 } }),
      // A place kept from before the cell moved and took more proteins.
      node('lumen', { rect: { x: 0, y: 0, width: 344, height: 150 } }),
      node('far', { rect: kept }),
      ...ids.map((id) => node(id)),
    ]
    const layout = layoutBioView(nodes, roles)
    const cell = layout.get('cell').rect
    const lumen = layout.get('lumen')
    expect(lumen.anchored).toBe(true)
    // Across the whole cell, meeting its apical membrane.
    expect(lumen.rect.x).toBeLessThanOrEqual(cell.x)
    expect(lumen.rect.x + lumen.rect.width).toBeGreaterThanOrEqual(cell.x + cell.width)
    expect(lumen.rect.y).toBeLessThan(cell.y)
    expect(lumen.rect.y + lumen.rect.height).toBeGreaterThanOrEqual(cell.y)
    // One against no cell keeps the place it was given.
    expect(layout.get('far').rect).toEqual(kept)
    expect(layout.get('far').anchored).toBeUndefined()
  })

  it('grows a cell the user moved to fit its proteins, where it was put', () => {
    const stored = { x: 500, y: -300, width: 320, height: 240 }
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6']
    const nodes = [node('cell', { rect: stored }), ...ids.map((id) => node(id))]
    const roles = new Map([
      ['cell', role('cytosol')],
      ...ids.map((id) => [id, role('membraneProtein', { cell: 'cell', facet: 'apical' })]),
    ])
    const layout = layoutBioView(nodes, roles)
    const { rect } = layout.get('cell')
    expect(rect).toMatchObject({ x: 500, y: -300 })
    // Every protein sits on the straight part of the membrane, clear of the corners.
    for (const id of ids) {
      expect(layout.get(id).x).toBeGreaterThan(rect.x + 40)
      expect(layout.get(id).x).toBeLessThan(rect.x + rect.width - 40)
    }
  })

  it('keeps a region against the cell it lies against, not ones the user added', () => {
    const nodes = [node('cell', { role: 'cytosol' }), node('added', { rect: { x: -800, y: -600, width: 320, height: 240 }, added: true }), node('lumen')]
    const roles = new Map([
      // An annotated cell the user also chose Show As > Cell for still counts as annotated.
      ['cell', role('cytosol', { source: 'override' })],
      ['added', role('cytosol', { source: 'override' })],
      ['lumen', role('region', { adjacent: [{ cell: 'cell', facet: 'apical' }], source: 'override' })],
    ])
    const layout = layoutBioView(nodes, roles)
    const cell = layout.get('cell').rect
    const lumen = layout.get('lumen').rect
    // Still meeting the annotated cell's apical membrane, and only spanning it.
    expect(lumen.y + lumen.height).toBeGreaterThan(cell.y)
    expect(lumen.y).toBeLessThan(cell.y)
    expect(lumen.x).toBeGreaterThan(-800 + 320)
  })
})

describe('where a microdomain goes', () => {
  const rects = new Map([
    ['cell', { x: 0, y: 0, width: 600, height: 500 }],
    ['sr', { x: 160, y: 200, width: 280, height: 170 }],
  ])
  const own = (edge) => ({ cellKey: 'cell', facetId: edge, edge })
  const organelle = (edge) => ({ cellKey: 'sr', facetId: edge, edge })

  it('fills the space between its cell’s side and the organelle’s, reaching under the organelle’s corners', async () => {
    const { microdomainRect } = await import('../../../../src/services/bioView/layout.js')
    const below = microdomainRect({ parent: 'cell', against: [own('bottom'), organelle('bottom')] }, rects)
    expect(below).toEqual({ x: 180, width: 240, y: 330, height: 160 })
    const beside = microdomainRect({ parent: 'cell', against: [own('left'), organelle('left')] }, rects)
    expect(beside).toEqual({ y: 220, height: 130, x: 10, width: 190 })
  })

  it('is a band under its cell’s side, or round an organelle’s, when against one alone', async () => {
    const { microdomainRect } = await import('../../../../src/services/bioView/layout.js')
    expect(microdomainRect({ parent: 'cell', against: [own('top')], depth: 60 }, rects)).toEqual({ x: 40, width: 520, y: 10, height: 60 })
    expect(microdomainRect({ parent: 'cell', against: [organelle('top')], depth: 50 }, rects)).toEqual({ x: 180, width: 240, y: 150, height: 90 })
    expect(microdomainRect({ parent: 'gone', against: [own('top')] }, rects)).toBeNull()
  })

  it('lies between a fold’s wall and the organelle’s side facing it, over the stretch they share, or round the fold', async () => {
    const { microdomainRect } = await import('../../../../src/services/bioView/layout.js')
    const pocket = { edge: 'top', at: 540, half: 38, depth: 400 }
    const fold = { cellKey: 'cell', facetId: 'tubule', fold: 'top' }
    const between = microdomainRect({ parent: 'cell', against: [fold, organelle('right')] }, rects, pocket)
    expect(between).toEqual({ x: 400, y: 220, width: 540 - 38 - 10 - 400, height: 130 })
    const round = microdomainRect({ parent: 'cell', against: [fold], depth: 40 }, rects, pocket)
    expect(round).toEqual({ x: 452, y: 10, width: 176, height: 430 })
    expect(microdomainRect({ parent: 'cell', against: [fold] }, rects)).toBeNull()
  })
})

describe('where a junction goes', () => {
  const cell = { x: 0, y: 0, width: 400, height: 600 }

  it('is midway between two microdomains, or just inside the cell from one', async () => {
    const { junctionZone } = await import('../../../../src/services/bioView/layout.js')
    const outer = { rect: { x: 40, y: 10, width: 320, height: 150 }, edge: 'top' }
    const inner = { rect: { x: 40, y: 440, width: 320, height: 150 }, edge: 'bottom' }
    const between = junctionZone(cell, [outer, inner])
    expect(between).toMatchObject({ x: 200 - between.width / 2, y: 300 - between.height / 2 })
    const below = junctionZone(cell, [outer, {}])
    expect(below.y).toBe(160 + 12)
    expect(below.x + below.width / 2).toBe(200)
    const above = junctionZone(cell, [{}, inner])
    expect(above.y + above.height).toBe(440 - 12)
  })
})
