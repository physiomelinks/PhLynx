import { describe, expect, it } from 'vitest'

import { cellFinder, epithelialTone, scaffoldFromNodes } from '../../../../src/services/bioView/scaffold.js'
import { EPITHELIAL_SHAPE } from '../../../../src/services/bioView/shape.js'

const node = (id, bioView) => ({ id, data: { name: id, ...(bioView && { bioView }) } })
const role = (role, extra = {}) => ({ role, facet: null, cell: null, side: null, glyph: null, ...extra })

describe('scaffold from nodes', () => {
  it('makes a cell of each cytosol, by name, with the epithelial shape and one implicit process area', () => {
    const rect = { x: 1, y: 2, width: 400, height: 300 }
    const nodes = [node('b', { rect }), node('a', { added: true }), node('wall'), node('plain')]
    const roles = new Map([
      ['a', role('cytosol')],
      ['b', role('cytosol')],
      ['wall', role('membrane', { cell: 'b' })],
      ['plain', role('none')],
    ])
    const { cells, compartments, sites } = scaffoldFromNodes(nodes, roles)
    expect(cells.map((cell) => cell.key)).toEqual(['a', 'b'])
    expect(cells[0]).toEqual({
      key: 'a',
      owner: { node: 'a' },
      shape: EPITHELIAL_SHAPE,
      label: 'a',
      storedRect: null,
      membrane: null,
      added: true,
      processes: [{ id: null, label: null, implicit: true }],
    })
    expect(cells[1]).toMatchObject({ storedRect: rect, membrane: 'wall', added: false })
    expect(compartments).toEqual([])
    expect(sites).toEqual(new Map())
  })

  it('gives a lone cell the membrane and members that name no cell, but not when there are several', () => {
    const roles = new Map([
      ['c', role('cytosol')],
      ['w1', role('membrane')],
      ['w2', role('membrane', { cell: 'c' })],
    ])
    const scaffold = scaffoldFromNodes(['c', 'w2', 'w1'].map((id) => node(id)), roles)
    expect(scaffold.cells[0].membrane).toBe('w1')
    expect(cellFinder(scaffold, roles)('w1')).toBe('c')

    roles.set('d', role('cytosol'))
    const two = scaffoldFromNodes(['c', 'd', 'w1', 'w2'].map((id) => node(id)), roles)
    expect(two.cells.map((cell) => cell.membrane)).toEqual(['w2', null])
    expect(cellFinder(two, roles)('w1')).toBeNull()
  })

  it('counts only node-owned cells for the lone-cell fallback', () => {
    const scaffold = {
      cells: [{ key: 'c', owner: { node: 'c' } }, { key: 'tpl:bt-x1/cell', owner: { instance: 'bt-x1', cell: 'cell' } }],
    }
    expect(cellFinder(scaffold, new Map([['p', role('membraneProtein')]]))('p')).toBe('c')
  })

  it('puts a region against the facets it is adjacent to, ignoring cells that are gone', () => {
    const roles = new Map([
      ['a', role('cytosol')],
      ['b', role('cytosol')],
      ['para', role('region', { adjacent: [{ cell: 'gone', facet: 'apical' }, { cell: 'a', facet: 'lateral', at: 'right' }, { cell: 'b', facet: 'lateral', at: 'left' }] })],
      ['lumen', role('region', { adjacent: [{ cell: 'a', facet: 'apical' }, { cell: 'b', facet: 'basolateral' }, { cell: 'b', facet: 'apical' }] })],
      ['lost', role('region', { adjacent: [{ cell: 'gone', facet: 'apical' }] })],
    ])
    const { compartments } = scaffoldFromNodes(['a', 'b', 'para', 'lumen', 'lost'].map((id) => node(id)), roles)
    const byKey = Object.fromEntries(compartments.map((piece) => [piece.key, piece]))
    expect(byKey.para).toMatchObject({
      owner: { node: 'para' },
      against: [{ cellKey: 'a', facetId: 'lateral-right', edge: 'right' }],
      side: 'lateral',
      tone: 'teal',
      depth: null,
      label: 'para',
    })
    expect(byKey.para.adjacent).toHaveLength(2)
    expect(byKey.lumen).toMatchObject({
      against: [
        { cellKey: 'a', facetId: 'apical', edge: 'top' },
        { cellKey: 'b', facetId: 'apical', edge: 'top' },
      ],
      side: 'apical',
      tone: 'sky',
    })
    expect(byKey.lost).toMatchObject({ against: [], side: null, adjacent: null, tone: 'sky' })
  })

  it('spans a region known only to face a side across the annotated cells, else every cell', () => {
    const roles = new Map([
      ['a', role('cytosol')],
      ['b', role('cytosol')],
      ['blood', role('region', { side: 'basolateral' })],
    ])
    const annotated = scaffoldFromNodes([node('a'), node('b', { added: true }), node('blood')], roles)
    expect(annotated.compartments[0]).toMatchObject({
      against: [{ cellKey: 'a', facetId: 'basolateral', edge: 'bottom' }],
      side: 'basolateral',
      adjacent: null,
      tone: 'rose',
    })
    const added = scaffoldFromNodes([node('a', { added: true }), node('b', { added: true }), node('blood')], roles)
    expect(added.compartments[0].against.map((entry) => entry.cellKey)).toEqual(['a', 'b'])
  })

  it('colours each facet as the epithelial template does', () => {
    expect(['apical', 'basolateral', 'lateral-left', 'lateral-right', null].map(epithelialTone)).toEqual([
      'sky',
      'rose',
      'teal',
      'teal',
      'sky',
    ])
  })
})
