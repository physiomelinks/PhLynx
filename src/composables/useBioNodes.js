import { computed, ref, watch } from 'vue'
import { useBioTemplateStore } from '../stores/bioTemplateStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { readNodeSeries } from '../services/simulation/variableMapping'
import { flowDirection, transportedSpecies } from '../services/bioView/transport'
import { facePoint, handleFace } from '../services/bioView/faces'
import { getHandleId } from '../utils/handles'
import { GLYPH_HEIGHT, GLYPH_WIDTH } from '../services/bioView/geometry'
import { whole } from '../services/bioView/drop'
import { CARD, layoutPhysiology } from '../services/bioView/layout'
import { resolveBioRole } from '../services/bioView/roles'

/** Stacking: regions under cells under everything drawn on them. */
const Z = { region: -20, cell: -10 }

/**
 * What a template piece's node shows of its template: which instance and site it is, and how it is drawn.
 * A cell's process zones are made relative to the cell.
 *
 * @param {Object} place - A cell's or region's place from layoutPhysiology.
 * @returns {Object} Nothing for a piece that is not a template's.
 */
function templateData(place) {
  if (!place.instance) return {}
  const { instance, site = null, tone = null, edge = null } = place
  const data = { instance, site, tone, edge }
  if (place.kind !== 'cell') return data
  const { x, y } = place.rect
  const zones = (place.zones ?? []).map(({ rect, ...zone }) => ({
    ...zone,
    rect: { ...rect, x: rect.x - x, y: rect.y - y },
  }))
  return { ...data, facetLabels: place.facetLabels ?? [], zones }
}

/** Whether a place is an empty piece of a template, drawn with no node behind it. */
const isEmptyPiece = (place) => !!place.instance && place.empty && (place.kind === 'cell' || place.kind === 'region')

/**
 * Turns the physiological layout into nodes for the physiological view's flow. Each has the id of the
 * instance it draws, so selection and edits map straight back. Proteins in a membrane and processes in
 * a cell are children of the cell, so they move with it. An empty template piece is a node of its own, keyed
 * 'tpl:<instance>/<path>', that can be dragged (moving its instance) but not selected.
 *
 * @param {Array<Object>} nodes - The diagram's nodes.
 * @param {Map<string, Object>} roles - Node id -> resolveBioRole's result.
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {Map<string, Array<Object>>} [transport] - Node id -> what its cartoon's arrows show (see useBioNodes).
 * @param {Object} [options]
 * @param {boolean} [options.selection=true] - Whether each node says if it is selected; useBioNodes adds that
 *   itself, so a selection doesn't lay the nodes out again.
 * @returns {Array<Object>} vue-flow nodes; parents come before their children.
 */
export function bioFlowNodes(nodes, roles, layout, transport = new Map(), { selection = true } = {}) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const base = (id) => {
    const node = byId.get(id)
    if (!node) {
      const place = layout.get(id)
      const data = { name: place.label ?? id, domainType: null, empty: true }
      return { id, selectable: false, draggable: true, data }
    }
    return {
      id,
      ...(selection && { selected: !!node.selected }),
      data: { name: node.data?.name ?? id, domainType: node.data?.domainType ?? null },
    }
  }
  const parents = []
  const children = []

  for (const [id, place] of layout) {
    if (!byId.has(id) && !isEmptyPiece(place)) continue
    switch (place.kind) {
      case 'cell': {
        const { x, y, width, height } = place.rect
        const own = base(id)
        parents.push({
          ...own,
          type: 'bioCell',
          position: { x, y },
          width,
          height,
          zIndex: Z.cell,
          data: { ...own.data, ...templateData(place), membrane: place.membrane, width, height },
        })
        break
      }
      case 'region': {
        const { x, y, width, height } = place.rect
        const own = base(id)
        parents.push({
          ...own,
          type: 'bioRegion',
          position: { x, y },
          width,
          height,
          zIndex: Z.region,
          data: { ...own.data, ...templateData(place), side: place.side, at: place.adjacent?.[0]?.at ?? null },
        })
        break
      }
      case 'protein': {
        const cell = layout.get(place.cell).rect
        children.push({
          ...base(id),
          type: 'bioProtein',
          parentNode: place.cell,
          position: { x: place.x - GLYPH_WIDTH / 2 - cell.x, y: place.y - GLYPH_HEIGHT / 2 - cell.y },
          width: GLYPH_WIDTH,
          height: GLYPH_HEIGHT,
          data: {
            ...base(id).data,
            glyph: roles.get(id)?.glyph ?? 'generic',
            arrows: transport.get(id) ?? [],
            facet: place.facet,
            annotatedFacet: roles.get(id)?.annotatedFacet ?? null,
            rotation: place.rotation,
            outward: place.outward,
            droppable: true,
          },
        })
        break
      }
      case 'tray':
        parents.push({
          ...base(id),
          type: 'bioProtein',
          position: { x: place.x, y: place.y },
          width: GLYPH_WIDTH,
          height: GLYPH_HEIGHT,
          data: {
            ...base(id).data,
            glyph: roles.get(id)?.glyph ?? 'generic',
            arrows: transport.get(id) ?? [],
            annotatedFacet: roles.get(id)?.annotatedFacet ?? null,
            rotation: 0,
            unplaced: true,
            droppable: true,
          },
        })
        break
      case 'cytosolic': {
        const cell = layout.get(place.cell).rect
        // One bound to a template's process area can be dragged out of it, to another site or none.
        const bound = !!place.instance
        children.push({
          ...base(id),
          type: 'bioCard',
          parentNode: place.cell,
          ...(!bound && { extent: 'parent' }),
          position: { x: place.x - cell.x, y: place.y - cell.y },
          width: CARD.width,
          height: CARD.height,
          ...(bound && { data: { ...base(id).data, droppable: true } }),
        })
        break
      }
      case 'card':
        // Something with no physiological role can be dropped into a membrane to make it a protein.
        parents.push({
          ...base(id),
          type: 'bioCard',
          position: { x: place.x, y: place.y },
          width: CARD.width,
          height: CARD.height,
          data: { ...base(id).data, droppable: true },
        })
        break
      case 'membrane': {
        // Over its cell's outline, as big as the cell, but hit only on its bilayer (see BioMembrane).
        const cell = layout.get(place.cell)?.rect
        if (!cell) break
        const own = base(id)
        children.push({
          ...own,
          type: 'bioMembrane',
          parentNode: place.cell,
          position: { x: 0, y: 0 },
          width: cell.width,
          height: cell.height,
          zIndex: Z.cell,
          // Dragging its outline moves its cell (see BioFlow).
          style: { pointerEvents: 'none' },
          data: { ...own.data, width: cell.width, height: cell.height },
        })
        break
      }
    }
  }
  return [...parents, ...children]
}

/** How far above a template's pieces its name goes. */
const TITLE_HEIGHT = 24

/**
 * Names each placed template above its pieces, by its own label or else its template's name. The names can't
 * be selected; they say which template is which, give its menu, and drag the whole template.
 *
 * @param {Array<{id: string, template: string, label?: string}>} instances
 * @param {Map<string, Object>} definitions - Template id -> template.
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @returns {Array<Object>} vue-flow nodes, keyed 'tpl:<instance>'.
 */
export function templateTitleNodes(instances, definitions, layout) {
  const rects = new Map()
  for (const place of layout.values()) {
    if (!place.instance || (place.kind !== 'cell' && place.kind !== 'region')) continue
    rects.set(place.instance, [...(rects.get(place.instance) ?? []), place.rect])
  }
  return instances
    .filter((instance) => rects.has(instance.id))
    .map((instance) => {
      const pieces = rects.get(instance.id)
      const x = Math.min(...pieces.map((rect) => rect.x))
      const y = Math.min(...pieces.map((rect) => rect.y))
      const width = Math.max(...pieces.map((rect) => rect.x + rect.width)) - x
      const name = instance.label ?? definitions.get(instance.template)?.name ?? instance.template
      return {
        id: `tpl:${instance.id}`,
        type: 'bioTemplateTitle',
        position: { x, y: y - TITLE_HEIGHT },
        width,
        height: TITLE_HEIGHT,
        selectable: false,
        zIndex: Z.region,
        data: { name, instance: instance.id, renamed: !!instance.label },
      }
    })
}

/** How far into a cell or region a coupling from a protein reaches. */
const REACH = 56

/**
 * Gives a drawn node's box in flow coordinates.
 *
 * @param {Object} place - From layoutBioView.
 * @returns {{x: number, y: number, width: number, height: number}|null}
 */
function boxOf(place) {
  switch (place.kind) {
    case 'cell':
    case 'region':
    case 'membrane':
      return place.rect
    case 'protein':
      return { x: place.x - GLYPH_WIDTH / 2, y: place.y - GLYPH_HEIGHT / 2, width: GLYPH_WIDTH, height: GLYPH_HEIGHT }
    case 'tray':
      return { x: place.x, y: place.y, width: GLYPH_WIDTH, height: GLYPH_HEIGHT }
    case 'cytosolic':
    case 'card':
      return { x: place.x, y: place.y, ...CARD }
    default:
      return null
  }
}

const centreOf = (box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 })
const clampInto = (point, box) => ({
  x: Math.min(Math.max(point.x, box.x), box.x + box.width),
  y: Math.min(Math.max(point.y, box.y), box.y + box.height),
})

/**
 * Names each coupling an edge carries, for reading on hover.
 *
 * @param {Object} edge
 * @param {Map<string, Object>} byId - The diagram's nodes.
 * @returns {string[]} e.g. 'SGLT1.c_Na_i ↔ cell.c_Na'.
 */
function couplingNames(edge, byId) {
  const name = (id) => byId.get(id)?.data?.name ?? id
  return (edge.data?.couplings ?? []).map(
    ({ sourcePort, targetPort }) =>
      `${name(edge.source)}.${sourcePort?.variables?.[0] ?? '?'} ↔ ${name(edge.target)}.${targetPort?.variables?.[0] ?? '?'}`
  )
}

/**
 * The couplings of the selected nodes, drawn over the physiological view as short straight lines: from
 * the face of a protein the coupled quantities are on, a little way into the cell or region it couples
 * to, or face to face between proteins. Couplings with a membrane aren't drawn, as the protein sits in
 * it. Each line gets its own handle at each end, placed in the node, so a diagram handle shared by
 * couplings on both sides of the membrane is drawn from both faces.
 *
 * @param {Array<Object>} nodes - The diagram's nodes.
 * @param {Array<Object>} edges - The diagram's edges.
 * @param {Map<string, Object>} layout - From layoutBioView.
 * @param {Set<string>} selected - The selected nodes' ids.
 * @param {Function} sidecarOf - Node -> its module's parsed sidecar, or null.
 * @returns {{edges: Array<Object>, handles: Map<string, Array<{id: string, x: number, y: number}>>}} vue-flow
 *   edges, and each node's handles in its own coordinates.
 */
export function focusCouplings(nodes, edges, layout, selected, sidecarOf) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const drawnEdges = []
  const handles = new Map()
  const partners = new Set()
  // A membrane has no box of its own: it is drawn over its cell's, so its couplings end on that.
  const placeOf = (nodeId) => {
    const place = layout.get(nodeId)
    return place?.kind === 'membrane' ? { ...place, rect: layout.get(place.cell)?.rect } : place
  }
  const addHandle = (nodeId, id, point) => {
    const box = boxOf(placeOf(nodeId))
    handles.set(nodeId, [...(handles.get(nodeId) ?? []), { id, x: point.x - box.x, y: point.y - box.y }])
  }

  for (const edge of edges) {
    if (!selected.has(edge.source) && !selected.has(edge.target)) continue
    const ends = [
      { nodeId: edge.source, handleId: edge.sourceHandle, key: 's' },
      { nodeId: edge.target, handleId: edge.targetHandle, key: 't' },
    ].map((end) => ({ ...end, place: placeOf(end.nodeId) }))
    if (ends.some((end) => !end.place || !boxOf(end.place)) || edge.source === edge.target) continue

    // Proteins and cards first: where their end is fixes where a cell's or region's goes.
    for (const end of ends) {
      if (end.place.kind === 'protein') {
        const node = byId.get(end.nodeId)
        const handle = node?.data?.handles?.find((h) => getHandleId(h) === end.handleId)
        const face = handle ? handleFace(end.nodeId, handle, [edge], sidecarOf(node)) : null
        Object.assign(end, facePoint(end.place, face, { width: GLYPH_WIDTH, height: GLYPH_HEIGHT }))
      } else if (!['cell', 'region', 'membrane'].includes(end.place.kind)) {
        end.point = centreOf(boxOf(end.place))
      }
    }
    for (const [end, other] of [ends, [...ends].reverse()]) {
      if (end.point) continue
      const box = boxOf(end.place)
      end.point =
        other.point && other.direction
          ? clampInto(
              { x: other.point.x + other.direction.x * REACH, y: other.point.y + other.direction.y * REACH },
              box
            )
          : centreOf(box)
    }

    for (const end of ends) {
      addHandle(end.nodeId, `${edge.id}:${end.key}`, end.point)
      if (!selected.has(end.nodeId)) partners.add(end.nodeId)
    }
    drawnEdges.push({
      id: edge.id,
      type: 'bioCoupling',
      source: edge.source,
      sourceHandle: `${edge.id}:s`,
      target: edge.target,
      targetHandle: `${edge.id}:t`,
      selectable: false,
      focusable: false,
      updatable: false,
      // Over the cells and regions (-10, -20), under the proteins and cards drawn on them.
      zIndex: -5,
      data: { names: couplingNames(edge, byId) },
    })
  }
  return { edges: drawnEdges, handles, partners }
}

/**
 * Works out the bioView fields that keep a node of the physiological view where it was dragged to.
 *
 * @param {Object} bioNode - The bio flow node: type, width, height and data.
 * @param {{x: number, y: number}} at - Its new top-left, in flow coordinates (not relative to a parent).
 * @returns {Object} The bioView fields to set, in whole flow units.
 */
export function bioViewForMove(bioNode, at) {
  const { x, y } = whole(at)
  if (bioNode.type === 'bioCell' || bioNode.type === 'bioRegion') {
    return { rect: { x, y, width: bioNode.width, height: bioNode.height } }
  }
  return { position: { x, y } }
}

/**
 * Gives `next` with every part equal to `previous` replaced by that part of it, so what didn't change keeps its
 * identity: vue-flow copies a node's fields onto its own, and a field that is the same object triggers nothing.
 *
 * @param {*} previous
 * @param {*} next
 * @returns {*} `previous` when they are equal, else `next` sharing previous's equal parts.
 */
export function shareEqual(previous, next) {
  if (previous === next || typeof previous !== 'object' || typeof next !== 'object' || !previous || !next) return next
  if (Array.isArray(next)) {
    if (!Array.isArray(previous)) return next
    const shared = next.map((item, index) => shareEqual(previous[index], item))
    const same = shared.length === previous.length && shared.every((item, index) => item === previous[index])
    return same ? previous : shared
  }
  const isPlain = (value) => Object.getPrototypeOf(value) === Object.prototype
  if (!isPlain(next) || !isPlain(previous)) return next
  const keys = Object.keys(next)
  let same = keys.length === Object.keys(previous).length
  const shared = {}
  for (const key of keys) {
    shared[key] = shareEqual(previous[key], next[key])
    if (shared[key] !== previous[key] || !Object.hasOwn(previous, key)) same = false
  }
  return same ? previous : shared
}

/**
 * shareEqual over vue-flow nodes, matched by id. Each position is handed over afresh, as before, so vue-flow still
 * puts a dragged node back where the layout has it whenever the nodes are worked out again.
 *
 * @param {Array<Object>|undefined} previous
 * @param {Array<Object>} next
 * @returns {Array<Object>}
 */
function shareNodes(previous, next) {
  const before = new Map((previous ?? []).map((node) => [node.id, node]))
  return next.map((node) => ({
    ...shareEqual(before.get(node.id), node),
    ...(node.position && { position: { ...node.position } }),
  }))
}

/**
 * The physiological view's nodes, derived from the diagram's. Nothing is written by deriving them.
 *
 * @param {Ref<Array<Object>>} nodes - The diagram's nodes.
 * @returns {{ roles: ComputedRef<Map>, layout: ComputedRef<Map>, sites: ComputedRef<Array<Object>>,
 *   bioNodes: ComputedRef<Array<Object>> }}
 */
export function useBioNodes(nodes, edges = ref([])) {
  const libraryStore = useLibraryStore()
  const templateStore = useBioTemplateStore()
  const simulationResults = useSimulationResultsStore()

  const roles = computed(
    () =>
      new Map(
        nodes.value.map((node) => [
          node.id,
          resolveBioRole(node.data, {
            sidecar: node.data?.mathRef ? libraryStore.getParsedModuleAnnotations(node.data.mathRef) : null,
          }),
        ])
      )
  )
  const physiology = computed(() => {
    const byId = new Map(nodes.value.map((node) => [node.id, node]))
    // What a protein carries shows under its name, so it spaces neighbours too.
    const detailOf = (id) => {
      const mathRef = byId.get(id)?.data?.mathRef
      if (!mathRef) return ''
      return transportedSpecies(libraryStore.getParsedModuleAnnotations(mathRef))
        .map(({ label }) => label)
        .join(' · ')
    }
    return layoutPhysiology(nodes.value, roles.value, {
      instances: templateStore.instances,
      definitions: templateStore.definitions,
      detailOf,
    })
  })
  const layout = computed(() => physiology.value.places)

  // What each membrane protein carries, from its sidecar: the same whatever a run gives.
  const carried = computed(() => {
    const species = new Map()
    for (const node of nodes.value) {
      if (roles.value.get(node.id)?.role !== 'membraneProtein' || !node.data?.mathRef) continue
      species.set(node.id, transportedSpecies(libraryStore.getParsedModuleAnnotations(node.data.mathRef)))
    }
    return species
  })
  /** A protein's arrows, each going the way the latest run took it, if that is known. */
  const arrowsFor = (list, directionOf = () => null) =>
    list.map(({ label, inside }) => ({ label, direction: directionOf(inside) }))
  // Arrows with no direction: what lays the view out, which a run doesn't change.
  const carriedArrows = computed(() => new Map([...carried.value].map(([id, list]) => [id, arrowsFor(list)])))
  // What each membrane protein carries, and which way, from the latest run.
  const transport = computed(() => {
    const { results, mapping } = simulationResults
    // A sweep's values are one per swept point, not a course over time, so its last says nothing of where a run ended.
    const usable = results && mapping && !results.isSweep
    if (!usable) return carriedArrows.value
    return new Map(
      [...carried.value].map(([id, list]) => [
        id,
        arrowsFor(list, (inside) => flowDirection(readNodeSeries(results, mapping, id, inside)?.values)),
      ])
    )
  })
  const selected = computed(() => new Set(nodes.value.filter((node) => node.selected).map((node) => node.id)))
  const focus = computed(() =>
    focusCouplings(nodes.value, edges.value, layout.value, selected.value, (node) =>
      node?.data?.mathRef ? libraryStore.getParsedModuleAnnotations(node.data.mathRef) : null
    )
  )
  // Laid out once per layout: a selection or a run changes none of it, only what bioNodes adds.
  const laidOutNodes = computed(() => [
    ...templateTitleNodes(templateStore.instances, templateStore.definitions, layout.value),
    ...bioFlowNodes(nodes.value, roles.value, layout.value, carriedArrows.value, { selection: false }),
  ])
  // Each node's data keeps its identity while it doesn't change, so vue-flow re-renders only the nodes a selection
  // or a run touches.
  const bioNodes = computed((previous) => {
    const byId = new Map(nodes.value.map((node) => [node.id, node]))
    const next = laidOutNodes.value.map((node) => {
      const main = byId.get(node.id)
      if (node.type === 'bioTemplateTitle') return node
      return {
        ...node,
        ...(main && { selected: !!main.selected }),
        data: {
          ...node.data,
          ...(node.type === 'bioProtein' && { arrows: transport.value.get(node.id) ?? [] }),
          handles: focus.value.handles.get(node.id) ?? [],
          coupled: focus.value.partners.has(node.id),
        },
      }
    })
    return shareNodes(previous, next)
  })
  const couplingEdges = computed(() => focus.value.edges)

  /** Parses every module's sidecar, so roles from sidecars are known. */
  function loadSidecars() {
    const mathRefs = new Set(nodes.value.map((node) => node.data?.mathRef).filter(Boolean))
    return Promise.all([...mathRefs].map((mathRef) => libraryStore.ensureModuleAnnotations(mathRef)))
  }

  // A sidecar saved, imported or undone after mount drops its parse; parse it again so roles and transport
  // follow without remounting the view.
  watch(
    () =>
      [...new Set(nodes.value.map((node) => node.data?.mathRef).filter(Boolean))]
        .filter((mathRef) => libraryStore.getModuleAnnotations(mathRef) && !libraryStore.getParsedModuleAnnotations(mathRef))
        .join('\n'),
    (stale) => {
      if (stale) loadSidecars().catch(() => {})
    }
  )

  return { roles, layout, sites: computed(() => physiology.value.sites), bioNodes, couplingEdges, loadSidecars }
}
