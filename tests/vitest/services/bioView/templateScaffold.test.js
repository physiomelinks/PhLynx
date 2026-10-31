import { describe, expect, it } from 'vitest'

import { BUILT_IN_TEMPLATES } from '../../../../src/services/bioView/builtInTemplates.js'
import { boundSites, scaffoldFromTemplates } from '../../../../src/services/bioView/scaffold.js'

const node = (id, bioView) => ({ id, data: { name: id, ...(bioView && { bioView }) } })
const definitions = new Map(BUILT_IN_TEMPLATES.map((template) => [template.id, template]))
const instances = [{ id: 'bt-1', template: 'two-cell-epithelium', at: { x: 0, y: 0 } }]

describe('scaffold from templates', () => {
  it('keys empty pieces by instance and path, with their facets, forms and sites', () => {
    const { cells, compartments, sites, bound } = scaffoldFromTemplates(instances, definitions)
    expect(cells.map((cell) => cell.key)).toEqual(['tpl:bt-1/a', 'tpl:bt-1/b'])
    expect(cells[0]).toMatchObject({
      owner: { instance: 'bt-1', cell: 'a' },
      site: 'bt-1/a',
      node: null,
      membrane: null,
      membraneSite: 'bt-1/a.membrane',
      membraneLabel: 'Plasma membrane (A)',
      size: { width: 320, height: 240 },
      row: 0,
    })
    expect(cells[0].facets.map((facet) => [facet.id, facet.edge, facet.members])).toEqual([
      ['apical', 'top', []],
      ['basolateral', 'bottom', []],
      ['lateral-left', 'left', []],
      ['lateral-right', 'right', []],
    ])
    expect(compartments.map((piece) => [piece.key, piece.form])).toEqual([
      ['tpl:bt-1/apical-fluid', 'band'],
      ['tpl:bt-1/basolateral-fluid', 'band'],
      ['tpl:bt-1/paracellular', 'gap'],
    ])
    expect(compartments[2].against).toEqual([
      { cellKey: 'tpl:bt-1/a', facetId: 'lateral-right', edge: 'right' },
      { cellKey: 'tpl:bt-1/b', facetId: 'lateral-left', edge: 'left' },
    ])
    expect(sites.get('bt-1/a.apical')).toMatchObject({ role: 'membraneProtein', kind: 'slots', occupants: [], key: 'tpl:bt-1/a' })
    expect(bound).toEqual(new Map())
  })

  it('keys a bound piece by its node and lists slot members in order, then by name', () => {
    const nodes = [
      node('cyto', { site: 'bt-1/a' }),
      node('z', { site: 'bt-1/a.apical' }),
      node('y', { site: 'bt-1/a.apical', order: 0 }),
      node('x', { site: 'bt-1/a.apical' }),
      node('fluid', { site: 'bt-1/paracellular' }),
    ]
    const { cells, compartments, bound } = scaffoldFromTemplates(instances, definitions, nodes)
    expect(cells[0]).toMatchObject({ key: 'cyto', node: 'cyto' })
    expect(cells[0].facets[0].members).toEqual(['y', 'x', 'z'])
    expect(compartments[2].key).toBe('fluid')
    expect(compartments[2].against[0].cellKey).toBe('cyto')
    expect(bound.get('x')).toBe('bt-1/a.apical')
  })

  it('binds by explicit site only, leaving dangling sites and missing templates unbound', () => {
    const nodes = [
      node('a', { site: 'bt-2/cell' }),
      node('b', { site: 'bt-1/nowhere' }),
      node('c', { role: 'cytosol' }),
      node('d', { site: 'bt-3/cell' }),
    ]
    const withMissing = [...instances, { id: 'bt-3', template: 'gone', at: { x: 0, y: 0 } }]
    expect(boundSites(withMissing, definitions, nodes)).toEqual(new Map())
    expect(scaffoldFromTemplates(withMissing, definitions, nodes).cells).toHaveLength(2)
  })
})
