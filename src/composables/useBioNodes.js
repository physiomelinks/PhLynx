import { computed, ref, unref, watch } from 'vue'
import { useBioPiecesStore } from '../stores/bioPiecesStore'
import { PIECES_INSTANCE, boundToPieces, layoutPieces, siteRolesOf } from '../services/bioView/pieces/layout'
import { useLibraryStore } from '../stores/libraryStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { readNodeSeries } from '../services/simulation/variableMapping'
import { flowDirection, transportedSpecies } from '../services/bioView/transport'
import { facePoint, handleFace } from '../services/bioView/faces'
import { getSkin } from '../services/bioView/skinRegistry'
import { crossingFlow, ownSpecies, speciesNetwork } from '../services/bioView/species'
import {
  cellHintAt,
  cellNameBox,
  concentrationTints,
  facetLabelBoxes,
  flowScales,
  placeSpeciesTokens,
  regionNameAt,
  routeSpecies,
} from '../services/bioView/speciesLayout'
import { getHandleId } from '../utils/handles'
import { SYMBOL_HEIGHT, SYMBOL_WIDTH, proteinLabelWidth } from '../services/bioView/geometry'
import { whole } from '../services/bioView/drop'
import { CARD, layoutPhysiology, processSize } from '../services/bioView/layout'
import { resolveBioRole } from '../services/bioView/roles'
import { locationSource } from '../services/annotations/locationSources'
import { OPB } from '../services/annotations/iris'

// Stacking: the cells and compartments (see structureZ) under everything drawn on them.
// A membrane is its cell's child, which vue-flow draws one above max(its own, its parent's): -8, over every cell and
// compartment, so none docked inside it covers its band.
const Z = { membrane: -9, link: -7, joint: -6, zone: -5, grip: 5 }

/**
 * How far below the rest the cells and compartments are drawn, each nesting a layer above what it is in, and a
 * compartment under a cell at the same depth (one docked against it).
 */
const STRUCTURE_Z = -1000
const STRUCTURE_LAYER = 10

/**
 * The z-index of a cell or compartment: a layer above what it is drawn within, so what is inside is never hidden.
 *
 * @param {Map<string, Object>} layout
 * @param {string} id
 * @returns {number}
 */
function structureZ(layout, id) {
  let depth = 0
  const seen = new Set([id])
  for (let place = layout.get(id); place?.parent && !seen.has(place.parent); place = layout.get(place.parent)) {
    seen.add(place.parent)
    depth++
  }
  return STRUCTURE_Z + depth * STRUCTURE_LAYER + (layout.get(id)?.kind === 'cell' ? 1 : 0)
}

/** How big a grip is drawn. */
const GRIP = 14

/**
 * What a piece's node shows of it (see layoutPieces): which piece and site it is, and how it is drawn. Its process
 * zones are nodes of their own.
 *
 * @param {Object} place - A piece's cell or region.
 * @returns {Object}
 */
function pieceData(place) {
  const { piece, site = null, tone = null, edge = null } = place
  const data = {
    instance: PIECES_INSTANCE,
    piece,
    site,
    tone,
    edge,
    ...(place.resize && { resize: place.resize }),
    ...(place.skin && { skin: place.skin }),
    ...(place.membraneSkin && { membraneSkin: place.membraneSkin }),
    ...(place.shape && place.kind === 'region' && { shape: place.shape }),
  }
  if (place.kind === 'region') {
    return place.form === 'inner'
      ? {
          ...data,
          form: 'inner',
          ...(place.cutout && { cutout: place.cutout }),
        }
      : data
  }
  return {
    ...data,
    facetLabels: place.facetLabels ?? [],
    ...(place.hintAt && { hintAt: { ...place.hintAt } }),
    ...(place.folds && { folds: place.folds }),
  }
}

/**
 * Names as the view draws them: a node's, and for a membrane protein what its arrows carry, so what is placed
 * around them (a cell's name, species tokens) keeps clear of them.
 *
 * @param {Map<string, Object>} byId - The diagram's nodes by id.
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {Map<string, Array<Object>>} transport - Node id -> its symbol's arrows.
 * @returns {(id: string) => {name: string, detail: string}}
 */
const viewLabels = (byId, layout, transport) => (id) => ({
  name: byId.get(id)?.data?.name ?? layout.get(id)?.label ?? id,
  detail: (transport.get(id) ?? []).map((arrow) => arrow.label).join(' · '),
})

/**
 * Turns the physiological layout into nodes for the physiological view's flow. Each has the id of the
 * instance it draws, so selection and edits map straight back. Proteins in a membrane and processes in
 * a cell are children of the cell, so they move with it. A piece with no module on it is a node of its own, keyed
 * 'pc:<id>', and so are its zones and grips.
 *
 * @param {Array<Object>} nodes - The diagram's nodes.
 * @param {Map<string, Object>} roles - Node id -> resolveBioRole's result.
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {Map<string, Array<Object>>} [transport] - Node id -> what its symbol's arrows show (see useBioNodes).
 * @param {Object} [options]
 * @param {boolean} [options.selection=true] - Whether each node says if it is selected; useBioNodes adds that
 *   itself, so a selection doesn't lay the nodes out again.
 * @returns {Array<Object>} vue-flow nodes; parents come before their children.
 */
/**
 * What only some kinds of node set, cleared on every node: vue-flow merges a node onto the one it had under the
 * same id, so a field left out keeps its old value when an instance is shown as something else. A card that
 * became a protein stayed held inside its cell, and a membrane that became one could not be clicked.
 */
const UNSET = Object.freeze({
  extent: undefined,
  zIndex: undefined,
  style: undefined,
  selectable: undefined,
  draggable: undefined,
})

export function bioFlowNodes(nodes, roles, layout, transport = new Map(), { selection = true } = {}) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const labelOf = viewLabels(byId, layout, transport)
  const base = (id) => {
    const node = byId.get(id)
    if (!node) {
      const place = layout.get(id)
      const data = { name: place.label ?? id, domainType: null, empty: true }
      // An empty piece is selected to be deleted, its module gone first (see BioFlow's deletionLayers).
      return { ...UNSET, id, selectable: true, draggable: !place.piece, data }
    }
    return {
      ...UNSET,
      id,
      ...(selection && { selected: !!node.selected }),
      data: { name: node.data?.name ?? id, domainType: node.data?.domainType ?? null },
    }
  }
  const parents = []
  const children = []

  for (const [id, place] of layout) {
    if (!byId.has(id) && !place.piece) continue
    switch (place.kind) {
      case 'zone': {
        // A process zone of the pieces, over the compartment it is within.
        const { x, y, width, height } = place.rect
        parents.push({
          ...base(id),
          type: 'bioZone',
          position: { x, y },
          width,
          height,
          zIndex: Z.zone,
          draggable: !!place.drag,
          data: {
            ...base(id).data,
            // Whether any module is in it yet, which base says of every piece with no node of its own.
            empty: place.empty,
            named: place.named,
            piece: place.piece,
            site: place.site,
            width,
            height,
            ...(place.resize && { resize: place.resize }),
          },
        })
        break
      }
      case 'grip': {
        // A handle on a piece that is no node of its own: a fold's end, a tube's end or its bend.
        parents.push({
          ...UNSET,
          id,
          type: 'bioGrip',
          position: { x: place.x - GRIP / 2, y: place.y - GRIP / 2 },
          width: GRIP,
          height: GRIP,
          zIndex: Z.grip,
          selectable: false,
          draggable: true,
          data: {
            name: '',
            grip: place.grip,
            piece: place.piece,
            ...(place.end !== undefined && { end: place.end }),
            ...(place.below && { below: place.below }),
          },
        })
        break
      }
      case 'link': {
        // Its line between its two spaces, and the room for its module; the module on it is drawn as a card.
        const { x, y, width, height } = place.rect
        const shift = (point) => ({ x: point.x - x, y: point.y - y })
        parents.push({
          ...UNSET,
          id,
          type: 'bioLink',
          position: { x, y },
          width,
          height,
          // A tube of the pieces is selected by its empty room or joint, the rest of it taking no pointer.
          selectable: !!place.piece,
          draggable: false,
          zIndex: Z.link,
          style: { pointerEvents: 'none' },
          data: {
            name: place.label,
            empty: place.empty,
            flow: place.flow,
            broken: !!place.broken,
            instance: place.instance,
            site: place.site,
            ...(place.joint
              ? {
                  joint: place.joint,
                  jointSkin: place.jointSkin,
                  tone: place.tone,
                  ...(place.channel && {
                    channel: { ...place.channel, from: shift(place.channel.from), to: shift(place.channel.to) },
                  }),
                }
              : place.points
                ? {
                    points: place.points.map(shift),
                    ...(place.conduit && { conduit: place.conduit, tone: place.tone }),
                  }
                : {
                    from: shift(place.line.from),
                    to: shift(place.line.to),
                    ...(place.line.via && { via: shift(place.line.via) }),
                  }),
            zone: { ...place.zone, ...shift(place.zone) },
            width,
            height,
          },
        })
        break
      }
      case 'cell': {
        const { x, y, width, height } = place.rect
        const own = base(id)
        // A membrane of the pieces filled by docked compartments alone has no inside of its own to name.
        if (place.piece && !place.bulk) own.data = { ...own.data, name: '' }
        const named = !own.data.empty && cellNameBox(id, layout, labelOf)
        // An empty cell's name and hint keep clear of its proteins' names.
        const hint = own.data.empty && cellHintAt(id, layout, labelOf)
        parents.push({
          ...own,
          // A piece moves as its own drag says (see BioFlow), with or without a module on it.
          ...(place.piece && { draggable: !!place.drag }),
          type: 'bioCell',
          position: { x, y },
          width,
          height,
          zIndex: structureZ(layout, id),
          data: {
            ...own.data,
            ...pieceData(place),
            membrane: place.membrane,
            ...(place.membraneEmpty && { membraneEmpty: true }),
            width,
            height,
            ...(named && { nameAt: { x: named.x - x, y: named.y - y } }),
            ...(hint && { hintAt: hint }),
            // A membrane's span names go where its proteins and names are not.
            ...(place.facetLabels?.length && { facetLabels: facetLabelBoxes(id, layout, labelOf) }),
          },
        })
        break
      }
      case 'region': {
        const { x, y, width, height } = place.rect
        const own = base(id)
        // Its name kept clear of the compartments nested in it.
        const named = regionNameAt(id, layout, labelOf)
        parents.push({
          ...own,
          ...(place.piece && { draggable: !!place.drag }),
          type: 'bioRegion',
          position: { x, y },
          width,
          height,
          zIndex: structureZ(layout, id),
          // Its size too, where it has a skin: an image is drawn to a size, in the view and in an exported picture.
          data: {
            ...own.data,
            ...pieceData(place),
            ...(named && { nameAt: { x: named.x - x, y: named.y - y } }),
            ...(place.skin && { width, height }),
          },
        })
        break
      }
      case 'protein': {
        const cell = layout.get(place.cell).rect
        children.push({
          ...base(id),
          type: 'bioProtein',
          parentNode: place.cell,
          position: { x: place.x - SYMBOL_WIDTH / 2 - cell.x, y: place.y - SYMBOL_HEIGHT / 2 - cell.y },
          width: SYMBOL_WIDTH,
          height: SYMBOL_HEIGHT,
          data: {
            ...base(id).data,
            skin: roles.get(id)?.skin ?? 'generic',
            arrows: transport.get(id) ?? [],
            facet: place.facet,
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
          width: SYMBOL_WIDTH,
          height: SYMBOL_HEIGHT,
          data: {
            ...base(id).data,
            skin: roles.get(id)?.skin ?? 'generic',
            arrows: transport.get(id) ?? [],
            rotation: 0,
            unplaced: true,
            droppable: true,
          },
        })
        break
      case 'cytosolic': {
        // In a process zone of the pieces: its symbol, named under it, as a protein on a membrane is. It can be
        // dragged out of the zone, to another site or none.
        const cell = layout.get(place.cell).rect
        children.push({
          ...base(id),
          type: 'bioProtein',
          parentNode: place.cell,
          position: { x: place.x - cell.x, y: place.y - cell.y },
          width: SYMBOL_WIDTH,
          height: SYMBOL_HEIGHT,
          data: {
            ...base(id).data,
            // A zone has no plain card: a process chosen to have no skin is drawn as a process there.
            skin: roles.get(id)?.skin ?? 'process',
            rotation: 0,
            droppable: true,
            // Its badge kept on its symbol, off the zone's name above it.
            inset: true,
          },
        })
        break
      }
      case 'card':
        // A module in a link's joint is drawn as the joint itself: over it, named, to select or drag out.
        if (place.joint) {
          const { zone, points } = layout.get(place.link)
          parents.push({
            ...base(id),
            type: 'bioJoint',
            position: { x: zone.x, y: zone.y },
            width: zone.width,
            height: zone.height,
            zIndex: Z.joint,
            data: {
              ...base(id).data,
              joint: place.joint,
              jointSkin: place.jointSkin,
              tone: layout.get(place.link).tone,
              vertical: !!layout.get(place.link).channel?.vertical,
              // A conduit's vessel runs along its tube's whole way, drawn from the joint's own corner.
              ...(place.conduit &&
                points && {
                  points: points.map((point) => ({ x: point.x - zone.x, y: point.y - zone.y })),
                  // Named beside it where it runs down, clear of its vessel.
                  beside: !!place.conduit.vertical,
                }),
              broken: !!place.broken,
              width: zone.width,
              height: zone.height,
              droppable: true,
            },
          })
          break
        }
        {
          // A module on no piece, which can be dropped on a site; a process shows its symbol beside its name.
          const { role, skin } = roles.get(id) ?? {}
          parents.push({
            ...base(id),
            type: 'bioCard',
            position: { x: place.x, y: place.y },
            width: CARD.width,
            height: CARD.height,
            data: { ...base(id).data, droppable: true, ...(role === 'cytosolic' && skin && { skin }) },
          })
        }
        break
      case 'membrane': {
        // Over its cell's outline, as big as the cell, but hit only on its bilayer (see BioMembrane).
        const cell = layout.get(place.cell)?.rect
        if (!cell) break
        const own = base(id)
        children.push({
          ...own,
          ...(layout.get(place.cell).piece && { draggable: false }),
          type: 'bioMembrane',
          parentNode: place.cell,
          position: { x: 0, y: 0 },
          width: cell.width,
          height: cell.height,
          zIndex: Z.membrane,
          // Dragging its outline moves its cell (see BioFlow).
          style: { pointerEvents: 'none' },
          data: {
            ...own.data,
            width: cell.width,
            height: cell.height,
            ...(layout.get(place.cell).folds && { folds: layout.get(place.cell).folds }),
            ...(layout.get(place.cell).membraneSkin && { membraneSkin: layout.get(place.cell).membraneSkin }),
          },
        })
        break
      }
    }
  }
  return [...parents, ...children]
}

/** How far into a cell or region a coupling from a protein reaches. */
const REACH = 56

/**
 * Gives a drawn node's box in flow coordinates.
 *
 * @param {Object} place - From layoutPhysiology.
 * @returns {{x: number, y: number, width: number, height: number}|null}
 */
function boxOf(place) {
  switch (place.kind) {
    case 'cell':
    case 'region':
    case 'membrane':
    case 'link':
      return place.rect
    case 'protein':
      return { x: place.x - SYMBOL_WIDTH / 2, y: place.y - SYMBOL_HEIGHT / 2, width: SYMBOL_WIDTH, height: SYMBOL_HEIGHT }
    case 'tray':
      return { x: place.x, y: place.y, width: SYMBOL_WIDTH, height: SYMBOL_HEIGHT }
    case 'cytosolic':
      return { x: place.x, y: place.y, ...processSize(place) }
    case 'card':
      return place.rect ?? { x: place.x, y: place.y, ...CARD }
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
  if (!edge.data?.couplings?.length) return [`${name(edge.source)} → ${name(edge.target)} (no couplings)`]
  return edge.data.couplings.map(
    ({ sourcePort, targetPort }) =>
      `${name(edge.source)}.${sourcePort?.variables?.[0] ?? '?'} ↔ ${name(edge.target)}.${targetPort?.variables?.[0] ?? '?'}`,
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
 * @param {Map<string, Object>} layout - From layoutPhysiology.
 * @param {Set<string>} selected - The selected nodes' ids.
 * @param {Function} sidecarOf - Node -> its module's parsed sidecar, or null.
 * @param {Function} [facesOf] - Node id -> its symbol's face anchors, if it has any.
 * @returns {{edges: Array<Object>, handles: Map<string, Array<{id: string, x: number, y: number}>>}} vue-flow
 *   edges, and each node's handles in its own coordinates.
 */
export function focusCouplings(nodes, edges, layout, selected, sidecarOf, facesOf = () => undefined) {
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const drawnEdges = []
  const handles = new Map()
  const partners = new Set()
  // A membrane has no box of its own: it is drawn over its cell's, so its couplings end on that. A module in a
  // link's joint is drawn as the joint, over the link's zone, not as a card.
  const placeOf = (nodeId) => {
    const place = layout.get(nodeId)
    if (place?.kind === 'membrane') return { ...place, rect: layout.get(place.cell)?.rect }
    if (place?.kind === 'card' && place.joint) return { ...place, rect: layout.get(place.link)?.zone }
    return place
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
        const size = { width: SYMBOL_WIDTH, height: SYMBOL_HEIGHT }
        // No face to leave from (nothing couples it, or the faces tie): from its centre
        if (face) Object.assign(end, facePoint(end.place, face, size, facesOf(end.nodeId)))
        else end.point = { x: end.place.x, y: end.place.y }
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
              box,
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
      // Over the cells and compartments (see STRUCTURE_Z), under the proteins and cards drawn on them.
      zIndex: -5,
      // An edge nothing couples is drawn dashed, so a placed but uncoupled neighbour stands out.
      data: { names: couplingNames(edge, byId), uncoupled: !edge.data?.couplings?.length },
    })
  }
  return { edges: drawnEdges, handles, partners }
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

/** The roles whose own species species mode shows. */
const COMPARTMENT_ROLES = new Set(['cytosol', 'region'])

/**
 * The physiological view's nodes, derived from the diagram's. Nothing is written by deriving them.
 *
 * @param {Ref<Array<Object>>} nodes - The diagram's nodes.
 * @param {Ref<Array<Object>>} [edges] - The diagram's edges.
 * @param {{ speciesMode?: Ref<{all?: boolean, fluxes?: boolean, keep?: Object|null, hidden?: string[]}|null> }}
 *   [options] - Species mode, when on: whether it shows every annotated species, only those coupled, or only those
 *   with a path through a protein, a token it keeps whatever, and the species it hides (see speciesNetwork).
 *   `voiCursor`, a Ref<{index: number, range: [number, number]}|null>: the point of the latest run whose flows
 *   are shown, and the stretch of it they are sized against; null for the run's end, sized against each other. A compartment's tokens follow its
 *   bioView.speciesOrder.
 *   `focusedSpecies`, a Ref<{nodeId: string, species: string}|null>: the focused species token, whose concentration tints
 *   every compartment holding it, scaled as `tintMode` says (see concentrationTints).
 * @returns {{ roles: ComputedRef<Map>, layout: ComputedRef<Map>, sites: ComputedRef<Array<Object>>,
 *   bioNodes: ComputedRef<Array<Object>>, hasSpecies: ComputedRef<boolean>, species: ComputedRef<Object|null> }}
 *   `species` is the species network and where it is drawn, while species mode is on; `speciesOrderPreview` places
 *   one compartment's tokens in an order of the caller's; `concentrationTint`, the focused species' compartments
 *   and how strongly each is tinted at the cursor, null with nothing to tint.
 */
export function useBioNodes(
  nodes,
  edges = ref([]),
  { speciesMode = ref(null), voiCursor = ref(null), flowScale = ref(null), focusedSpecies = ref(null), tintMode = ref('linear') } = {}
) {
  const libraryStore = useLibraryStore()
  const piecesStore = useBioPiecesStore()
  const simulationResults = useSimulationResultsStore()

  const roles = computed(() => {
    const source = locationSource()
    // A module on a piece is what its site is: as a drag of a piece would leave it, so a drag shows it.
    const siteRoles = siteRolesOf(piecesStore.draft ?? piecesStore.pieces, nodes.value)
    return new Map(
      nodes.value.map((node) => {
        const sidecar = node.data?.mathRef ? libraryStore.getParsedModuleAnnotations(node.data.mathRef) : null
        const worked = source.workedRole(node, { sidecar })
        return [node.id, resolveBioRole(node.data, { sidecar, worked, siteRole: siteRoles.get(node.id) })]
      }),
    )
  })
  /** How the pieces are laid out with the nodes on them: the nodes and their names' widths. */
  const pieceLayoutOptions = computed(() => {
    const byId = new Map(nodes.value.map((node) => [node.id, node]))
    // What a protein carries shows under its name, so it spaces neighbours too.
    const detailOf = (id) => {
      const mathRef = byId.get(id)?.data?.mathRef
      if (!mathRef) return ''
      return transportedSpecies(libraryStore.getParsedModuleAnnotations(mathRef))
        .map(({ label }) => label)
        .join(' · ')
    }
    const widthOf = (id) => proteinLabelWidth(byId.get(id)?.data?.name ?? id, detailOf(id))
    return { nodes: nodes.value, widthOf }
  })
  const physiology = computed(() => {
    const options = pieceLayoutOptions.value
    // A drag of a piece lays it out as the drag would leave it (the draft), so all that goes with it follows.
    const pieces = piecesStore.draft ?? piecesStore.pieces
    if (!pieces.length) return { places: layoutPhysiology(nodes.value, roles.value).places, sites: [] }
    // The pieces the view is built from, with the nodes bound to their sites; the rest beside them.
    const laidOut = layoutPieces(pieces, options)
    const { bound } = boundToPieces(pieces, nodes.value)
    const { places } = layoutPhysiology(nodes.value, roles.value, {
      placedElsewhere: new Set(bound.keys()),
      around: [...laidOut.rects.values()],
    })
    return { places: new Map([...places, ...laidOut.places]), sites: laidOut.sites }
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
    list.map(({ species, label, inside }) => ({ species, label, direction: directionOf(inside) }))
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
        arrowsFor(list, (inside) =>
          flowDirection(readNodeSeries(results, mapping, id, inside)?.values, undefined, unref(voiCursor)?.index),
        ),
      ]),
    )
  })
  const sidecarOf = (node) => (node?.data?.mathRef ? libraryStore.getParsedModuleAnnotations(node.data.mathRef) : null)
  const facesOf = (id) => getSkin(roles.value.get(id)?.skin)?.faces
  // What a protein's symbol's arrows carry, in order, and where it spreads them.
  const arrowsOf = (id) => ({
    species: (carriedArrows.value.get(id) ?? []).map((arrow) => arrow.species),
    room: (getSkin(roles.value.get(id)?.skin) ?? getSkin('generic'))?.arrowRoom,
  })

  // Whether any compartment annotates species of its own, so species mode has something to show.
  const hasSpecies = computed(() =>
    nodes.value.some(
      (node) => COMPARTMENT_ROLES.has(roles.value.get(node.id)?.role) && ownSpecies(sidecarOf(node)).size,
    ),
  )
  // The species network and where its tokens go, worked out only while species mode is on: a run changes neither.
  const speciesTokens = computed(() => {
    const mode = unref(speciesMode)
    if (!mode) return null
    const network = speciesNetwork({
      nodes: nodes.value,
      edges: edges.value,
      roleOf: (id) => roles.value.get(id)?.role,
      sidecarOf,
      all: !!mode.all,
      fluxes: !!mode.fluxes,
      keep: mode.keep ?? null,
      hidden: mode.hidden ?? [],
    })
    const byId = new Map(nodes.value.map((node) => [node.id, node]))
    const labelOf = viewLabels(byId, layout.value, carriedArrows.value)
    // A compartment's tokens in the order the user dragged them into.
    const orderOf = (id) => byId.get(id)?.data?.bioView?.speciesOrder
    return { network, tokens: placeSpeciesTokens(network, layout.value, { labelOf, orderOf }) }
  })

  /**
   * Where one compartment's tokens would go in an order of their species: a chip drag's preview of its drop.
   *
   * @param {string} nodeId - The compartment.
   * @param {string[]} order - Its species, in the order to try.
   * @returns {Array<Object>} Its tokens, placed as that order would place them; none while species mode is off.
   */
  function speciesOrderPreview(nodeId, order) {
    if (!speciesTokens.value) return []
    const byId = new Map(nodes.value.map((node) => [node.id, node]))
    const labelOf = viewLabels(byId, layout.value, carriedArrows.value)
    const orderOf = (id) => (id === nodeId ? order : byId.get(id)?.data?.bioView?.speciesOrder)
    return placeSpeciesTokens(speciesTokens.value.network, layout.value, { labelOf, orderOf, only: nodeId })
  }
  // The flow each path and exchange follows in the latest run, and whether it going in is the path going 'out'.
  const speciesFlows = computed(() => {
    if (!speciesTokens.value) return null
    const { network } = speciesTokens.value
    const { results, mapping } = simulationResults
    if (!results || !mapping || results.isSweep) return new Map()
    const byId = new Map(nodes.value.map((node) => [node.id, node]))
    const valuesOf = (id, variable) => readNodeSeries(results, mapping, id, variable)?.values ?? null
    const flows = new Map()
    for (const path of network.paths) {
      const crossing = crossingFlow(sidecarOf(byId.get(path.protein)), path.species)
      const values = crossing && valuesOf(path.protein, crossing.variable)
      if (values) flows.set(path, { values, isFlipped: crossing.inward < 0, species: path.species })
    }
    // A process's exchange with a compartment names its own flow, and which sign gives the species away.
    for (const exchange of network.exchanges ?? []) {
      const values = valuesOf(exchange.process, exchange.variable)
      if (values) flows.set(exchange, { values, isFlipped: exchange.produces > 0, species: exchange.species })
    }
    return flows
  })
  // The flow drawn widest for each species over the stretch of the run the cursor plays, so a path keeps its width's
  // meaning from one point to the next. Worked out once for the stretch, not at each point.
  const largestFlow = computed(() => {
    const range = unref(voiCursor)?.range
    if (!range || !speciesFlows.value) return null
    const flows = [...speciesFlows.value].map(([key, flow]) => ({ key, ...flow }))
    const scaleOf = flowScales(flows, range, unref(flowScale) ?? undefined)
    return (source) => scaleOf({ key: source, species: source.species })
  })
  // ...and its paths, which go the way the latest run took them at the cursor: its end, until that is moved.
  const species = computed(() => {
    if (!speciesTokens.value) return null
    const { network, tokens } = speciesTokens.value
    const index = unref(voiCursor)?.index ?? null
    const flowOf = (path) => {
      const flow = speciesFlows.value.get(path)
      if (!flow) return null
      const way = flowDirection(flow.values, undefined, index)
      const flip = { in: 'out', out: 'in' }
      return {
        direction: way && flow.isFlipped ? flip[way] : way,
        size: Math.abs(flow.values[index ?? flow.values.length - 1]) || 0,
      }
    }
    const largest = largestFlow.value
    return { network, tokens, ...routeSpecies(network, layout.value, tokens, { facesOf, arrowsOf, flowOf, largest }) }
  })

  // The focused species' concentration in each compartment holding it, over the latest run. Amounts aren't tinted, so
  // a tint always means a concentration; nor is a compartment whose unit isn't the focused one's.
  const concentrationSeries = computed(() => {
    const target = unref(focusedSpecies)
    if (!target || !speciesTokens.value) return null
    const { results, mapping } = simulationResults
    if (!results || !mapping || results.isSweep) return null
    const series = []
    for (const [nodeId, tokens] of speciesTokens.value.network.compartments) {
      const token = tokens.find((entry) => entry.species === target.species)
      if (token?.annotation?.property !== OPB.concentration) continue
      const read = readNodeSeries(results, mapping, nodeId, token.variable)
      if (read?.values) series.push({ nodeId, values: read.values, unit: read.unit })
    }
    if (!series.length) return null
    const unit = (series.find((entry) => entry.nodeId === target.nodeId) ?? series[0]).unit
    return { species: target.species, unit, series: series.filter((entry) => entry.unit === unit) }
  })
  // Scaled once for the stretch the cursor plays, not at each point.
  const concentrationScaleOf = computed(() => {
    const found = concentrationSeries.value
    if (!found) return null
    const last = found.series[0].values.length - 1
    const range = unref(voiCursor)?.range ?? [0, last]
    return concentrationTints(found.series, range, { mode: unref(tintMode) ?? 'linear', unit: found.unit })
  })
  const concentrationTint = computed(() => {
    const found = concentrationSeries.value
    const tintOf = concentrationScaleOf.value
    if (!found || !tintOf) return null
    const tints = found.series.map(({ nodeId, values }) => {
      const index = unref(voiCursor)?.index ?? values.length - 1
      return { nodeId, intensity: tintOf(nodeId, index), value: values[index] }
    })
    return { species: found.species, unit: found.unit, tints: tints.filter((tint) => tint.intensity !== null) }
  })

  const selected = computed(() => new Set(nodes.value.filter((node) => node.selected).map((node) => node.id)))
  const focus = computed(() =>
    focusCouplings(nodes.value, edges.value, layout.value, selected.value, sidecarOf, facesOf),
  )
  // Laid out once per layout: a selection or a run changes none of it, only what bioNodes adds.
  const laidOutNodes = computed(() =>
    bioFlowNodes(nodes.value, roles.value, layout.value, carriedArrows.value, { selection: false }),
  )
  // The nodes some edge couples to another: a protein or card outside it is placed but joined to nothing yet, as a
  // new module is until its math has ports.
  const coupledIds = computed(() => {
    const ids = new Set()
    for (const edge of edges.value) {
      if (!edge.data?.couplings?.length) continue
      ids.add(edge.source)
      ids.add(edge.target)
    }
    return ids
  })
  // Each node's data keeps its identity while it doesn't change, so vue-flow re-renders only the nodes a selection
  // or a run touches.
  const bioNodes = computed((previous) => {
    const byId = new Map(nodes.value.map((node) => [node.id, node]))
    // How strongly the focused species' concentration tints each compartment holding it, at the cursor.
    const tints = new Map((concentrationTint.value?.tints ?? []).map((tint) => [tint.nodeId, tint.intensity]))
    const next = laidOutNodes.value.map((node) => {
      const main = byId.get(node.id)
      return {
        ...node,
        ...(main && { selected: !!main.selected }),
        data: {
          ...node.data,
          ...(node.type === 'bioProtein' && { arrows: transport.value.get(node.id) ?? [] }),
          handles: focus.value.handles.get(node.id) ?? [],
          coupled: focus.value.partners.has(node.id),
          ...((node.type === 'bioProtein' || node.type === 'bioCard') && { uncoupled: !coupledIds.value.has(node.id) }),
          ...(tints.has(node.id) && { tint: tints.get(node.id) }),
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

  // A sidecar saved, imported or undone after mount drops its parse; parse it again so roles, transport and
  // species mode follow without remounting the view.
  watch(
    () =>
      [...new Set(nodes.value.map((node) => node.data?.mathRef).filter(Boolean))]
        .filter(
          (mathRef) => libraryStore.getModuleAnnotations(mathRef) && !libraryStore.getParsedModuleAnnotations(mathRef),
        )
        .join('\n'),
    (stale) => {
      if (stale) loadSidecars().catch(() => {})
    },
  )

  return {
    roles,
    layout,
    sites: computed(() => physiology.value.sites),
    pieceLayoutOptions,
    bioNodes,
    couplingEdges,
    hasSpecies,
    species,
    concentrationTint,
    speciesOrderPreview,
    loadSidecars,
  }
}
