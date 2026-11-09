/**
 * Where instances sit in the physiology view, as the places their annotated quantities resolve against: the
 * template site a node is bound to, else the cell, facet and adjacent region its bioView and role give.
 *
 * A place is { key, label, kind, as, facets?, sides? }:
 * - key: 'site:<instance>/<path>' for a template piece, 'node:<id>' for a cell or region a node owns, with
 *   '.membrane' after a cell's key for its membrane;
 * - kind: the role of the piece, e.g. 'cytosol' or 'region';
 * - as: the side-car locations that resolve to it from the node: 'self', 'self+GO:…' or a GO term;
 * - facets: the parts of a membrane it spans, which two places must share to meet;
 * - sides: the facet names a membrane protein sits on or a region lies against, which rankPlace reads.
 * A node's own place comes first; a node with no places is not placed.
 */

import { GO } from '../annotations/iris.js'
import { facetOfPart, partOf } from './geometry.js'
import { resolveBioRole } from './roles.js'
import { cellFinder, scaffoldFromNodes, scaffoldFromTemplates } from './scaffold.js'
import { EPITHELIAL_SHAPE } from './shape.js'
import { MEMBRANE, instanceTemplate, parseSiteRef, sitesOf } from './templates.js'

const SELF = 'self'
const SELF_MEMBRANE = `self+${GO.plasmaMembrane}`
const ALL_PARTS = EPITHELIAL_SHAPE.facets.map((facet) => facet.id)

const place = (key, label, kind, as, extra = {}) => ({ key, label, kind, as, ...extra })
const unique = (values) => [...new Set(values.filter(Boolean))]

/** The facet names a template compartment lies against. */
function compartmentSides(template, compartment) {
  return unique(
    compartment.against.map((entry) => {
      const [cellId, facetId] = entry.split('.')
      const cell = template.cells.find((candidate) => candidate.id === cellId)
      return cell?.facets.find((facet) => facet.id === facetId)?.annotation?.facet
    })
  )
}

/**
 * The places of a node bound to a template site.
 *
 * @returns {Array<Object>|null} Null when the site is dangling: its instance, template or path is missing.
 */
function sitePlaces(ref, { instances, definitions }) {
  const parsed = parseSiteRef(ref)
  const instance = parsed && instances.find((candidate) => candidate.id === parsed.instance)
  const template = instance && instanceTemplate(instance, definitions)
  if (!template || !sitesOf(template).some((site) => site.path === parsed.path)) return null
  const key = (path) => `site:${instance.id}/${path}`

  const compartment = template.compartments.find((candidate) => candidate.id === parsed.path)
  if (compartment) {
    return [place(key(compartment.id), compartment.label, 'region', [SELF], { sides: compartmentSides(template, compartment) })]
  }

  const [cellId, pieceId] = parsed.path.split('.')
  const cell = template.cells.find((candidate) => candidate.id === cellId)
  const facets = cell.facets.map((facet) => facet.id)
  const membraneLabel = cell.membrane?.label ?? `${cell.label} membrane`
  const cytosol = (as) => place(key(cell.id), cell.label, 'cytosol', as)
  const membrane = (as, on = facets) => place(key(`${cell.id}.${MEMBRANE}`), membraneLabel, 'membrane', as, { facets: on })

  if (!pieceId) return [cytosol([SELF]), membrane([SELF_MEMBRANE])]
  if (pieceId === MEMBRANE) return [membrane([SELF]), cytosol([GO.cytoplasm])]

  const facet = cell.facets.find((candidate) => candidate.id === pieceId)
  if (facet) {
    const outside = template.compartments
      .filter((candidate) => candidate.against.includes(parsed.path))
      .map((candidate) =>
        place(key(candidate.id), candidate.label, 'region', [GO.extracellularRegion], {
          sides: compartmentSides(template, candidate),
        })
      )
    return [
      place(key(parsed.path), facet.label, 'membraneProtein', [], { facets: [facet.id], sides: unique([facet.annotation?.facet]) }),
      cytosol([GO.cytoplasm]),
      membrane([GO.plasmaMembrane], [facet.id]),
      ...outside,
    ]
  }
  const process = cell.processes.find((candidate) => candidate.id === pieceId)
  return [place(key(parsed.path), process.label, 'cytosolic', []), cytosol([GO.cytoplasm])]
}

/**
 * Prepares what locatePlace reads: each node's role and the cells and regions the nodes not bound to a template
 * site make.
 *
 * @param {Array<{id: string, data?: Object}>} nodes - The flow's nodes.
 * @param {Object} [options]
 * @param {(mathRef: string) => Object|null} [options.sidecarFor] - A math's parsed side-car, for its role.
 * @param {Array<{id: string, template: string}>} [options.instances] - The template instances placed.
 * @param {Map<string, Object>} [options.definitions] - Template id -> its validated template.
 * @param {(node: Object, options: { sidecar: Object|null }) => Object|null} [options.workedRole] - A role worked
 *   out elsewhere (see resolveBioRole).
 * @returns {Object}
 */
export function preparePlacement(nodes, { sidecarFor = () => null, instances = [], definitions = new Map(), workedRole } = {}) {
  const roleOf = (node) => {
    const sidecar = node.data?.mathRef ? (sidecarFor(node.data.mathRef) ?? null) : null
    return resolveBioRole(node.data, { sidecar, worked: workedRole?.(node, { sidecar }) ?? null })
  }
  const roles = new Map(nodes.map((node) => [node.id, roleOf(node)]))
  const { bound } = scaffoldFromTemplates(instances, definitions, nodes)
  const free = nodes.filter((node) => !bound.has(node.id))
  const scaffold = scaffoldFromNodes(free, roles)
  return {
    instances,
    definitions,
    roles,
    roleOf,
    scaffold,
    onCell: cellFinder(scaffold, roles),
    nameOf: new Map(nodes.map((node) => [node.id, node.data?.name ?? node.id])),
  }
}

/**
 * The places of one node (see the header).
 *
 * @param {{id: string, data?: Object}} node
 * @param {Object} prepared - From preparePlacement.
 * @returns {Array<Object>} Empty when the node is not placed.
 */
export function locatePlace(node, prepared) {
  if (!node || !prepared) return []
  const fromSite = node.data?.bioView?.site ? sitePlaces(node.data.bioView.site, prepared) : null
  if (fromSite) return fromSite

  const { id } = node
  const role = prepared.roles.get(id) ?? prepared.roleOf(node)
  const nameOf = (key) => prepared.nameOf.get(key) ?? key
  const cytosol = (cell, as) => place(`node:${cell}`, nameOf(cell), 'cytosol', as)
  const membrane = (cell, as, on = ALL_PARTS) =>
    place(`node:${cell}.${MEMBRANE}`, `${nameOf(cell)} membrane`, 'membrane', as, { facets: on })

  switch (role.role) {
    case 'cytosol':
      return [cytosol(id, [SELF]), membrane(id, [SELF_MEMBRANE])]
    case 'membrane': {
      const cell = prepared.onCell(id)
      return cell ? [membrane(cell, [SELF]), cytosol(cell, [GO.cytoplasm])] : []
    }
    case 'membraneProtein': {
      const cell = prepared.onCell(id)
      if (!cell || !role.facet) return []
      const part = partOf(role.facet, role.at)
      const outside = prepared.scaffold.compartments
        .filter((piece) => piece.against.some((entry) => entry.cellKey === cell && entry.facetId === part))
        .map((piece) => place(`node:${piece.key}`, nameOf(piece.key), 'region', [GO.extracellularRegion], { sides: sidesOf(piece) }))
      return [
        place(`node:${id}`, nameOf(id), 'membraneProtein', [], { facets: [part], sides: [role.facet] }),
        cytosol(cell, [GO.cytoplasm]),
        membrane(cell, [GO.plasmaMembrane], [part]),
        ...outside,
      ]
    }
    case 'cytosolic': {
      const cell = prepared.onCell(id)
      return cell ? [place(`node:${id}`, nameOf(id), 'cytosolic', []), cytosol(cell, [GO.cytoplasm])] : []
    }
    case 'region': {
      const piece = prepared.scaffold.compartments.find((candidate) => candidate.key === id)
      return piece?.against.length ? [place(`node:${id}`, nameOf(id), 'region', [SELF], { sides: sidesOf(piece) })] : []
    }
    default:
      return []
  }
}

// The facet names a node-owned region lies against.
const sidesOf = (piece) => unique(piece.against.map((entry) => facetOfPart(entry.facetId).facet))

/**
 * The places of every node.
 *
 * @param {Array<{id: string, data?: Object}>} nodes
 * @param {Object} [options] - As for preparePlacement.
 * @returns {Map<string, Array<Object>>} Node id -> its places.
 */
export function placementsOf(nodes, options) {
  const prepared = preparePlacement(nodes, options)
  return new Map(nodes.map((node) => [node.id, locatePlace(node, prepared)]))
}

/**
 * Orders places for an edge's direction, outside in and apical first: a region against an apical facet 0, a
 * protein on one 1, a cell, its membrane or a process inside it 2, a protein on another facet 3, any other
 * region 4.
 *
 * @param {Object|undefined} place - A node's own place.
 * @returns {number} 5 for none.
 */
export function rankPlace(place) {
  const isApical = (place?.sides ?? []).includes('apical')
  switch (place?.kind) {
    case 'region':
      return isApical ? 0 : 4
    case 'membraneProtein':
      return isApical ? 1 : 3
    case 'cytosol':
    case 'membrane':
    case 'cytosolic':
      return 2
    default:
      return 5
  }
}
