import { describe, expect, it } from 'vitest'

import { BUILT_IN_TEMPLATES, getBuiltInTemplate } from '../../../../src/services/bioView/builtInTemplates.js'
import { CELL_RADIUS } from '../../../../src/services/bioView/geometry.js'
import { GAP, layoutPhysiology } from '../../../../src/services/bioView/layout.js'
import { compartmentForm } from '../../../../src/services/bioView/templates.js'

const node = (id, bioView) => ({ id, data: { name: id, ...(bioView && { bioView }) } })
const role = (role, extra = {}) => ({ role, facet: null, cell: null, side: null, glyph: null, ...extra })
const definitions = new Map(BUILT_IN_TEMPLATES.map((template) => [template.id, template]))
const instance = (template, id = 'bt-1', at = { x: 0, y: 0 }) => ({ id, template, at })

const right = (rect) => rect.x + rect.width
const bottom = (rect) => rect.y + rect.height
/** Whether two rects share some area, not just an edge. */
const overlaps = (a, b) => a.x < right(b) && b.x < right(a) && a.y < bottom(b) && b.y < bottom(a)
/** Moves a compartment's rect off the cells by the corner it reaches under them (both, for a gap). */
const clear = (rect, edge, gap) => {
  if (gap && (edge === 'left' || edge === 'right')) return { ...rect, x: rect.x + CELL_RADIUS, width: rect.width - 2 * CELL_RADIUS }
  if (gap) return { ...rect, y: rect.y + CELL_RADIUS, height: rect.height - 2 * CELL_RADIUS }
  if (edge === 'top') return { ...rect, height: rect.height - CELL_RADIUS }
  if (edge === 'bottom') return { ...rect, y: rect.y + CELL_RADIUS, height: rect.height - CELL_RADIUS }
  if (edge === 'right') return { ...rect, x: rect.x + CELL_RADIUS, width: rect.width - CELL_RADIUS }
  return { ...rect, width: rect.width - CELL_RADIUS }
}

function layOut(templateId, nodes = [], roles = new Map(), instances = [instance(templateId)]) {
  return layoutPhysiology(nodes, roles, { instances, definitions })
}

const key = (path, id = 'bt-1') => `tpl:${id}/${path}`

describe('template layout, nothing bound', () => {
  for (const template of BUILT_IN_TEMPLATES) {
    it(`lays out ${template.id} with each compartment against its facets and nothing overlapping`, () => {
      const { places, sites } = layOut(template.id)
      const cells = template.cells.map((cell) => places.get(key(cell.id)))
      const compartments = template.compartments.map((piece) => [piece, places.get(key(piece.id))])

      for (const [i, cell] of cells.entries()) {
        expect(cell).toMatchObject({ kind: 'cell', membrane: null, instance: 'bt-1', empty: true, label: template.cells[i].label })
        expect(cell.facetLabels.map((facet) => facet.facetId)).toEqual(template.cells[i].facets.map((facet) => facet.id))
      }
      for (const [piece, place] of compartments) {
        expect(place).toMatchObject({ kind: 'region', instance: 'bt-1', site: `bt-1/${piece.id}`, empty: true, tone: piece.tone })
        // Each lies right against its facets: a band meets the cells' edge, a column its cell's side.
        for (const ref of piece.against) {
          const [cellId, facetId] = ref.split('.')
          const cell = places.get(key(cellId)).rect
          const { edge } = template.cells.find((c) => c.id === cellId).facets.find((f) => f.id === facetId)
          const { rect } = place
          if (edge === 'top') expect(bottom(rect)).toBe(cell.y + CELL_RADIUS)
          if (edge === 'bottom') expect(rect.y).toBe(bottom(cell) - CELL_RADIUS)
          if (edge === 'right') expect(rect.x).toBe(right(cell) - CELL_RADIUS)
          if (edge === 'left') expect(right(rect)).toBe(cell.x + CELL_RADIUS)
        }
      }

      // No two cells overlap, nor two compartments once off the cells' corners, nor a compartment a cell.
      const cellRects = cells.map((cell) => cell.rect)
      const isGap = (piece) => compartmentForm(template, piece) === 'gap'
      const regionRects = compartments.map(([piece, place]) => clear(place.rect, place.edge, isGap(piece)))
      const pairs = (list) => list.flatMap((a, i) => list.slice(i + 1).map((b) => [a, b]))
      for (const [a, b] of pairs(cellRects)) expect(overlaps(a, b)).toBe(false)
      for (const [a, b] of pairs(regionRects)) expect(overlaps(a, b)).toBe(false)
      for (const a of cellRects) for (const b of regionRects) expect(overlaps(a, b)).toBe(false)

      // Every site is offered, all empty.
      expect(sites).toHaveLength(
        template.cells.reduce((n, cell) => n + 2 + cell.facets.length + cell.processes.length, 0) + template.compartments.length
      )
      expect(sites.every((site) => site.occupant === null)).toBe(true)
    })
  }

  it('puts the first cell below the bands above it, from the instance’s corner', () => {
    const { places } = layOut('epithelial-cell', [], new Map(), [instance('epithelial-cell', 'bt-1', { x: 100, y: 50 })])
    const cell = places.get(key('cell')).rect
    const fluid = places.get(key('apical-fluid')).rect
    expect(cell.x).toBe(100)
    expect(fluid.y).toBe(50)
    expect(cell.y).toBe(50 + fluid.height - CELL_RADIUS)
    expect(places.get(key('apical-fluid'))).toMatchObject({ edge: 'top', label: 'Apical fluid (lumen)' })
  })

  it('fills the paracellular gap between the two cells of an epithelium', () => {
    const { places } = layOut('two-cell-epithelium')
    const a = places.get(key('a')).rect
    const b = places.get(key('b')).rect
    const gap = places.get(key('paracellular')).rect
    expect(a.y).toBe(b.y)
    expect(b.x).toBeGreaterThan(right(a))
    expect(gap).toEqual({ x: right(a) - CELL_RADIUS, y: a.y, width: b.x - right(a) + 2 * CELL_RADIUS, height: a.height })
    // The shared fluids span both cells.
    const apical = places.get(key('apical-fluid')).rect
    expect(apical.x).toBe(a.x - GAP)
    expect(right(apical)).toBe(right(b) + GAP)
  })

  it('fills the synaptic cleft between the rows, as deep as the template says', () => {
    const { places } = layOut('chemical-synapse')
    const pre = places.get(key('pre')).rect
    const post = places.get(key('post')).rect
    const cleft = places.get(key('cleft'))
    expect(post.y - bottom(pre)).toBe(60)
    expect(post.x).toBe(pre.x)
    expect(cleft).toMatchObject({ edge: 'bottom', tone: 'amber' })
    expect(cleft.rect).toEqual({ x: pre.x, y: bottom(pre) - CELL_RADIUS, width: pre.width, height: 60 + 2 * CELL_RADIUS })
    // The extracellular space lies above the presynaptic terminal, which starts below it.
    expect(bottom(places.get(key('ecs')).rect)).toBe(pre.y + CELL_RADIUS)
    expect(places.get(key('pre')).zones).toEqual([{ processId: 'vesicle-cycle', label: 'Vesicle cycle', rect: expect.any(Object) }])
  })

  it('runs the junction cleft down the endothelial cell’s side', () => {
    const { places } = layOut('vessel-wall')
    const cell = places.get(key('endothelial')).rect
    const cleft = places.get(key('junction-cleft'))
    expect(cleft).toMatchObject({ edge: 'right', tone: 'teal' })
    expect(cleft.rect).toMatchObject({ x: right(cell) - CELL_RADIUS, y: cell.y, height: cell.height })
  })

  it('stops bands along neighbouring cells halfway between them', () => {
    const raw = getBuiltInTemplate('two-cell-epithelium')
    const template = {
      ...raw,
      id: 'split',
      compartments: [
        { id: 'left-fluid', label: 'Left', against: ['a.apical'], tone: 'sky' },
        { id: 'right-fluid', label: 'Right', against: ['b.apical'], tone: 'rose' },
      ],
    }
    const { places } = layoutPhysiology([], new Map(), { instances: [instance('split')], definitions: new Map([['split', template]]) })
    const a = places.get(key('a')).rect
    const b = places.get(key('b')).rect
    const one = places.get(key('left-fluid')).rect
    const two = places.get(key('right-fluid')).rect
    expect(one.x).toBe(a.x - GAP)
    expect(right(one)).toBe((right(a) + b.x) / 2)
    expect(two.x).toBe(right(one))
    expect(right(two)).toBe(right(b) + GAP)
  })

  it('stacks a later band outward, and puts a free compartment below everything', () => {
    const raw = getBuiltInTemplate('enterocyte')
    const template = {
      ...raw,
      id: 'stacked',
      compartments: [
        ...raw.compartments,
        { id: 'mucus', label: 'Mucus', against: ['cell.apical'], tone: 'lime', depth: 50 },
        { id: 'blood', label: 'Blood', against: [], tone: 'rose' },
      ],
    }
    const { places } = layoutPhysiology([], new Map(), { instances: [instance('stacked')], definitions: new Map([['stacked', template]]) })
    const lumen = places.get(key('lumen')).rect
    const mucus = places.get(key('mucus')).rect
    const interstitium = places.get(key('interstitium')).rect
    expect(bottom(mucus)).toBe(lumen.y)
    expect(mucus.height).toBe(50)
    expect(mucus.y).toBe(0)
    const blood = places.get(key('blood'))
    expect(blood.rect.y).toBe(bottom(interstitium) + GAP)
    expect(blood.edge).toBeUndefined()
  })
})

describe('template layout, with nodes bound', () => {
  const bound = (site, extra = {}) => ({ site, ...extra })

  it('puts proteins in their facet’s slots and processes in their area, in order then by name', () => {
    const nodes = [
      node('nhe', bound('bt-1/cell.apical')),
      node('enac', bound('bt-1/cell.apical', { order: 0 })),
      node('pump', bound('bt-1/cell.basolateral')),
      node('glyco', bound('bt-1/cell.metabolism')),
      node('atp', bound('bt-1/cell.metabolism')),
    ]
    const { places, sites } = layOut('epithelial-cell', nodes, new Map(nodes.map((n) => [n.id, role('none')])))
    const cell = places.get(key('cell'))
    expect(places.get('enac')).toMatchObject({ kind: 'protein', cell: key('cell'), part: 'apical', facet: 'apical', order: 0, y: cell.rect.y })
    expect(places.get('nhe')).toMatchObject({ part: 'apical', order: 1, instance: 'bt-1', site: 'bt-1/cell.apical' })
    expect(places.get('pump')).toMatchObject({ part: 'basolateral', order: 0, y: bottom(cell.rect) })
    const zone = cell.zones[0].rect
    for (const [id, order] of [['atp', 0], ['glyco', 1]]) {
      const place = places.get(id)
      expect(place).toMatchObject({ kind: 'cytosolic', cell: key('cell'), site: 'bt-1/cell.metabolism' })
      expect(place.y).toBeGreaterThanOrEqual(zone.y)
      expect(place.x).toBeGreaterThanOrEqual(zone.x)
      if (order) expect(place.x).toBeGreaterThan(places.get('atp').x)
    }
    // The cell grows to fit both cards and a spare.
    expect(right(zone)).toBeLessThanOrEqual(right(cell.rect))
    const apical = sites.find((site) => site.ref === 'bt-1/cell.apical')
    expect(apical).toMatchObject({ kind: 'slots', role: 'membraneProtein', occupant: null, occupants: ['enac', 'nhe'] })
    expect(apical.slots).toHaveLength(3)
    expect(sites.find((site) => site.ref === 'bt-1/cell.metabolism').slots).toHaveLength(3)
  })

  it('keys a bound cell, membrane and compartment by their nodes in place of the empty pieces', () => {
    const nodes = [
      node('cyto', bound('bt-1/cell')),
      node('wall', bound('bt-1/cell.membrane')),
      node('lumen', bound('bt-1/apical-fluid')),
      node('p', bound('bt-1/cell.apical')),
    ]
    const { places, sites } = layOut('epithelial-cell', nodes, new Map([['lumen', role('region', { side: 'apical' })]]))
    expect(places.has(key('cell'))).toBe(false)
    expect(places.has(key('apical-fluid'))).toBe(false)
    expect(places.get('cyto')).toMatchObject({ kind: 'cell', empty: false, membrane: 'wall', site: 'bt-1/cell' })
    expect(places.get('wall')).toEqual({ kind: 'membrane', cell: 'cyto', instance: 'bt-1', site: 'bt-1/cell.membrane' })
    expect(places.get('lumen')).toMatchObject({ kind: 'region', empty: false, tone: 'sky', edge: 'top', site: 'bt-1/apical-fluid' })
    expect(places.get('p')).toMatchObject({ kind: 'protein', cell: 'cyto' })
    expect(places.get(key('basolateral-fluid')).empty).toBe(true)
    expect(sites.find((site) => site.ref === 'bt-1/apical-fluid')).toMatchObject({ kind: 'single', occupant: 'lumen', key: 'lumen' })
    expect(sites.find((site) => site.ref === 'bt-1/cell')).toMatchObject({ occupant: 'cyto', rect: places.get('cyto').rect })
  })

  it('grows every cell in a row with the tallest, so the bands and the gap still meet each one', () => {
    const nodes = ['p1', 'p2', 'p3'].map((id) => node(id, bound('bt-1/a.lateral-left')))
    const { places } = layOut('two-cell-epithelium', nodes, new Map())
    const a = places.get(key('a')).rect
    const b = places.get(key('b')).rect
    expect(a.height).toBeGreaterThan(240)
    expect(b.height).toBe(a.height)
    expect(places.get(key('basolateral-fluid')).rect.y).toBe(bottom(b) - CELL_RADIUS)
    expect(places.get(key('paracellular')).rect).toMatchObject({ y: a.y, height: a.height })
  })

  it('lets the first by name hold a one-module site and the rest fall back to their roles', () => {
    const nodes = [node('b', bound('bt-1/lumen')), node('a', bound('bt-1/lumen'))]
    const { places } = layOut('enterocyte', nodes, new Map([['b', role('none')]]))
    expect(places.get('a')).toMatchObject({ kind: 'region', site: 'bt-1/lumen' })
    expect(places.get('b').kind).toBe('card')
  })

  it('falls back to the role of a node whose site is dangling', () => {
    const nodes = [
      node('gone', bound('bt-9/cell.apical')),
      node('nosite', bound('bt-1/cell.nowhere')),
      node('notpl', bound('bt-2/cell')),
      node('junk', bound('not a ref')),
    ]
    const roles = new Map([
      ['gone', role('membraneProtein')],
      ['nosite', role('none')],
      ['notpl', role('cytosol')],
    ])
    const instances = [instance('epithelial-cell'), { id: 'bt-2', template: 'missing', at: { x: 0, y: 0 } }]
    const { places } = layOut('epithelial-cell', nodes, roles, instances)
    expect(places.get('gone').kind).toBe('tray')
    expect(places.get('nosite').kind).toBe('card')
    expect(places.get('notpl')).toMatchObject({ kind: 'cell', membrane: null })
    expect(places.get('notpl').instance).toBeUndefined()
    expect(places.get('junk').kind).toBe('card')
    expect(places.get(key('cell')).empty).toBe(true)
  })
})

describe('template layout, several instances', () => {
  it('places two instances apart without stacking one’s compartments on the other’s', () => {
    const instances = [instance('epithelial-cell', 'bt-1'), instance('epithelial-cell', 'bt-2', { x: 1000, y: 0 })]
    const { places } = layOut('epithelial-cell', [], new Map(), instances)
    for (const path of ['cell', 'apical-fluid', 'basolateral-fluid', 'paracellular']) {
      const one = places.get(key(path, 'bt-1')).rect
      const two = places.get(key(path, 'bt-2')).rect
      expect(two).toEqual({ ...one, x: one.x + 1000 })
      expect(overlaps(one, two)).toBe(false)
    }
  })

  it('lays template cells out beside node-owned ones, with the tray and cards beside them all', () => {
    const nodes = [node('own'), node('loose'), node('plain')]
    const roles = new Map([
      ['own', role('cytosol')],
      ['loose', role('membraneProtein')],
      ['plain', role('none')],
    ])
    const instances = [instance('vessel-wall', 'bt-1', { x: 800, y: -200 })]
    const { places } = layOut('vessel-wall', nodes, roles, instances)
    const own = places.get('own').rect
    const tpl = places.get(key('endothelial')).rect
    expect(own).toMatchObject({ x: 0, y: 0 })
    expect(places.get('own').instance).toBeUndefined()
    expect(tpl.x).toBe(800)
    expect(overlaps(own, tpl)).toBe(false)
    expect(places.get('loose')).toMatchObject({ kind: 'tray', y: tpl.y })
    expect(places.get('plain').x).toBeGreaterThan(right(tpl))
    expect(places.get('plain').y).toBe(tpl.y)
  })
})
