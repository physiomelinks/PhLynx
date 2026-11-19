/**
 * Where a node bound to a site of the pieces sits, as the places its annotated quantities resolve against (see
 * placement.js, whose vocabulary these keep): the piece the site is, and the places next to it, read from the
 * topology. Sides are relative: a membrane protein's inside is what that stretch of membrane meets on its inner face,
 * its outside what it meets on its outer face, whatever membrane it is on, so the plasma-membrane reading of GO terms
 * (cytoplasm inside, extracellular region outside) holds for an organelle's membrane too.
 */

import { GO } from '../../annotations/iris.js'
import { topologyOf } from './topology.js'

const SELF = 'self'
const SELF_MEMBRANE = `self+${GO.plasmaMembrane}`

const unique = (values) => [...new Set(values.filter(Boolean))]

/** The key a site of the pieces' place has, as a template site's 'site:<instance>/<path>'. */
export const piecePlaceKey = (path) => `site:pieces/${path}`

/**
 * The places of a node bound to a site of the pieces.
 *
 * @param {ReadonlyArray<Object>} pieces - Validated.
 * @param {string} path - The site's path.
 * @returns {Array<Object>|null} The site's own place first; null for a path the pieces don't offer.
 */
export function piecePlaces(pieces, path) {
  const topology = topologyOf(pieces)
  if (!topology.sites.some((site) => site.path === path)) return null
  const membranes = pieces.filter((piece) => piece.kind === 'membrane')
  const bulks = new Set(membranes.map((membrane) => topology.bulkOf(membrane.id)).filter(Boolean))

  /** The annotated facets of the stretches a compartment meets from outside, which tell apical from basolateral. */
  const sidesOf = (id) =>
    unique(
      membranes.flatMap((membrane) =>
        topology
          .spansOf(membrane.id)
          .filter((span) => topology.outsideOf(span.path).includes(id))
          .map((span) => span.annotation?.facet),
      ),
    )
  const place = (key, label, kind, as, extra = {}) => ({ key, label, kind, as, ...extra })
  /** A compartment: a cell's or organelle's inside where it is a membrane's bulk, else a region, by its own term too. */
  const compartment = (id, as) => {
    const piece = topology.piece(id)
    if (bulks.has(id)) return place(piecePlaceKey(id), piece.label, 'cytosol', as)
    return place(piecePlaceKey(id), piece.label, 'region', piece.term ? [...as, piece.term] : as, {
      sides: sidesOf(id),
    })
  }
  /** What a membrane's proteins stand in: its spans that offer a site, and its folds. */
  const wallsOf = (membraneId) => [
    ...topology
      .spansOf(membraneId)
      .filter((span) => span.site !== false)
      .map((span) => span.id),
    ...pieces.filter((piece) => piece.kind === 'fold' && piece.membrane === membraneId).map((fold) => fold.id),
  ]
  const membrane = (id, as, facets = wallsOf(id)) =>
    place(piecePlaceKey(id), topology.piece(id).label, 'membrane', as, { facets })

  const span = topology.span(path)
  const piece = span ? null : topology.piece(path)

  // A protein in a stretch of membrane or a fold: between what it meets inside and outside.
  if (span || piece.kind === 'fold') {
    const membraneId = span ? span.membrane : piece.membrane
    const facet = span ? span.id : piece.id
    const label = span ? span.label : piece.label
    const inside = topology.insideOf(path)
    return [
      place(piecePlaceKey(path), label, 'membraneProtein', [], {
        facets: [facet],
        sides: unique([span?.annotation?.facet]),
      }),
      ...(inside ? [compartment(inside, [GO.cytoplasm])] : []),
      membrane(membraneId, [GO.plasmaMembrane], [facet]),
      ...topology.outsideOf(path).map((outside) => compartment(outside, [GO.extracellularRegion])),
    ]
  }
  switch (piece.kind) {
    case 'compartment': {
      const enclosure = bulks.has(path) && membranes.find((each) => topology.bulkOf(each.id) === path)
      return enclosure
        ? [compartment(path, [SELF]), membrane(enclosure.id, [SELF_MEMBRANE])]
        : [place(piecePlaceKey(path), piece.label, 'region', [SELF], { sides: sidesOf(path) })]
    }
    case 'membrane': {
      const bulk = topology.bulkOf(path)
      return [membrane(path, [SELF]), ...(bulk ? [compartment(bulk, [GO.cytoplasm])] : [])]
    }
    case 'zone':
      return [place(piecePlaceKey(path), piece.label, 'cytosolic', []), compartment(piece.compartment, [GO.cytoplasm])]
    case 'tube': {
      // Each end by what it is: a cell's inside, a space within a membrane (by its own term where it has one, as all
      // are cytoplasm), or a space outside every membrane.
      const end = (id) => {
        if (bulks.has(id)) return compartment(id, [GO.cytoplasm])
        const own = topology.piece(id)
        if (topology.depthOf(id) > 0) {
          return place(piecePlaceKey(id), own.label, 'region', [own.term ?? GO.cytoplasm], { sides: sidesOf(id) })
        }
        return compartment(id, [GO.extracellularRegion])
      }
      return [place(piecePlaceKey(path), piece.label, 'cytosolic', []), ...piece.ends.map(end)]
    }
    default:
      return null
  }
}
