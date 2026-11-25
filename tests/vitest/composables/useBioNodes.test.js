import { describe, expect, it } from 'vitest'

import { bioFlowNodes, shareEqual } from '../../../src/composables/useBioNodes.js'
import { SYMBOL_HEIGHT, SYMBOL_WIDTH } from '../../../src/services/bioView/geometry.js'
import { layoutPhysiology } from '../../../src/services/bioView/layout.js'
import { getBuiltInPieceTemplate } from '../../../src/services/bioView/pieces/builtInTemplates.js'
import { boundToPieces, layoutPieces, pieceKey } from '../../../src/services/bioView/pieces/layout.js'
import { validatePieces } from '../../../src/services/bioView/pieces/model.js'

const role = (role, extra = {}) => ({ role, skin: null, ...extra })
const EPITHELIAL = getBuiltInPieceTemplate('epithelial-cell').pieces

/** As useBioNodes lays the view out: the pieces with the nodes bound to them, and the rest beside them. */
function layOut(nodes, roles, pieces = EPITHELIAL) {
  const laidOut = layoutPieces(pieces, { nodes })
  const placedElsewhere = new Set(boundToPieces(pieces, nodes).bound.keys())
  const around = [...laidOut.rects.values()]
  return new Map([...layoutPhysiology(nodes, roles, { placedElsewhere, around }).places, ...laidOut.places])
}

/** An epithelial cell with its membrane, a protein, a process and the apical fluid on it, and two loose modules. */
function workspace() {
  const on = (site) => ({ bioView: { site: `pieces/${site}` } })
  const nodes = [
    { id: 'cell', data: { name: 'cell', ...on('cell') } },
    { id: 'wall', data: { name: 'wall', ...on('plasma-membrane') } },
    { id: 'p', data: { name: 'p', domainType: 'highlight', ...on('plasma-membrane.apical') }, selected: true },
    { id: 'gly', data: { name: 'gly', ...on('metabolism') } },
    { id: 'lumen', data: { name: 'lumen', ...on('apical-fluid') } },
    { id: 'loose', data: { name: 'loose' } },
    { id: 'plain', data: { name: 'plain' } },
  ]
  const roles = new Map([
    ['cell', role('cytosol')],
    ['wall', role('membrane')],
    ['p', role('membraneProtein', { skin: 'pump' })],
    ['gly', role('cytosolic')],
    ['lumen', role('region')],
    ['loose', role('membraneProtein', { skin: 'channel' })],
    ['plain', role('none')],
  ])
  return { nodes, roles, layout: layOut(nodes, roles) }
}

describe('physiological view nodes', () => {
  it('clears what an instance only had as another kind of node, since vue-flow merges onto the node it had', () => {
    const { nodes, roles, layout } = workspace()
    // The membrane over its cell's outline, which takes no clicks.
    const wall = bioFlowNodes(nodes, roles, layout).find((n) => n.id === 'wall')
    expect(wall).toMatchObject({ zIndex: expect.any(Number), style: { pointerEvents: 'none' } })
    // Taken off the membrane, a card names those fields with nothing in them, so the merge clears them.
    const loose = nodes.map((n) => (n.id === 'wall' ? { ...n, data: { name: 'wall' } } : n))
    const card = bioFlowNodes(loose, roles, layOut(loose, roles)).find((n) => n.id === 'wall')
    expect(card.type).toBe('bioCard')
    for (const field of ['extent', 'zIndex', 'style']) {
      expect(Object.hasOwn(card, field)).toBe(true)
      expect(card[field]).toBeUndefined()
    }
  })

  it('draws a loose process as a card with its symbol, and a loose card of anything else without one', () => {
    const { nodes, roles, layout } = workspace()
    roles.set('plain', role('cytosolic', { skin: 'process' }))
    expect(bioFlowNodes(nodes, roles, layout).find((n) => n.id === 'plain').data.skin).toBe('process')
    roles.set('plain', role('region', { skin: 'blob' }))
    expect(bioFlowNodes(nodes, roles, layout).find((n) => n.id === 'plain').data.skin).toBeUndefined()
  })

  it('draws a process in a zone with its cartoon, when it has one', () => {
    const { nodes, roles, layout } = workspace()
    roles.set('gly', role('cytosolic', { skin: 'mitochondrion' }))
    expect(bioFlowNodes(nodes, roles, layout).find((n) => n.id === 'gly')).toMatchObject({
      type: 'bioProtein',
      data: { name: 'gly', skin: 'mitochondrion' },
    })
  })

  it('draws each instance with the id it has in the diagram, a membrane over its cell’s outline', () => {
    const { nodes, roles, layout } = workspace()
    const bio = bioFlowNodes(nodes, roles, layout)
    const ids = new Set(nodes.map((n) => n.id))
    expect(
      bio
        .filter((n) => ids.has(n.id))
        .map((n) => [n.id, n.type])
        .sort(),
    ).toEqual([
      ['cell', 'bioCell'],
      ['gly', 'bioProtein'],
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
    // vue-flow puts a child one above max(its zIndex, its parent's): over every cell and compartment, under
    // proteins and cards.
    expect(byId.wall.zIndex).toBeGreaterThan(byId.cell.zIndex)
    expect(byId.p.zIndex ?? 0).toBeGreaterThan(byId.wall.zIndex)
    expect(bio.findIndex((n) => n.id === 'cell')).toBeLessThan(bio.findIndex((n) => n.id === 'wall'))
    // A piece's membrane moves only with its piece.
    expect(byId.wall.draggable).toBe(false)
  })

  it('makes proteins in a membrane and processes in a cell children of it, after it', () => {
    const { nodes, roles, layout } = workspace()
    const bio = bioFlowNodes(nodes, roles, layout)
    const index = (id) => bio.findIndex((n) => n.id === id)
    const p = bio[index('p')]
    expect(p).toMatchObject({
      parentNode: 'cell',
      data: { skin: 'pump', facet: 'apical', rotation: 0, droppable: true },
    })
    expect(p.draggable).toBeUndefined()
    expect(bio[index('gly')]).toMatchObject({ parentNode: 'cell', data: { skin: 'process', droppable: true } })
    expect(bio[index('gly')].extent).toBeUndefined()
    expect(index('cell')).toBeLessThan(index('p'))
    // Relative to the cell, centred on its slot on the outline.
    const slot = layout.get('p')
    const cell = layout.get('cell').rect
    expect(p.position).toEqual({ x: slot.x - SYMBOL_WIDTH / 2 - cell.x, y: slot.y - SYMBOL_HEIGHT / 2 - cell.y })
  })

  it('follows the diagram’s selection and colours, and puts regions and cells under the rest', () => {
    const { nodes, roles, layout } = workspace()
    const bio = bioFlowNodes(nodes, roles, layout)
    const byId = Object.fromEntries(bio.map((n) => [n.id, n]))
    expect(byId.p.selected).toBe(true)
    expect(byId.cell.selected).toBe(false)
    expect(byId.p.data.domainType).toBe('highlight')
    expect(byId.lumen.zIndex).toBeLessThan(byId.cell.zIndex)
    expect(byId.loose).toMatchObject({ data: { unplaced: true, skin: 'channel' } })
    expect(byId.loose.parentNode).toBeUndefined()
  })

  it('draws what is nested over what it is in, however deep, under the membranes', () => {
    const { pieces, errors } = validatePieces([
      { id: 'cell', kind: 'compartment', label: 'Cell' },
      { id: 'pm', kind: 'membrane', label: 'PM', encloses: ['cell'], frame: { x: 0, y: 0, width: 600, height: 400 } },
      {
        id: 'inner',
        kind: 'compartment',
        label: 'Inner',
        parent: 'cell',
        frame: { x: 40, y: 40, width: 300, height: 200 },
      },
      {
        id: 'deeper',
        kind: 'compartment',
        label: 'Deeper',
        parent: 'inner',
        frame: { x: 20, y: 20, width: 120, height: 80 },
      },
    ])
    expect(errors).toEqual([])
    // The membrane's band is its module's node.
    const nodes = [{ id: 'wall', data: { name: 'wall', bioView: { site: 'pieces/pm' } } }]
    const { places } = layoutPieces(pieces, { nodes })
    const z = Object.fromEntries(bioFlowNodes(nodes, new Map(), places).map((n) => [n.id, n.zIndex]))
    const [cell, inner, deeper, band] = [pieceKey('pm'), pieceKey('inner'), pieceKey('deeper'), 'wall']
    expect(places.get(inner).parent).toBe(cell)
    expect(places.get(deeper).parent).toBe(inner)
    expect(z[inner]).toBeGreaterThan(z[cell])
    expect(z[deeper]).toBeGreaterThan(z[inner])
    expect(z[band]).toBeGreaterThan(z[deeper])
  })

  it('draws a process zone’s modules as cartoons, and the zone as empty only until one is in it', () => {
    const { pieces, errors } = validatePieces([
      { id: 'cell', kind: 'compartment', label: 'Cell' },
      { id: 'z', kind: 'zone', label: 'Process zone', compartment: 'cell' },
    ])
    expect(errors).toEqual([])
    const zoneOf = (bio) => bio.find((n) => n.id === pieceKey('z'))
    expect(zoneOf(bioFlowNodes([], new Map(), layoutPieces(pieces).places)).data.empty).toBe(true)
    const nodes = [{ id: 'm', data: { name: 'm', bioView: { site: 'pieces/z' } } }]
    const roles = new Map([['m', role('cytosolic')]])
    const bio = bioFlowNodes(nodes, roles, layoutPieces(pieces, { nodes }).places)
    expect(zoneOf(bio).data.empty).toBe(false)
    const m = bio.find((n) => n.id === 'm')
    expect(m).toMatchObject({ type: 'bioProtein', width: SYMBOL_WIDTH, height: SYMBOL_HEIGHT })
    // With no skin, as a process chosen to have none: a zone has no plain card, so the generic process.
    expect(m.data.skin).toBe('process')
    expect(zoneOf(bio).data.named).toBe(false)
    // Its row starts below the zone's name, so no cartoon covers it.
    const z = layoutPieces(pieces, { nodes }).places.get(pieceKey('z')).rect
    expect(layoutPieces(pieces, { nodes }).places.get('m').y).toBeGreaterThanOrEqual(z.y + 16)
  })

  it('gives each protein what its cartoon’s arrows show', () => {
    const { nodes, roles, layout } = workspace()
    const transport = new Map([['p', [{ label: 'Na⁺', direction: 'out' }]]])
    const bio = bioFlowNodes(nodes, roles, layout, transport)
    expect(bio.find((n) => n.id === 'p').data.arrows).toEqual([{ label: 'Na⁺', direction: 'out' }])
    expect(bio.find((n) => n.id === 'loose').data.arrows).toEqual([])
  })

  it('lays out again from where a move put a loose module', () => {
    const { nodes, roles } = workspace()
    const moved = nodes.map((n) =>
      n.id === 'plain' ? { ...n, data: { ...n.data, bioView: { position: { x: 900, y: 50 } } } } : n,
    )
    const bio = bioFlowNodes(moved, roles, layOut(moved, roles))
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
