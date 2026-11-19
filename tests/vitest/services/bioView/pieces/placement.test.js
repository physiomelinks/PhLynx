import { describe, expect, it } from 'vitest'

import { getBuiltInTemplate } from '../../../../../src/services/bioView/builtInTemplates.js'
import { validatePieces } from '../../../../../src/services/bioView/pieces/model.js'
import { topologyOf } from '../../../../../src/services/bioView/pieces/topology.js'
import { locatePlace, preparePlacement } from '../../../../../src/services/bioView/placement.js'
import { GO } from '../../../../../src/services/annotations/iris.js'
import { CARDIOMYOCYTE, CHEMICAL_SYNAPSE, ROD, TWO_CELL_EPITHELIUM } from '../../../fixtures/pieces.js'

const valid = (raw) => {
  const { pieces, errors } = validatePieces(raw)
  expect(errors).toEqual([])
  return pieces
}

/** A node bound to a site, as a drop leaves it. */
const boundTo = (site) => ({ id: `on:${site}`, data: { name: 'm', bioView: { site } } })

/** A place compared on what locating reads: its key's path, its kind, what it answers to, its facets and sides. */
const comparable = (place, rename) => ({
  key: rename(place.key.replace(/^site:[^/]+\//, '')),
  kind: place.kind,
  as: [...place.as].sort(),
  ...(place.facets && { facets: [...place.facets].sort() }),
  ...(place.sides?.length && { sides: [...place.sides].sort() }),
})

/**
 * Each site's places, old template against pieces, through locatePlace. `rename` turns an old site path into the
 * pieces' (see fixtures/pieces.js).
 */
function compare(templateId, raw, rename, { skip = [] } = {}) {
  const template = getBuiltInTemplate(templateId)
  const pieces = valid(raw)
  const oldPrepared = preparePlacement([], {
    instances: [{ id: 'tpl', template: templateId, at: { x: 0, y: 0 } }],
    definitions: new Map([[templateId, template]]),
  })
  const newPrepared = preparePlacement([], { pieces })
  const paths = topologyOf(pieces).sites.map((site) => site.path)
  const compared = []
  for (const site of oldSites(template)) {
    if (skip.includes(site)) continue
    const path = rename(site)
    expect(paths, `${templateId}: ${site} -> ${path}`).toContain(path)
    const before = locatePlace(boundTo(`tpl/${site}`), oldPrepared).map((place) => comparable(place, rename))
    const after = locatePlace(boundTo(`pieces/${path}`), newPrepared).map((place) => comparable(place, (p) => p))
    expect(after, `${templateId}: ${site}`).toEqual(before)
    compared.push(site)
  }
  return compared
}

/** The old template's site paths. */
function oldSites(template) {
  const paths = []
  for (const cell of template.cells) {
    if (cell.site !== false) paths.push(cell.id)
    if (cell.membrane) paths.push(`${cell.id}.membrane`)
    for (const piece of [...cell.facets, ...cell.processes])
      if (piece.site !== false) paths.push(`${cell.id}.${piece.id}`)
  }
  for (const piece of [...template.compartments, ...(template.links ?? [])])
    if (piece.site !== false) paths.push(piece.id)
  return paths
}

/**
 * Renames an old path: a cell's membrane is '<cell>-membrane', a facet a span of it, a fold or process a piece of its
 * own, everything else the same id.
 */
const renamer = (pieces) => {
  const kinds = new Map(pieces.map((piece) => [piece.id, piece.kind]))
  return (path) => {
    const [first, second] = path.split('.')
    if (second === undefined) return path
    if (second === 'membrane') return `${first}-membrane`
    if (kinds.has(second) && kinds.get(second) !== 'compartment') return second
    return `${first}-membrane.${second}`
  }
}

describe('places of nodes on the pieces’ sites, as on a template’s', () => {
  it('match the cardiomyocyte’s, through its fold, cleft and organelle', () => {
    const compared = compare('cardiomyocyte', CARDIOMYOCYTE, renamer(CARDIOMYOCYTE))
    expect(compared).toContain('myocyte.t-tubule')
    expect(compared).toContain('sr.network')
  })

  it('match the chemical synapse’s', () => {
    compare('chemical-synapse', CHEMICAL_SYNAPSE, renamer(CHEMICAL_SYNAPSE))
  })

  it('match the two-cell epithelium’s, annotated sides and all', () => {
    compare('two-cell-epithelium', TWO_CELL_EPITHELIUM, renamer(TWO_CELL_EPITHELIUM))
  })

  it('match the rod’s, but for its membrane, which no longer meets an inside it has none of', () => {
    const rename = renamer(ROD)
    compare('rod-photoreceptor', ROD, rename, { skip: ['rod.membrane'] })
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
