import { describe, expect, it } from 'vitest'

import { validatePieces } from '../../../../../src/services/bioView/pieces/model.js'
import { topologyOf } from '../../../../../src/services/bioView/pieces/topology.js'
import { locatePlace, preparePlacement } from '../../../../../src/services/bioView/placement.js'
import { GO } from '../../../../../src/services/annotations/iris.js'
import { CARDIOMYOCYTE, CHEMICAL_SYNAPSE, ROD, TWO_CELL_EPITHELIUM } from '../../../fixtures/pieces.js'
import PLACES from '../../../fixtures/piecePlaces.json'

const valid = (raw) => {
  const { pieces, errors } = validatePieces(raw)
  expect(errors).toEqual([])
  return pieces
}

/** A node bound to a site, as a drop leaves it. */
const boundTo = (site) => ({ id: `on:${site}`, data: { name: 'm', bioView: { site } } })

/** A place compared on what locating reads: its key's path, its kind, what it answers to, its facets and sides. */
const comparable = (place) => ({
  key: place.key.replace(/^site:[^/]+\//, ''),
  kind: place.kind,
  as: [...place.as].sort(),
  ...(place.facets && { facets: [...place.facets].sort() }),
  ...(place.sides?.length && { sides: [...place.sides].sort() }),
})

/**
 * Each site's places, through locatePlace, against those recorded from the old templates (schema 1-3) before they
 * were removed (fixtures/piecePlaces.json): the pieces were checked to mean what those templates did.
 */
function compare(templateId, raw) {
  const pieces = valid(raw)
  const prepared = preparePlacement([], { pieces })
  const paths = topologyOf(pieces).sites.map((site) => site.path)
  const recorded = Object.entries(PLACES[templateId])
  for (const [path, places] of recorded) {
    expect(paths, `${templateId}: ${path}`).toContain(path)
    expect(locatePlace(boundTo(`pieces/${path}`), prepared).map(comparable), `${templateId}: ${path}`).toEqual(places)
  }
  return recorded.map(([path]) => path)
}

describe('places of nodes on the pieces’ sites, as the old templates gave them', () => {
  it('match the cardiomyocyte’s, through its fold, cleft and organelle', () => {
    const compared = compare('cardiomyocyte', CARDIOMYOCYTE)
    expect(compared).toContain('t-tubule')
    expect(compared).toContain('sr-membrane.network')
  })

  it('match the chemical synapse’s', () => {
    compare('chemical-synapse', CHEMICAL_SYNAPSE)
  })

  it('match the two-cell epithelium’s, annotated sides and all', () => {
    compare('two-cell-epithelium', TWO_CELL_EPITHELIUM)
  })

  it('match the rod’s, but for its membrane, which no longer meets an inside it has none of', () => {
    compare('rod-photoreceptor', ROD)
    const prepared = preparePlacement([], { pieces: valid(ROD) })
    expect(locatePlace(boundTo('pieces/rod-membrane'), prepared)).toEqual([
      expect.objectContaining({ key: 'site:pieces/rod-membrane', kind: 'membrane', as: ['self'] }),
    ])
  })
})

describe('relative sides on an organelle', () => {
  it('put a protein on the SR membrane between the SR lumen inside and the cytosol outside', () => {
    const prepared = preparePlacement([], { pieces: valid(CARDIOMYOCYTE) })
    const places = locatePlace(boundTo('pieces/sr-membrane.network'), prepared)
    expect(places.map(({ key, kind, as }) => [key, kind, as])).toEqual([
      ['site:pieces/sr-membrane.network', 'membraneProtein', []],
      ['site:pieces/sr', 'cytosol', [GO.cytoplasm]],
      ['site:pieces/sr-membrane', 'membrane', [GO.plasmaMembrane]],
      ['site:pieces/myocyte', 'cytosol', [GO.extracellularRegion]],
    ])
  })

  it('leave a node bound to a site the pieces don’t offer unplaced by them', () => {
    const prepared = preparePlacement([], { pieces: valid(CARDIOMYOCYTE) })
    expect(locatePlace(boundTo('pieces/nowhere'), prepared)).toEqual([])
  })
})
