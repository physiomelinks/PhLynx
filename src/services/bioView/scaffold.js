/**
 * The scaffold the physiological view is laid out on: its cells, the compartments lying against them, and the
 * sites modules can be bound to. Cells and compartments are owned either by a node (worked out from its role,
 * keyed by the node id) or by a piece of a template instance (keyed 'tpl:<instance>/<path>' while empty, else
 * by the id of the node bound to it). Annotations never bind a node to a template site; only an explicit
 * bioView.site does.
 */

import { DEFAULT_TEMPLATE_ID, getBuiltInTemplate } from './builtInTemplates.js'
import { partOf } from './geometry.js'
import { EPITHELIAL_SHAPE, facetById, facetOfAnnotation, facetsInGroup, shapeFromTemplateCell } from './shape.js'
import { MEMBRANE, compartmentForm, parseSiteRef, siteRef, sitesOf } from './templates.js'

/** The tone of a compartment against nothing the epithelial template colours. */
export const DEFAULT_TONE = 'sky'

/** Sorts node ids by their node's name, then by id. */
export const byName = (nodes) => (a, b) =>
  (nodes.get(a)?.data?.name ?? a).localeCompare(nodes.get(b)?.data?.name ?? b) || a.localeCompare(b)

/**
 * Orders the nodes in one row of slots: those the user ordered first, by their order, then the rest by name.
 *
 * @param {string[]} ids
 * @param {Map<string, Object>} nodes
 * @returns {string[]}
 */
export function inSlotOrder(ids, nodes) {
  const ordered = (id) => Number.isInteger(nodes.get(id)?.data?.bioView?.order)
  const placed = ids.filter(ordered).sort((a, b) => nodes.get(a).data.bioView.order - nodes.get(b).data.bioView.order || byName(nodes)(a, b))
  return [...placed, ...ids.filter((id) => !ordered(id)).sort(byName(nodes))]
}

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

/** The key of a template piece no node is bound to. */
export const templateKey = (instanceId, path) => `tpl:${instanceId}/${path}`

/**
 * Finds the template site each node is bound to through its bioView.site. A site whose instance, template or
 * path is missing is dangling, so its node is unbound; of several nodes on a one-module site, the first by
 * name holds it and the rest are unbound.
 *
 * @param {Array<Object>} instances
 * @param {Map<string, Object>} definitions
 * @param {Array<{id: string, data?: Object}>} nodes
 * @returns {Map<string, string[]>} Site ref -> the ids bound to it, in slot order.
 */
export function boundSites(instances, definitions, nodes) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const offered = new Map()
  for (const instance of instances) {
    const template = definitions.get(instance.template)
    if (!template) continue
    for (const site of sitesOf(template)) offered.set(siteRef(instance.id, site.path), site)
  }
  const bound = new Map()
  for (const id of nodes.map((node) => node.id).sort(byName(byId))) {
    const parsed = parseSiteRef(byId.get(id).data?.bioView?.site)
    const ref = parsed && siteRef(parsed.instance, parsed.path)
    const site = ref && offered.get(ref)
    if (!site) continue
    const ids = bound.get(ref) ?? []
    if (site.kind === 'single' && ids.length) continue
    bound.set(ref, [...ids, id])
  }
  for (const [ref, ids] of bound) bound.set(ref, inSlotOrder(ids, byId))
  return bound
}

/**
 * Builds the scaffold of template instances: each instance's cells and compartments, in declaration order,
 * keyed by the node bound to its one-module site or 'tpl:<instance>/<path>' while that is empty, with the
 * nodes bound to each facet and process area.
 *
 * @param {Array<{id: string, template: string, at: {x: number, y: number}, label?: string}>} instances
 * @param {Map<string, Object>} definitions - Template id -> its validated template.
 * @param {Array<{id: string, data?: Object}>} [nodes] - The flow's nodes, to find the ones bound to sites.
 * @returns {{cells: Array<Object>, compartments: Array<Object>, sites: Map<string, Object>, bound: Map<string, string>}}
 *   - cells: { key, owner: { instance, cell }, instance, site, node, shape, label, size, row, membrane,
 *     membraneSite, membraneLabel, facets: [{ id, label, edge, site, members }], processes: [{ id, label, site,
 *     members }] }; site is null for a piece with none, node and membrane the ids bound to the cell and its membrane;
 *   - compartments: { key, owner: { instance, compartment }, instance, site, node, form, against: [{ cellKey,
 *     facetId, edge }], tone, depth, label, side: null, adjacent: null, storedRect: null };
 *   - sites: site ref -> { ref, instance, path, role, kind, label, occupants, key }, key being the piece's own
 *     key or, for a facet or process, its cell's;
 *   - bound: node id -> the site ref it holds.
 *   Instances whose template is missing are left out.
 */
export function scaffoldFromTemplates(instances, definitions, nodes = []) {
  const occupied = boundSites(instances, definitions, nodes)
  const scaffold = { cells: [], compartments: [], sites: new Map(), bound: new Map() }
  for (const [ref, ids] of occupied) for (const id of ids) scaffold.bound.set(id, ref)

  for (const instance of instances) {
    const template = definitions.get(instance.template)
    if (!template) continue
    const offered = new Map(sitesOf(template).map((site) => [site.path, site]))
    // A piece's own site, if it offers one, and the nodes bound to it.
    const siteOf = (path) => (offered.has(path) ? siteRef(instance.id, path) : null)
    const members = (path) => occupied.get(siteOf(path)) ?? []
    const keyOf = (path) => members(path)[0] ?? templateKey(instance.id, path)
    const offer = (path, key) => {
      const ref = siteOf(path)
      if (ref) scaffold.sites.set(ref, { ref, instance: instance.id, ...offered.get(path), occupants: members(path), key })
    }

    const cellKeys = new Map()
    for (const cell of template.cells) {
      const key = keyOf(cell.id)
      cellKeys.set(cell.id, key)
      const membranePath = `${cell.id}.${MEMBRANE}`
      scaffold.cells.push({
        key,
        owner: { instance: instance.id, cell: cell.id },
        instance: instance.id,
        site: siteOf(cell.id),
        node: members(cell.id)[0] ?? null,
        shape: shapeFromTemplateCell(cell),
        label: cell.label,
        size: { ...cell.size },
        row: cell.row,
        membrane: members(membranePath)[0] ?? null,
        membraneSite: siteOf(membranePath),
        membraneLabel: cell.membrane ? cell.membrane.label : null,
        facets: cell.facets.map(({ id, label, edge }) => ({
          id,
          label,
          edge,
          site: siteOf(`${cell.id}.${id}`),
          members: members(`${cell.id}.${id}`),
        })),
        processes: cell.processes.map(({ id, label }) => ({
          id,
          label,
          site: siteOf(`${cell.id}.${id}`),
          members: members(`${cell.id}.${id}`),
        })),
      })
      offer(cell.id, key)
      offer(membranePath, key)
      for (const piece of [...cell.facets, ...cell.processes]) offer(`${cell.id}.${piece.id}`, key)
    }

    for (const compartment of template.compartments) {
      const key = keyOf(compartment.id)
      const against = compartment.against.map((entry) => {
        const [cellId, facetId] = entry.split('.')
        const edge = template.cells.find((cell) => cell.id === cellId).facets.find((facet) => facet.id === facetId).edge
        return { cellKey: cellKeys.get(cellId), facetId, edge }
      })
      scaffold.compartments.push({
        key,
        owner: { instance: instance.id, compartment: compartment.id },
        instance: instance.id,
        site: siteOf(compartment.id),
        node: members(compartment.id)[0] ?? null,
        form: compartmentForm(template, compartment),
        against,
        tone: compartment.tone,
        depth: compartment.depth ?? null,
        label: compartment.label,
        side: null,
        adjacent: null,
        storedRect: null,
      })
      offer(compartment.id, key)
    }
  }
  return scaffold
}
