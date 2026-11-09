import { describe, expect, it } from 'vitest'

import { BUILT_IN_TEMPLATES, getBuiltInTemplate } from '../../../../src/services/bioView/builtInTemplates.js'
import { siteNeighbours, sitesOf, validateTemplate } from '../../../../src/services/bioView/templates.js'

/** Each site's neighbours as 'path relation' strings, sorted. */
const table = (template) =>
  Object.fromEntries(
    sitesOf(template).map(({ path }) => [
      path,
      siteNeighbours(template, path)
        .map((n) => `${n.path} ${n.relation}`)
        .sort(),
    ])
  )

describe('siteNeighbours', () => {
  it('joins an epithelial cell’s facets to its inside, membrane and the fluids against them', () => {
    expect(table(getBuiltInTemplate('epithelial-cell'))).toEqual({
      cell: [
        'cell.apical protein',
        'cell.basolateral protein',
        'cell.lateral-left protein',
        'cell.lateral-right protein',
        'cell.membrane membrane',
        'cell.metabolism process',
      ],
      'cell.membrane': [
        'cell inside',
        'cell.apical protein',
        'cell.basolateral protein',
        'cell.lateral-left protein',
        'cell.lateral-right protein',
      ],
      'cell.apical': ['apical-fluid outside', 'cell inside', 'cell.membrane membrane'],
      'cell.basolateral': ['basolateral-fluid outside', 'cell inside', 'cell.membrane membrane'],
      // Nothing lies against the left side.
      'cell.lateral-left': ['cell inside', 'cell.membrane membrane'],
      'cell.lateral-right': ['cell inside', 'cell.membrane membrane', 'paracellular outside'],
      'cell.metabolism': ['cell inside'],
      'apical-fluid': ['cell.apical protein'],
      'basolateral-fluid': ['cell.basolateral protein'],
      paracellular: ['cell.lateral-right protein'],
    })
  })

  it('gives a gap between two cells the facets of both', () => {
    const neighbours = table(getBuiltInTemplate('two-cell-epithelium'))
    expect(neighbours.paracellular).toEqual(['a.lateral-right protein', 'b.lateral-left protein'])
    expect(neighbours['apical-fluid']).toEqual(['a.apical protein', 'b.apical protein'])
    expect(neighbours['a.lateral-left']).toEqual(['a inside', 'a.membrane membrane'])
    expect(neighbours['b.lateral-right']).toEqual(['b inside', 'b.membrane membrane'])
    expect(neighbours['b.lateral-left']).toEqual(['b inside', 'b.membrane membrane', 'paracellular outside'])
  })

  it('joins a synapse’s cleft to both cells and its other facets to nothing outside', () => {
    const neighbours = table(getBuiltInTemplate('chemical-synapse'))
    expect(neighbours.cleft).toEqual(['post.psd protein', 'pre.active-zone protein'])
    expect(neighbours.ecs).toEqual(['pre.perisynaptic protein'])
    expect(neighbours['post.psd']).toEqual(['cleft outside', 'post inside', 'post.membrane membrane'])
    expect(neighbours['pre.vesicle-cycle']).toEqual(['pre inside'])
    expect(neighbours.post).toEqual(['post.ca-signalling process', 'post.membrane membrane', 'post.psd protein'])
  })

  it('joins a vessel wall’s facets to the fluid each faces', () => {
    const vessel = table(getBuiltInTemplate('vessel-wall'))
    expect(vessel.lumen).toEqual(['endothelial.luminal protein'])
    expect(vessel['junction-cleft']).toEqual(['endothelial.junction protein'])
  })

  it.each(BUILT_IN_TEMPLATES.map((template) => [template.id, template]))(
    'holds both ways in %s, between offered sites only',
    (_, template) => {
      const offered = new Set(sitesOf(template).map((site) => site.path))
      for (const path of offered) {
        for (const neighbour of siteNeighbours(template, path)) {
          expect(offered.has(neighbour.path)).toBe(true)
          expect(siteNeighbours(template, neighbour.path).map((n) => n.path)).toContain(path)
        }
      }
    }
  )

  it('leaves out sites a template doesn’t offer, and knows no unknown path', () => {
    const { template } = validateTemplate({
      schemaVersion: 1,
      id: 'quiet',
      name: 'Quiet',
      cells: [
        {
          id: 'cell',
          label: 'Cell',
          site: false,
          facets: [
            { id: 'top', label: 'Top', edge: 'top' },
            { id: 'bottom', label: 'Bottom', edge: 'bottom', site: false },
          ],
        },
      ],
      compartments: [
        { id: 'above', label: 'Above', against: ['cell.top'] },
        { id: 'below', label: 'Below', against: ['cell.bottom'] },
      ],
    })
    // The cell's inside offers no site; its membrane, which every cell has, does.
    expect(siteNeighbours(template, 'cell.top')).toEqual([
      { path: 'cell.membrane', relation: 'membrane' },
      { path: 'above', relation: 'outside' },
    ])
    expect(siteNeighbours(template, 'below')).toEqual([])
    expect(siteNeighbours(template, 'nowhere')).toEqual([])
  })
})
