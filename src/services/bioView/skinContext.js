/**
 * What a drawable thing of the physiology view is, for its skin: the family that says where its skin is kept and how
 * it is drawn, the target that says which skins it is offered, and the terms that rank them. Worked out from a
 * module's role or the pieces' topology, never stored.
 */

/** Each target, by the family it belongs to. */
export const SKIN_TARGETS = Object.freeze({
  module: Object.freeze(['protein', 'process']),
  area: Object.freeze(['cytosol', 'organelle', 'subcompartment', 'extracellular']),
  membrane: Object.freeze(['plasmaMembrane', 'organelleMembrane']),
  tube: Object.freeze(['conduit', 'gapJunction', 'bridge', 'diffusion']),
})

/** Target -> its family. */
export const FAMILY_OF = Object.freeze(
  Object.fromEntries(
    Object.entries(SKIN_TARGETS).flatMap(([family, targets]) => targets.map((target) => [target, family])),
  ),
)

/** Every target. */
export const ALL_TARGETS = Object.freeze(Object.keys(FAMILY_OF))

/** A tube's flux -> its target. */
const TUBE_TARGETS = Object.freeze({
  flow: 'conduit',
  junction: 'gapJunction',
  bridge: 'bridge',
  diffusion: 'diffusion',
})

/** A module's role -> its target. */
const MODULE_TARGETS = Object.freeze({ membraneProtein: 'protein', cytosolic: 'process' })

const contextOf = (target, terms = []) =>
  Object.freeze({ family: FAMILY_OF[target], target, terms: Object.freeze([...terms]) })

/**
 * What a module is drawn as, for its skin.
 *
 * @param {string} role - From resolveBioRole.
 * @param {string[]} [isVersionOf] - The module's bqbiol:isVersionOf CURIEs.
 * @returns {{family: string, target: string, terms: string[]}|null} Null for a role drawn with no skin.
 */
export function contextOfModule(role, isVersionOf = []) {
  const target = MODULE_TARGETS[role]
  return target
    ? contextOf(
        target,
        (isVersionOf ?? []).filter((term) => typeof term === 'string'),
      )
    : null
}

/**
 * The membrane a compartment is within, if any: the one that encloses it, the one whose inside face (or a fold's) it
 * is docked to, or, through the compartment it stands in, the one that compartment is within.
 *
 * @param {Object} topology - From topologyOf.
 * @param {string} compartmentId
 * @returns {string|null} The membrane's id.
 */
export function membraneAround(topology, compartmentId) {
  const seen = new Set()
  for (let id = compartmentId; id && !seen.has(id); id = topology.piece(id)?.parent) {
    seen.add(id)
    const enclosure = topology.enclosureOf(id)
    if (enclosure) return enclosure
    const dock = (topology.piece(id)?.docks ?? []).find((each) => each.face === 'inside')
    if (dock) {
      const on = topology.piece(dock.on)
      return on?.kind === 'fold' ? on.membrane : (on?.id ?? null)
    }
  }
  return null
}

/** A membrane's target: an organelle's where the compartment it stands in is within a membrane, else a cell's. */
const membraneTarget = (topology, membrane) =>
  membrane.parent && membraneAround(topology, membrane.parent) ? 'organelleMembrane' : 'plasmaMembrane'

/**
 * What a piece is drawn as, for its skin.
 *
 * @param {Object} topology - From topologyOf, over the pieces the piece is one of.
 * @param {string} id - The piece's.
 * @returns {{family: string, target: string, terms: string[]}|null} Null for a fold, a process zone or no such piece.
 */
export function contextOfPiece(topology, id) {
  const piece = topology.piece(id)
  if (!piece) return null
  const terms = piece.term ? [piece.term] : []
  switch (piece.kind) {
    case 'compartment': {
      const enclosure = topology.enclosureOf(id)
      if (enclosure && topology.bulkOf(enclosure) === id) {
        const membrane = topology.piece(enclosure)
        return contextOf(membraneTarget(topology, membrane) === 'organelleMembrane' ? 'organelle' : 'cytosol', terms)
      }
      return contextOf(membraneAround(topology, id) ? 'subcompartment' : 'extracellular', terms)
    }
    case 'membrane':
      return contextOf(membraneTarget(topology, piece), terms)
    case 'tube':
      return TUBE_TARGETS[piece.flux] ? contextOf(TUBE_TARGETS[piece.flux], terms) : null
    default:
      return null
  }
}
