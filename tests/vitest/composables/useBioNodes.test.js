import { describe, expect, it } from 'vitest'

import { bioFlowNodes, bioViewForMove, shareEqual } from '../../../src/composables/useBioNodes.js'
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
  it('draws a process’s cartoon on its card when it has one', () => {
    const { nodes, roles } = workspace()
    roles.set('gly', role('cytosolic', { glyph: 'mitochondrion' }))
    const bio = bioFlowNodes(nodes, roles, layoutBioView(nodes, roles))
    expect(bio.find((n) => n.id === 'gly')).toMatchObject({ type: 'bioCard', data: { name: 'gly', glyph: 'mitochondrion' } })
  })

  it('draws each instance with the id it has in the diagram, a membrane over its cell’s outline', () => {
    const { nodes, roles, layout } = workspace()
    const bio = bioFlowNodes(nodes, roles, layout)
    expect(bio.map((n) => [n.id, n.type]).sort()).toEqual([
      ['cell', 'bioCell'],
      ['gly', 'bioCard'],
      ['loose', 'bioProtein'],
      ['lumen', 'bioRegion'],
      ['p', 'bioProtein'],
      ['plain', 'bioCard'],
      ['wall', 'bioMembrane'],
    ])
    expect(bio.find((n) => n.id === 'cell').data.membrane).toBe('wall')
  })

  it('lays a membrane over its cell, under what sits in it, and lets only its band be hit', () => {
    const { nodes, roles, layout } = workspace()
    const bio = bioFlowNodes(nodes, roles, layout)
    const byId = Object.fromEntries(bio.map((n) => [n.id, n]))
    const { width, height } = layout.get('cell').rect
    expect(byId.wall).toMatchObject({
      parentNode: 'cell',
      position: { x: 0, y: 0 },
      width,
      height,
      // The node's box covers the whole cell; BioMembrane's band takes pointer events back on the bilayer.
      style: { pointerEvents: 'none' },
      data: { width, height },
    })
    // vue-flow puts a child one above max(its zIndex, its parent's): over the cell, under proteins and cards.
    expect(byId.wall.zIndex).toBe(byId.cell.zIndex)
    expect(byId.p.zIndex ?? 0).toBeGreaterThan(byId.wall.zIndex)
    expect(bio.findIndex((n) => n.id === 'cell')).toBeLessThan(bio.findIndex((n) => n.id === 'wall'))
    // Dragging its outline moves its cell (see BioFlow), so it is draggable.
    expect(byId.wall.draggable).toBeUndefined()
  })

  it('makes proteins in a membrane and processes in a cell children of it, after it', () => {
    const { nodes, roles, layout } = workspace()
    const bio = bioFlowNodes(nodes, roles, layout)
    const index = (id) => bio.findIndex((n) => n.id === id)
    const p = bio[index('p')]
    expect(p).toMatchObject({ parentNode: 'cell', data: { glyph: 'pump', facet: 'apical', rotation: 0, droppable: true } })
    expect(p.draggable).toBeUndefined()
    expect(bio[index('gly')]).toMatchObject({ parentNode: 'cell', extent: 'parent' })
    expect(bio[index('gly')].data.glyph).toBeUndefined()
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

  it('gives each protein what its cartoon’s arrows show', () => {
    const { nodes, roles, layout } = workspace()
    const transport = new Map([['p', [{ label: 'Na⁺', direction: 'out' }]]])
    const bio = bioFlowNodes(nodes, roles, layout, transport)
    expect(bio.find((n) => n.id === 'p').data.arrows).toEqual([{ label: 'Na⁺', direction: 'out' }])
    expect(bio.find((n) => n.id === 'loose').data.arrows).toEqual([])
  })

  it('keeps a moved cell or region as its rect, and anything else as its position', () => {
    expect(bioViewForMove({ type: 'bioCell', width: 400, height: 300 }, { x: 10, y: 20 })).toEqual({ rect: { x: 10, y: 20, width: 400, height: 300 } })
    expect(bioViewForMove({ type: 'bioCard', width: 180, height: 72 }, { x: 5, y: 6 })).toEqual({ position: { x: 5, y: 6 } })
    // In whole flow units, as a drag on a zoomed view gives fractions.
    expect(bioViewForMove({ type: 'bioRegion', width: 600, height: 180 }, { x: 50.67, y: 37.33 })).toEqual({
      rect: { x: 51, y: 37, width: 600, height: 180 },
    })
  })

  it('lays out again from what a move stored, putting the node where it was dropped', () => {
    const { nodes, roles } = workspace()
    const moved = nodes.map((n) => (n.id === 'plain' ? { ...n, data: { ...n.data, bioView: bioViewForMove({ type: 'bioCard' }, { x: 900, y: 50 }) } } : n))
    const bio = bioFlowNodes(moved, roles, layoutBioView(moved, roles))
    expect(bio.find((n) => n.id === 'plain').position).toEqual({ x: 900, y: 50 })
  })
})

describe('shareEqual', () => {
  it('keeps what is unchanged, so only the changed parts are new objects', () => {
    const previous = { id: 'a', data: { name: 'a', handles: [{ id: 'h', x: 1 }] }, position: { x: 0, y: 0 } }
    expect(shareEqual(previous, structuredClone(previous))).toBe(previous)

    const next = { ...structuredClone(previous), data: { name: 'b', handles: [{ id: 'h', x: 1 }] } }
    const shared = shareEqual(previous, next)
    expect(shared).not.toBe(previous)
    expect(shared.data.name).toBe('b')
    expect(shared.data.handles).toBe(previous.data.handles)
    expect(shared.position).toBe(previous.position)
  })

  it('treats added or removed fields and entries as changes', () => {
    expect(shareEqual({ a: 1 }, { a: 1, b: undefined })).toEqual({ a: 1, b: undefined })
    expect(shareEqual([1, 2], [1])).toEqual([1])
    expect(shareEqual(undefined, { a: 1 })).toEqual({ a: 1 })
  })
})
