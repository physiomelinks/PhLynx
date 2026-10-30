import { describe, expect, it } from 'vitest'

import { bioFlowNodes, bioViewForMove } from '../../../src/composables/useBioNodes.js'
import { GLYPH_HEIGHT, GLYPH_WIDTH } from '../../../src/services/bioView/geometry.js'
import { layoutBioView } from '../../../src/services/bioView/layout.js'

const role = (role, extra = {}) => ({ role, facet: null, cell: null, side: null, glyph: null, ...extra })

function workspace() {
  const nodes = [
    { id: 'cell', data: { name: 'cell' } },
    { id: 'wall', data: { name: 'wall' } },
    { id: 'p', data: { name: 'p', domainType: 'highlight' }, selected: true },
    { id: 'gly', data: { name: 'gly' } },
    { id: 'lumen', data: { name: 'lumen' } },
    { id: 'loose', data: { name: 'loose' } },
    { id: 'plain', data: { name: 'plain' } },
  ]
  const roles = new Map([
    ['cell', role('cytosol')],
    ['wall', role('membrane', { cell: 'cell' })],
    ['p', role('membraneProtein', { cell: 'cell', facet: 'apical', glyph: 'pump' })],
    ['gly', role('cytosolic')],
    ['lumen', role('region', { side: 'apical' })],
    ['loose', role('membraneProtein', { glyph: 'channel' })],
    ['plain', role('none')],
  ])
  return { nodes, roles, layout: layoutBioView(nodes, roles) }
}

describe('physiological view nodes', () => {
  it('draws each instance with the id it has in the diagram, a membrane as its cell’s outline', () => {
    const { nodes, roles, layout } = workspace()
    const bio = bioFlowNodes(nodes, roles, layout)
    expect(bio.map((n) => [n.id, n.type]).sort()).toEqual([
      ['cell', 'bioCell'],
      ['gly', 'bioCard'],
      ['loose', 'bioProtein'],
      ['lumen', 'bioRegion'],
      ['p', 'bioProtein'],
      ['plain', 'bioCard'],
    ])
    expect(bio.find((n) => n.id === 'cell').data.membrane).toBe('wall')
  })

  it('makes proteins in a membrane and processes in a cell children of it, after it', () => {
    const { nodes, roles, layout } = workspace()
    const bio = bioFlowNodes(nodes, roles, layout)
    const index = (id) => bio.findIndex((n) => n.id === id)
    const p = bio[index('p')]
    expect(p).toMatchObject({ parentNode: 'cell', draggable: false, data: { glyph: 'pump', facet: 'apical', rotation: 0 } })
    expect(bio[index('gly')]).toMatchObject({ parentNode: 'cell', extent: 'parent' })
    expect(index('cell')).toBeLessThan(index('p'))
    // Relative to the cell, centred on its slot on the outline.
    const slot = layout.get('p')
    const cell = layout.get('cell').rect
    expect(p.position).toEqual({ x: slot.x - GLYPH_WIDTH / 2 - cell.x, y: slot.y - GLYPH_HEIGHT / 2 - cell.y })
  })

  it('follows the diagram’s selection and colours, and puts regions and cells under the rest', () => {
    const { nodes, roles, layout } = workspace()
    const bio = bioFlowNodes(nodes, roles, layout)
    const byId = Object.fromEntries(bio.map((n) => [n.id, n]))
    expect(byId.p.selected).toBe(true)
    expect(byId.cell.selected).toBe(false)
    expect(byId.p.data.domainType).toBe('highlight')
    expect(byId.lumen.zIndex).toBeLessThan(byId.cell.zIndex)
    expect(byId.loose).toMatchObject({ data: { unplaced: true, glyph: 'channel' } })
    expect(byId.loose.parentNode).toBeUndefined()
  })

  it('keeps a moved cell or region as its rect, and anything else as its position', () => {
    expect(bioViewForMove({ type: 'bioCell', width: 400, height: 300 }, { x: 10, y: 20 })).toEqual({ rect: { x: 10, y: 20, width: 400, height: 300 } })
    expect(bioViewForMove({ type: 'bioCard', width: 180, height: 72 }, { x: 5, y: 6 })).toEqual({ position: { x: 5, y: 6 } })
  })

  it('lays out again from what a move stored, putting the node where it was dropped', () => {
    const { nodes, roles } = workspace()
    const moved = nodes.map((n) => (n.id === 'plain' ? { ...n, data: { ...n.data, bioView: bioViewForMove({ type: 'bioCard' }, { x: 900, y: 50 }) } } : n))
    const bio = bioFlowNodes(moved, roles, layoutBioView(moved, roles))
    expect(bio.find((n) => n.id === 'plain').position).toEqual({ x: 900, y: 50 })
  })
})
