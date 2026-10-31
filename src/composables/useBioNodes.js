import { computed, ref } from 'vue'
import { useAnnotationStore } from '../stores/annotationStore'
import { useBioTemplateStore } from '../stores/bioTemplateStore'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { readNodeSeries } from '../services/simulation/variableMapping'
import { flowDirection, transportedSpecies } from '../services/bioView/transport'
import { facePoint, handleFace } from '../services/bioView/faces'
import { getHandleId } from '../utils/handles'
import { GLYPH_HEIGHT, GLYPH_WIDTH } from '../services/bioView/geometry'
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
 * @returns {Array<Object>} vue-flow nodes; parents come before their children.
 */
export function bioFlowNodes(nodes, roles, layout, transport = new Map()) {
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
      selected: !!node.selected,
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
      // A membrane is drawn as its cell's outline.
    }
  }
  return [...parents, ...children]
}

/** How far above a template's pieces its name goes. */
const TITLE_HEIGHT = 24

/**
 * Names each placed template above its pieces, by its own label or else its template's name. The names can't
 * be selected or dragged; they are there to say which template is which, and to give its menu.
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
        draggable: false,
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
 * @returns {string[]} e.g. 'SGLT1.c_Na_i ↔ enterocyte.c_Na'.
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
  const addHandle = (nodeId, id, point) => {
    const box = boxOf(layout.get(nodeId))
    handles.set(nodeId, [...(handles.get(nodeId) ?? []), { id, x: point.x - box.x, y: point.y - box.y }])
  }

  for (const edge of edges) {
    if (!selected.has(edge.source) && !selected.has(edge.target)) continue
    const ends = [
      { nodeId: edge.source, handleId: edge.sourceHandle, key: 's' },
      { nodeId: edge.target, handleId: edge.targetHandle, key: 't' },
    ].map((end) => ({ ...end, place: layout.get(end.nodeId) }))
    if (ends.some((end) => !end.place || !boxOf(end.place)) || edge.source === edge.target) continue

    // Proteins and cards first: where their end is fixes where a cell's or region's goes.
    for (const end of ends) {
      if (end.place.kind === 'protein') {
        const node = byId.get(end.nodeId)
        const handle = node?.data?.handles?.find((h) => getHandleId(h) === end.handleId)
        const face = handle ? handleFace(end.nodeId, handle, [edge], sidecarOf(node)) : null
        Object.assign(end, facePoint(end.place, face, { width: GLYPH_WIDTH, height: GLYPH_HEIGHT }))
      } else if (end.place.kind !== 'cell' && end.place.kind !== 'region') {
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

    for (const end of ends) addHandle(end.nodeId, `${edge.id}:${end.key}`, end.point)
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
  return { edges: drawnEdges, handles }
}

/**
 * Works out the bioView fields that keep a node of the physiological view where it was dragged to.
 *
 * @param {Object} bioNode - The bio flow node: type, width, height and data.
 * @param {{x: number, y: number}} at - Its new top-left, in flow coordinates (not relative to a parent).
 * @returns {Object} The bioView fields to set.
 */
export function bioViewForMove(bioNode, at) {
  const { x, y } = at
  if (bioNode.type === 'bioCell' || bioNode.type === 'bioRegion') {
    return { rect: { x, y, width: bioNode.width, height: bioNode.height } }
  }
  return { position: { x, y } }
}

/**
 * The physiological view's nodes, derived from the diagram's. Nothing is written by deriving them.
 *
 * @param {Ref<Array<Object>>} nodes - The diagram's nodes.
 * @returns {{ roles: ComputedRef<Map>, layout: ComputedRef<Map>, sites: ComputedRef<Array<Object>>,
 *   bioNodes: ComputedRef<Array<Object>> }}
 */
export function useBioNodes(nodes, edges = ref([])) {
  const annotationStore = useAnnotationStore()
  const libraryStore = useLibraryStore()
  const templateStore = useBioTemplateStore()
  const simulationResults = useSimulationResultsStore()

  const roles = computed(() => {
    const apiCoords = annotationStore.getApiCoords()
    return new Map(
      nodes.value.map((node) => [
        node.id,
        resolveBioRole(node.data, {
          apiCoords,
          sidecar: node.data?.mathRef ? libraryStore.getParsedModuleAnnotations(node.data.mathRef) : null,
          nodes: nodes.value,
        }),
      ])
    )
  })
  const physiology = computed(() =>
    layoutPhysiology(nodes.value, roles.value, {
      instances: templateStore.instances,
      definitions: templateStore.definitions,
    })
  )
  const layout = computed(() => physiology.value.places)

  // What each membrane protein carries, from its sidecar, and which way, from the latest run.
  const transport = computed(() => {
    const { results, mapping } = simulationResults
    // A sweep's values are one per swept point, not a course over time, so its last says nothing of where a run ended.
    const usable = results && mapping && !results.isSweep
    const arrows = new Map()
    for (const node of nodes.value) {
      if (roles.value.get(node.id)?.role !== 'membraneProtein' || !node.data?.mathRef) continue
      const carried = transportedSpecies(libraryStore.getParsedModuleAnnotations(node.data.mathRef))
      arrows.set(
        node.id,
        carried.map(({ label, inside }) => ({
          label,
          direction: usable ? flowDirection(readNodeSeries(results, mapping, node.id, inside)?.values) : null,
        }))
      )
    }
    return arrows
  })
  const selected = computed(() => new Set(nodes.value.filter((node) => node.selected).map((node) => node.id)))
  const focus = computed(() =>
    focusCouplings(nodes.value, edges.value, layout.value, selected.value, (node) =>
      node?.data?.mathRef ? libraryStore.getParsedModuleAnnotations(node.data.mathRef) : null
    )
  )
  const bioNodes = computed(() => [
    ...templateTitleNodes(templateStore.instances, templateStore.definitions, layout.value),
    ...bioFlowNodes(nodes.value, roles.value, layout.value, transport.value).map((node) => ({
      ...node,
      data: { ...node.data, handles: focus.value.handles.get(node.id) ?? [] },
    })),
  ])
  const couplingEdges = computed(() => focus.value.edges)

  /** Parses every module's sidecar, so roles from sidecars are known. */
  function loadSidecars() {
    const mathRefs = new Set(nodes.value.map((node) => node.data?.mathRef).filter(Boolean))
    return Promise.all([...mathRefs].map((mathRef) => libraryStore.ensureModuleAnnotations(mathRef)))
  }

  return { roles, layout, sites: computed(() => physiology.value.sites), bioNodes, couplingEdges, loadSidecars }
}
