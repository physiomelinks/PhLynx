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
