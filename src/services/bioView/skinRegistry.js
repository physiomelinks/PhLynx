/**
 * Every skin there is, whatever it is drawn by, and which of them a thing is offered and drawn with. A skin record is
 * `{ id, name, appliesTo, terms?, renderer, author?, license?, isBuiltIn, ...art }`:
 * - symbol: shapes on a 64×48 canvas (elements, arrowRoom, faces, palette), for a module;
 * - area: cleaned SVG text (`svg`), for a compartment or an image on the canvas;
 * - line: a style the view draws by name (see BioMembraneLine), for a membrane; built in only;
 * - joint: a tube's joint the view draws by name (see BioJointSymbol); built in only. A symbol can draw a joint too,
 *   fitted into it.
 *
 * The built-ins ship with PhLynx: symbols in builtin.skins.json, area skins as SVG files named by the manifest beside
 * them. The rest are loaded: the skin library store hands them here (setLoadedSkins), reactively, so what reads them
 * here follows them.
 */

import { shallowRef } from 'vue'

import builtInLibrary from '../../assets/bio_skins/builtin.skins.json'
import manifest from '../../assets/bio_skins/manifest.json'
import { rendererOf, validateAreaSkin, validateSkinLibrary } from './skinLibrary.js'
import { FAMILY_OF } from './skinContext.js'

/** The choice of no skin, where a target allows it. */
export const NO_SKIN = 'none'

const lineSkin = (id, name, appliesTo) =>
  Object.freeze({ id, name, appliesTo: Object.freeze(appliesTo), renderer: 'line', isBuiltIn: true })

/** The membrane skins the view draws (see BioMembraneLine), built in. */
export const LINE_SKINS = Object.freeze([
  lineSkin('bilayer', 'Lipid bilayer', ['plasmaMembrane', 'organelleMembrane']),
  lineSkin('double-membrane', 'Double membrane', ['organelleMembrane']),
  lineSkin('wall', 'Plain wall', ['plasmaMembrane', 'organelleMembrane']),
])

const jointSkin = (id, name, appliesTo) =>
  Object.freeze({ id, name, appliesTo: Object.freeze(appliesTo), renderer: 'joint', isBuiltIn: true })

/** The joints the view draws (see BioJointSymbol), built in. */
export const JOINT_SKINS = Object.freeze([
  jointSkin('narrowing', 'Narrowing vessel', ['conduit']),
  jointSkin('connexon-pair', 'Connexon pair', ['gapJunction']),
  jointSkin('open-way', 'Open way', ['bridge', 'diffusion']),
  jointSkin('dashed-way', 'Dashed way', ['bridge', 'diffusion']),
])

/** What each target is drawn with when nothing is chosen and no skin's terms meet its own: none where absent. */
export const DEFAULT_SKINS = Object.freeze({
  protein: 'generic',
  process: 'process',
  plasmaMembrane: 'bilayer',
  organelleMembrane: 'bilayer',
  conduit: 'narrowing',
  gapJunction: 'connexon-pair',
  bridge: 'open-way',
  diffusion: 'dashed-way',
})

/**
 * The targets that can be drawn with no skin: an area plain, a process as a plain card, an image as its picture or a
 * placeholder for one.
 */
const NONE_ALLOWED = new Set(['process', 'cytosol', 'organelle', 'subcompartment', 'extracellular', 'image'])

/** Whether a target can be drawn with no skin. */
export const allowsNoSkin = (target) => NONE_ALLOWED.has(target)

const record = (skin, isBuiltIn) => Object.freeze({ ...skin, renderer: rendererOf(skin), isBuiltIn })

/** The built-in symbols, in menu order; none, with an error, should the bundled library be invalid. */
export const BUILT_IN_SYMBOLS = Object.freeze(
  (() => {
    const { library, errors } = validateSkinLibrary(builtInLibrary)
    if (!library) console.error('The built-in skin library is invalid:', errors)
    return (library?.skins ?? []).map((skin) => record(skin, true))
  })(),
)

const svgFiles = import.meta.glob('../../assets/bio_skins/*.svg', { eager: true, query: '?raw', import: 'default' })
let builtInAreas = null

/**
 * The area skins PhLynx ships, read once: each SVG file, said by the manifest what it is for. Reading one needs the
 * page's XML parser, so where there is none (outside a browser) there are none, and a piece that names one is drawn
 * plain.
 *
 * @returns {Array<Object>}
 */
function builtInAreaSkins() {
  if (builtInAreas) return builtInAreas
  if (typeof DOMParser === 'undefined') return []
  builtInAreas = []
  for (const [path, svg] of Object.entries(svgFiles)) {
    const id = path
      .split('/')
      .pop()
      .replace(/\.svg$/, '')
    const { skin, errors } = validateAreaSkin({ ...manifest[id], id, svg }, { where: `Built-in skin ${path}` })
    if (skin) builtInAreas.push(record(skin, true))
    else console.error(`Built-in skin ${path} is invalid:`, errors)
  }
  return builtInAreas
}

/** The skins loaded beside the built-ins ('local:' ids): the user's libraries' and the workspace's copies. */
const loaded = shallowRef([])

/**
 * Replaces the loaded skins. Where two share an id, the first wins.
 *
 * @param {Array<Object>} skins - Validated skins with 'local:' ids.
 */
export function setLoadedSkins(skins) {
  loaded.value = Object.freeze(skins.map((skin) => record(skin, false)))
}

/** @returns {Array<Object>} Every skin, built-ins before loaded ones; where two share an id, the first wins. */
export function allSkins() {
  const all = [...BUILT_IN_SYMBOLS, ...builtInAreaSkins(), ...LINE_SKINS, ...JOINT_SKINS, ...loaded.value]
  const seen = new Set()
  return all.filter((skin) => !seen.has(skin.id) && seen.add(skin.id))
}

/**
 * @param {string} id
 * @returns {Object|null} The skin with that id.
 */
export function getSkin(id) {
  if (typeof id !== 'string') return null
  return allSkins().find((skin) => skin.id === id) ?? null
}

/** Whether a skin's terms meet a context's. */
const meets = (skin, context) => !!skin.terms?.some((term) => context.terms?.includes(term))

/**
 * The skins a thing can be drawn with: those whose terms meet its own first, then the rest for its target, each in
 * registry order.
 *
 * @param {{target: string, terms?: string[]}|null} context - From contextOfModule or contextOfPiece.
 * @returns {Array<Object>}
 */
export function skinsFor(context, stored) {
  if (!context) return []
  const offered = allSkins().filter((skin) => skin.appliesTo.includes(context.target))
  // The one chosen for what the thing was, which it is drawn with still (see resolveSkin), after the rest.
  const kept = keptSkin(context, getSkin(storedId(stored)))
  return [
    ...offered.filter((skin) => meets(skin, context)),
    ...offered.filter((skin) => !meets(skin, context)),
    ...(kept ? [kept] : []),
  ]
}

/** The families a skin chosen for one target goes on drawing when its thing becomes another of them. */
const KEPT_FAMILIES = new Set(['area', 'membrane'])

/**
 * A skin chosen for another target of the same family as a thing, which an area or membrane goes on drawing when it
 * becomes another kind of one: artwork loaded for a fluid, kept once it is moved into a cell; an organelle's double
 * membrane, kept once it is moved out of its cell.
 */
function keptSkin(context, chosen) {
  if (!chosen || chosen.appliesTo.includes(context.target) || !KEPT_FAMILIES.has(context.family)) return null
  return chosen.appliesTo.some((target) => FAMILY_OF[target] === context.family) ? chosen : null
}

/** A stored choice as a skin id: a module keeps the id, a piece `{ ref }`. */
const storedId = (stored) => (typeof stored === 'string' ? stored : (stored?.ref ?? null))

/**
 * The skin a thing is drawn with: the one chosen, if there is one and it applies to the thing; else the first for its
 * target whose terms meet its own, built-ins before loaded ones; else its target's default. A choice that no longer
 * applies is left where it is, to be drawn again should the thing become what it applies to; an area's or membrane's
 * choice for another of its kind (see keptSkin) is drawn still.
 *
 * @param {{target: string, terms?: string[]}|null} context
 * @param {string|{ref: string}|null} [stored] - The choice: a skin id, a piece's skin, or NO_SKIN.
 * @returns {Object|null} The skin; null for none.
 */
export function resolveSkin(context, stored) {
  if (!context) return null
  const id = storedId(stored)
  if (id === NO_SKIN && allowsNoSkin(context.target)) return null
  const chosen = getSkin(id)
  if (chosen?.appliesTo.includes(context.target)) return chosen
  const kept = keptSkin(context, chosen)
  if (kept) return kept
  const offered = allSkins().filter((skin) => skin.appliesTo.includes(context.target))
  return offered.find((skin) => meets(skin, context)) ?? getSkin(DEFAULT_SKINS[context.target]) ?? null
}
