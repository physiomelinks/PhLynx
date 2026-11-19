/**
 * How the pieces of the physiology view relate, read from their structure alone, never from where they are drawn:
 * what lies inside and outside each stretch of membrane, what a process zone is within, what a tube joins, which
 * sites a module can go on, and which sites are neighbours. This is all the meaning code reads of the pieces.
 *
 * Sides are relative ("Russian dolls"): a membrane separates what it encloses (its inside) from the compartment it
 * sits in, or the compartments docked against its outer face (its outside). A stretch of membrane meets on its
 * inside the compartment docked to that stretch's inner face, else the membrane's bulk: the one compartment it
 * encloses that is docked to none of its sides.
 */

import { SIDES } from './constants.js'

/** A topology per validated list of pieces, which is frozen and so known by its identity. */
const known = new WeakMap()

/** The path of a stretch of membrane. */
export const spanPath = (membrane, span) => `${membrane}.${span}`

/**
 * Whether a dock covers a point along its side; the far end of a side belongs to the dock that reaches it.
 *
 * @param {{from: number, to: number}} dock
 * @param {number} at - 0 to 1 along the side.
 */
const covers = (dock, at) => dock.from <= at && (at < dock.to || (at === 1 && dock.to === 1))

/** Whether two stretches along one side overlap by more than a point. */
const overlaps = (a, b) => a.from < b.to && b.from < a.to

/**
 * The topology of a list of pieces, as model.js validates it. Worked out once per list and kept.
 *
 * @param {ReadonlyArray<Object>} pieces
 * @returns {Object} See the functions it returns.
 */
export function topologyOf(pieces) {
  if (Object.isFrozen(pieces) && known.has(pieces)) return known.get(pieces)
  const topology = buildTopology(pieces)
  if (Object.isFrozen(pieces)) known.set(pieces, topology)
  return topology
}

function buildTopology(pieces) {
  const byId = new Map(pieces.map((piece) => [piece.id, piece]))
  const ofKind = (kind) => pieces.filter((piece) => piece.kind === kind)
  const compartments = ofKind('compartment')
  const membranes = ofKind('membrane')
  const problems = []

  /** Compartment id -> the membrane that encloses it. */
  const enclosedBy = new Map()
  for (const membrane of membranes) for (const id of membrane.encloses) enclosedBy.set(id, membrane.id)

  /** '<on>/<side>/<face>' -> the docks there, each with its compartment. */
  const docks = new Map()
  const dockKey = (on, side, face) => `${on}/${side ?? ''}/${face}`
  for (const compartment of compartments) {
    for (const dock of compartment.docks ?? []) {
      const key = dockKey(dock.on, dock.side, dock.face)
      docks.set(key, [...(docks.get(key) ?? []), { ...dock, compartment: compartment.id }])
    }
  }
  /** The compartments docked to a face of a membrane's side, or of a fold, at a point along it. */
  const occupants = (on, side, face, at) =>
    (docks.get(dockKey(on, side, face)) ?? []).filter((dock) => covers(dock, at)).map((dock) => dock.compartment)

  /** The compartment a membrane or fold belongs to, as the one a fold's membrane is. */
  const membraneOf = (on) => (byId.get(on)?.kind === 'fold' ? byId.get(byId.get(on).membrane) : byId.get(on))

  /**
   * Whether a compartment is within a membrane: enclosed by it, or a subcompartment of one it encloses that no other
   * membrane closes off.
   */
  function isWithin(compartmentId, membraneId) {
    const seen = new Set()
    for (let id = compartmentId; id && !seen.has(id); id = byId.get(id)?.parent) {
      seen.add(id)
      const enclosure = enclosedBy.get(id)
      if (enclosure) return enclosure === membraneId
    }
    return false
  }

  // Each dock is to a face the compartment can reach: the inner face of a membrane it is within, or the outer face
  // of one standing beside it, in the same compartment (or both on the canvas).
  for (const compartment of compartments) {
    for (const dock of compartment.docks ?? []) {
      const membrane = membraneOf(dock.on)
      if (!membrane) continue
      const onWhat = byId.get(dock.on).kind === 'fold' ? `fold "${dock.on}"` : `membrane "${dock.on}"`
      if (dock.face === 'inside' && !isWithin(compartment.id, membrane.id)) {
        problems.push(`Compartment "${compartment.id}" docks to the inside of ${onWhat} but is not within it.`)
      }
      if (
        dock.face === 'outside' &&
        (enclosedBy.get(compartment.id) === membrane.id || compartment.parent !== membrane.parent)
      ) {
        problems.push(`Compartment "${compartment.id}" docks to the outside of ${onWhat} but does not stand beside it.`)
      }
    }
  }
  // Only one compartment meets each face of a stretch of membrane.
  for (const [key, list] of docks) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (!overlaps(list[i], list[j])) continue
        const [on, side, face] = key.split('/')
        const where = side ? `the ${side} side of membrane "${on}"` : `fold "${on}"`
        problems.push(
          `Compartments "${list[i].compartment}" and "${list[j].compartment}" both dock to the ${face} of ${where}.`,
        )
      }
    }
  }

  /** Membrane id -> its bulk: the compartment it encloses docked to none of its sides, if there is just one. */
  const bulks = new Map()
  for (const membrane of membranes) {
    const docked = (id) =>
      (byId.get(id).docks ?? []).some((dock) => dock.face === 'inside' && membraneOf(dock.on)?.id === membrane.id)
    const loose = membrane.encloses.filter((id) => !docked(id))
    if (loose.length > 1) {
      problems.push(
        `Membrane "${membrane.id}" encloses ${loose.map((id) => `"${id}"`).join(', ')}, none docked to its sides: dock all but one, so each stretch of it meets one compartment inside.`,
      )
    }
    bulks.set(membrane.id, loose.length === 1 ? loose[0] : null)
  }

  /** Membrane id -> its spans, side by side, each with the side it is on and its path. */
  const spans = new Map(
    membranes.map((membrane) => [
      membrane.id,
      SIDES.flatMap((side) =>
        (membrane.sides?.[side] ?? []).map((span) => ({
          ...span,
          side,
          membrane: membrane.id,
          path: spanPath(membrane.id, span.id),
        })),
      ),
    ]),
  )
  const spanByPath = new Map([...spans.values()].flat().map((span) => [span.path, span]))
  const middle = (span) => (span.from + span.to) / 2

  /** What lies inside a membrane's side at a point along it. */
  const insideAt = (membrane, side, at) =>
    occupants(membrane.id, side, 'inside', at)[0] ?? bulks.get(membrane.id) ?? null
  /** What lies outside a membrane's side at a point along it: what is docked there, else the compartment it is in. */
  function outsideAt(membrane, side, at) {
    const docked = occupants(membrane.id, side, 'outside', at)
    return docked.length ? docked : membrane.parent ? [membrane.parent] : []
  }

  for (const span of spanByPath.values()) {
    if (!insideAt(byId.get(span.membrane), span.side, middle(span))) {
      problems.push(
        `The ${span.side} side of membrane "${span.membrane}" meets no compartment inside at "${span.id}": dock one there, or leave it a bulk.`,
      )
    }
  }

  /**
   * The compartment a stretch of membrane, or a fold, meets on its inside.
   *
   * @param {string} path - '<membrane>.<span>', or a fold's id.
   * @returns {string|null}
   */
  function insideOf(path) {
    const span = spanByPath.get(path)
    if (span) return insideAt(byId.get(span.membrane), span.side, middle(span))
    const fold = byId.get(path)
    if (fold?.kind !== 'fold') return null
    // A fold's walls meet what is docked to them, else what lies inside the side where it dips in.
    return occupants(fold.id, undefined, 'inside', 0.5)[0] ?? insideAt(byId.get(fold.membrane), fold.side, fold.at)
  }

  /**
   * The compartments a stretch of membrane, or a fold, meets on its outside. A fold's lumen is what is docked into
   * it, else what lies outside the side it dips in from.
   *
   * @param {string} path - '<membrane>.<span>', or a fold's id.
   * @returns {string[]}
   */
  function outsideOf(path) {
    const span = spanByPath.get(path)
    if (span) return outsideAt(byId.get(span.membrane), span.side, middle(span))
    const fold = byId.get(path)
    if (fold?.kind !== 'fold') return []
    const docked = occupants(fold.id, undefined, 'outside', 0.5)
    return docked.length ? docked : outsideAt(byId.get(fold.membrane), fold.side, fold.at)
  }

  /** How many membranes close a compartment off from the canvas. */
  function compartmentDepth(id) {
    let depth = 0
    const seen = new Set()
    for (let at = id; at && !seen.has(at); at = byId.get(at)?.parent) {
      seen.add(at)
      if (enclosedBy.has(at)) depth++
    }
    return depth
  }

  /**
   * How deep a site lies: for a compartment, the membranes round it; for a membrane, its spans and folds, the depth
   * of the compartment it stands in; for a zone, its compartment's; for a tube, its first end's.
   *
   * @param {string} path
   * @returns {number|null} Null for no such site.
   */
  function depthOf(path) {
    const span = spanByPath.get(path)
    const piece = byId.get(span ? span.membrane : path)
    if (!piece) return null
    switch (piece.kind) {
      case 'compartment':
        return compartmentDepth(piece.id)
      case 'membrane':
        return piece.parent ? compartmentDepth(piece.parent) : 0
      case 'fold':
        return depthOf(piece.membrane)
      case 'zone':
        return compartmentDepth(piece.compartment)
      case 'tube':
        return compartmentDepth(piece.ends[0])
      default:
        return null
    }
  }

  /**
   * The compartments a membrane added round a compartment would enclose: it and every compartment joined to it by
   * tubes, through others, that stands in the same place and is enclosed by no membrane yet.
   *
   * @param {string} compartmentId
   * @returns {string[]} In the order the pieces list them; empty when the compartment is enclosed already.
   */
  function tubeGroupOf(compartmentId) {
    const start = byId.get(compartmentId)
    if (start?.kind !== 'compartment' || enclosedBy.has(compartmentId)) return []
    const joinable = (id) =>
      byId.get(id)?.kind === 'compartment' && byId.get(id).parent === start.parent && !enclosedBy.has(id)
    const group = new Set([compartmentId])
    const tubes = ofKind('tube')
    for (let grew = true; grew;) {
      grew = false
      for (const { ends } of tubes) {
        const [a, b] = ends
        if (group.has(a) !== group.has(b) && joinable(group.has(a) ? b : a)) {
          group.add(group.has(a) ? b : a)
          grew = true
        }
      }
    }
    return compartments.filter((compartment) => group.has(compartment.id)).map((compartment) => compartment.id)
  }

  const bulkSet = new Set([...bulks.values()].filter(Boolean))

  /**
   * The sites a module can go on, in the order the pieces list them, each membrane's spans after it.
   *
   * @type {Array<{path: string, role: string, kind: 'single'|'slots', piece: string, span?: string, label: string}>}
   */
  const sites = []
  for (const piece of pieces) {
    const site = (path, role, kind, extra = {}) =>
      sites.push({
        path,
        role,
        kind,
        piece: piece.id,
        label: piece.label,
        ...extra,
      })
    if (piece.kind === 'membrane') {
      if (piece.site !== false) site(piece.id, 'membrane', 'single')
      for (const span of spans.get(piece.id)) {
        if (span.site !== false)
          site(span.path, 'membraneProtein', 'slots', {
            span: span.id,
            label: span.label,
          })
      }
      continue
    }
    if (piece.site === false) continue
    // A membrane's bulk is a cell's or organelle's inside; any other compartment is a region of fluid.
    if (piece.kind === 'compartment') site(piece.id, bulkSet.has(piece.id) ? 'cytosol' : 'region', 'single')
    if (piece.kind === 'fold') site(piece.id, 'membraneProtein', 'slots')
    if (piece.kind === 'zone') site(piece.id, 'cytosolic', 'slots')
    if (piece.kind === 'tube') site(piece.id, 'cytosolic', 'single')
  }
  const offered = new Map(sites.map((site) => [site.path, site]))

  /** The kind of piece a site is: a stretch of membrane is a 'span'. */
  const kindOf = (path) => (spanByPath.has(path) ? 'span' : byId.get(path)?.kind)

  /**
   * The pairs of offered sites that are neighbours: [a, b, how b lies to a, how a lies to b, context]. Built as
   * template sites' neighbours were, so today's connection rules read them unchanged.
   */
  const pairs = []
  const pair = (a, b, toA, toB, context = {}) => {
    if (a && b && offered.has(a) && offered.has(b)) pairs.push([a, b, toA, toB, context])
  }
  for (const membrane of membranes) {
    const bulk = bulks.get(membrane.id)
    const context = { membrane: membrane.id }
    pair(bulk, membrane.id, 'membrane', 'inside', context)
    const walls = [
      ...spans.get(membrane.id).map((span) => span.path),
      ...ofKind('fold')
        .filter((fold) => fold.membrane === membrane.id)
        .map((fold) => fold.id),
    ]
    for (const path of walls) {
      const inside = insideOf(path)
      pair(path, inside, 'inside', 'protein', context)
      // It is still in its membrane, whose area and potential are the bulk's to give.
      if (bulk && inside !== bulk) pair(path, bulk, 'membrane', 'embedded', context)
      pair(path, membrane.id, 'membrane', 'protein', context)
      for (const outside of outsideOf(path)) pair(path, outside, 'outside', 'protein', context)
    }
  }
  for (const zone of ofKind('zone')) pair(zone.id, zone.compartment, 'inside', 'process')
  // A tube lies along the way from its first end to its second.
  for (const tube of ofKind('tube')) {
    pair(tube.id, tube.ends[0], 'upstream', 'downstream', {
      flux: tube.flux,
      end: 0,
    })
    pair(tube.id, tube.ends[1], 'downstream', 'upstream', {
      flux: tube.flux,
      end: 1,
    })
  }

  /**
   * The sites next to a site, which a module put there connects to. The relation holds both ways, so modules put in
   * any order end up joined the same.
   *
   * @param {string} path
   * @returns {Array<{path: string, relation: string, context: {kind: string, membrane?: string, flux?: string,
   *   end?: number}}>} relation: how the neighbour lies to the site ('inside', 'outside', 'membrane', 'protein',
   *   'process', 'embedded', 'upstream' or 'downstream'); context.kind: the neighbour's kind of piece; membrane:
   *   the membrane the two meet across or in; flux and end: a tube's, and which of its ends the compartment is.
   */
  function neighbours(path) {
    const found = []
    for (const [a, b, toA, toB, context] of pairs) {
      if (a === path)
        found.push({
          path: b,
          relation: toA,
          context: { kind: kindOf(b), ...context },
        })
      else if (b === path)
        found.push({
          path: a,
          relation: toB,
          context: { kind: kindOf(a), ...context },
        })
    }
    return found
  }

  return {
    /** Why the pieces don't hold together; empty when they do. */
    problems,
    sites,
    /** @param {string} id @returns {Object|undefined} */
    piece: (id) => byId.get(id),
    /** @param {string} membraneId @returns {Array<Object>} Its spans, side by side, top first. */
    spansOf: (membraneId) => spans.get(membraneId) ?? [],
    /** @param {string} path @returns {Object|undefined} The span at '<membrane>.<span>'. */
    span: (path) => spanByPath.get(path),
    insideOf,
    outsideOf,
    /** @param {string} zoneId @returns {string|null} The compartment a process zone is within. */
    withinOf: (zoneId) => (byId.get(zoneId)?.kind === 'zone' ? byId.get(zoneId).compartment : null),
    /** @param {string} tubeId @returns {[string, string]|null} The compartments it joins, upstream first. */
    endsOf: (tubeId) => (byId.get(tubeId)?.kind === 'tube' ? [...byId.get(tubeId).ends] : null),
    /** @param {string} foldId @returns {string[]} The lumen of a fold: what lies outside its walls. */
    foldLumen: (foldId) => (byId.get(foldId)?.kind === 'fold' ? outsideOf(foldId) : []),
    /** @param {string} compartmentId @returns {string|null} The membrane that encloses it. */
    enclosureOf: (compartmentId) => enclosedBy.get(compartmentId) ?? null,
    /** @param {string} membraneId @returns {string|null} The compartment filling it that no side is docked to. */
    bulkOf: (membraneId) => bulks.get(membraneId) ?? null,
    isWithin,
    depthOf,
    tubeGroupOf,
    neighbours,
  }
}
