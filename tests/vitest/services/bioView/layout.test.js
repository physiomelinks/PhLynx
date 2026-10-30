import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'

import { parseApiCoords } from '../../../../src/services/annotations/apicoord.js'
import { CARD, layoutBioView } from '../../../../src/services/bioView/layout.js'
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

// Unpublished fixtures, gitignored: read what to expect from private/expected.json, naming nothing of the model.
const PRIVATE = resolve(__dirname, '../../fixtures/annotations/private')
const EXPECTED = resolve(PRIVATE, 'expected.json')

describe.skipIf(!existsSync(EXPECTED))('physiological view layout of the private fixtures', () => {
  it('puts every protein in a slot of its cell, apical above basolateral, with no two in one slot', async () => {
    const expected = JSON.parse(readFileSync(EXPECTED, 'utf8'))
    const apiCoords = await parseApiCoords(readFileSync(resolve(PRIVATE, 'apicoords.ttl'), 'utf8'))
    const nodes = apiCoords.instances.map((i) => ({ id: i.name, data: { name: i.name, apiCoord: { coordIri: i.coordIri } } }))
    const roles = new Map(nodes.map((n) => [n.id, resolveBioRole(n.data, { apiCoords, nodes })]))
    const layout = layoutBioView(nodes, roles)

    const proteins = expected.instances.filter((i) => i.kind === 'deployment').map((i) => layout.get(i.name))
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
