/**
 * The scaffold the physiological view is laid out on: its cells, the compartments lying against them, and the
 * sites modules can be bound to. Cells and compartments are owned either by a node (worked out from its role,
 * keyed by the node id) or, later, by a piece of a template instance (keyed 'tpl:<instance>/<path>').
 * Annotations never bind a node to a template site; only an explicit bioView.site does.
 */

import { DEFAULT_TEMPLATE_ID, getBuiltInTemplate } from './builtInTemplates.js'
import { partOf } from './geometry.js'
import { EPITHELIAL_SHAPE, facetById, facetOfAnnotation, facetsInGroup } from './shape.js'

/** The tone of a compartment against nothing the epithelial template colours. */
export const DEFAULT_TONE = 'sky'

/** Sorts node ids by their node's name, then by id. */
export const byName = (nodes) => (a, b) =>
  (nodes.get(a)?.data?.name ?? a).localeCompare(nodes.get(b)?.data?.name ?? b) || a.localeCompare(b)

const roleFinder = (roles) => (id) => roles.get(id) ?? { role: 'none' }

/**
 * Gives the colour of a compartment against one of the epithelial cell's facets: that of the epithelial
 * template's compartment against it, else of one against another facet in its group.
 *
 * @param {string|null} facetId
 * @returns {string}
 */
export function epithelialTone(facetId) {
  const template = getBuiltInTemplate(DEFAULT_TEMPLATE_ID)
  const cellId = template.cells[0].id
  const against = (id) => template.compartments.find((c) => c.against.includes(`${cellId}.${id}`))
  const group = facetId && facetById(EPITHELIAL_SHAPE, facetId)?.group
  const match = facetId && (against(facetId) ?? (group && facetsInGroup(EPITHELIAL_SHAPE, group).map(against).find(Boolean)))
  return match?.tone ?? DEFAULT_TONE
}

/**
 * Gives the function that finds the cell a cell-bound node belongs to: the cell it names, else the only
 * node-owned cell when there is exactly one.
 *
 * @param {Object} scaffold
 * @param {Map<string, Object>} roles - Node id -> resolveBioRole's result.
 * @returns {(id: string) => string|null} Node id -> its cell's key.
 */
export function cellFinder(scaffold, roles) {
  const roleOf = roleFinder(roles)
  const owned = scaffold.cells.filter((cell) => cell.owner.node !== undefined).map((cell) => cell.key)
  return (id) => {
    const { cell } = roleOf(id)
    if (owned.includes(cell)) return cell
    return owned.length === 1 ? owned[0] : null
  }
}

/**
 * Builds the scaffold of the cells and regions that are nodes: each node whose role is cytosol is a cell
 * with the epithelial shape, and each whose role is region a compartment against what it is adjacent to, or,
 * known only from its annotations to face a side, along that side of the cells the annotations describe.
 *
 * @param {Array<{id: string, data?: Object}>} nodes - The flow's nodes.
 * @param {Map<string, Object>} roles - Node id -> resolveBioRole's result.
 * @returns {{cells: Array<Object>, compartments: Array<Object>, sites: Map<string, Object>}}
 *   - cells: { key, owner: { node }, shape, label, storedRect, membrane: nodeId|null, added, processes }, left to
 *     right; processes holds the cell's one implicit, unlabelled process area;
 *   - compartments: { key, owner: { node }, against: [{ cellKey, facetId, edge }], side, adjacent, tone, depth,
 *     label, storedRect }; side is the facet name it faces (the place's side), adjacent its live adjacency;
 *   - sites: site ref -> site; node-owned pieces offer none.
 */
export function scaffoldFromNodes(nodes, roles) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const ids = nodes.map((node) => node.id).sort(byName(byId))
  const roleOf = roleFinder(roles)
  const bioViewOf = (id) => byId.get(id).data?.bioView

  const cells = ids
    .filter((id) => roleOf(id).role === 'cytosol')
    .map((id) => ({
      key: id,
      owner: { node: id },
      shape: EPITHELIAL_SHAPE,
      label: byId.get(id).data?.name ?? id,
      storedRect: bioViewOf(id)?.rect ?? null,
      membrane: null,
      added: !!bioViewOf(id)?.added,
      processes: [{ id: null, label: null, implicit: true }],
    }))
  const scaffold = { cells, compartments: [], sites: new Map() }
  const onCell = cellFinder(scaffold, roles)
  for (const cell of cells) {
    cell.membrane = ids.find((id) => roleOf(id).role === 'membrane' && onCell(id) === cell.key) ?? null
  }

  const cellKeys = cells.map((cell) => cell.key)
  // A region only known from its annotations to face a side spans the cells the annotations describe, not
  // ones the user added; with none of those, every cell.
  const described = cells.filter((cell) => !cell.added)
  const spanned = described.length ? described : cells
  const edgeOf = (facetId) => facetById(EPITHELIAL_SHAPE, facetId)?.edge ?? null

  for (const id of ids.filter((id) => roleOf(id).role === 'region')) {
    // What it lies against, among the cells there are; adjacency to anything else is ignored.
    const live = (roleOf(id).adjacent ?? []).filter((entry) => cellKeys.includes(entry.cell))
    const adjacent = live.length ? live : null
    const side = adjacent ? adjacent[0].facet : roleOf(id).side
    let against = []
    let facetId = null
    if (adjacent) {
      // Along a top or bottom edge, a band across every cell adjacent on that facet; down a side, a column
      // beside the first.
      const [first] = adjacent
      facetId = partOf(first.facet, first.at)
      const edge = edgeOf(facetId)
      const entries = edge === 'left' || edge === 'right' ? [first] : adjacent.filter((entry) => entry.facet === first.facet)
      against = entries.map((entry) => ({ cellKey: entry.cell, facetId: partOf(entry.facet, entry.at), edge }))
    } else if (side) {
      facetId = facetOfAnnotation(EPITHELIAL_SHAPE, { facet: side })
      if (facetId) against = spanned.map((cell) => ({ cellKey: cell.key, facetId, edge: edgeOf(facetId) }))
    }
    scaffold.compartments.push({
      key: id,
      owner: { node: id },
      against,
      side: side ?? null,
      adjacent,
      tone: epithelialTone(facetId),
      depth: null,
      label: byId.get(id).data?.name ?? id,
      storedRect: bioViewOf(id)?.rect ?? null,
    })
  }
  return scaffold
}
