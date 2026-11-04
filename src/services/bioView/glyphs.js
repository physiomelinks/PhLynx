/**
 * The cartoons a membrane protein can be drawn as in the physiological view: the built-in glyph library, and
 * the glyphs the user or the workspace loaded. Each glyph can name the GO molecular functions it stands for;
 * any other protein is drawn as a generic one until the user picks.
 */

import { shallowRef } from 'vue'

import builtInLibrary from '../../assets/bio_glyphs/builtin.glyphs.json'
import { validateGlyphLibrary } from './glyphLibrary.js'

/**
 * Validates the bundled library, logging what is wrong with it.
 *
 * @param {*} raw - The parsed library file.
 * @returns {Array<Object>} Its frozen glyphs, or none when it is invalid.
 */
export function loadBuiltInGlyphs(raw) {
  const { library, errors } = validateGlyphLibrary(raw)
  if (!library) console.error('The built-in glyph library is invalid:', errors)
  return library?.glyphs ?? []
}

/** The built-in glyphs, in menu order. */
export const BUILT_IN_GLYPHS = Object.freeze(loadBuiltInGlyphs(builtInLibrary))

/** The built-in glyph ids, which saved bioView.glyph values name. */
export const GLYPHS = Object.freeze(BUILT_IN_GLYPHS.map((glyph) => glyph.id))

/** GO molecular function -> built-in glyph. */
export const GO_FUNCTION_GLYPHS = new Map(
  BUILT_IN_GLYPHS.flatMap((glyph) => (glyph.goFunctions ?? []).map((curie) => [curie, glyph.id]))
)

/** The glyphs loaded beside the built-ins ('local:' ids), set by the glyph library store; reactive. */
const loaded = shallowRef([])

/**
 * Replaces the loaded glyphs. Where two share an id, the first wins.
 *
 * @param {Array<Object>} glyphs - Validated glyphs with 'local:' ids.
 */
export function setLoadedGlyphs(glyphs) {
  loaded.value = Object.freeze([...glyphs])
}

/** @returns {Array<Object>} The loaded glyphs, in menu order. */
export const loadedGlyphs = () => loaded.value

/**
 * @param {string} id
 * @returns {Object|null} The glyph with that id: a built-in, else a loaded one.
 */
export function getGlyph(id) {
  if (typeof id !== 'string') return null
  return BUILT_IN_GLYPHS.find((glyph) => glyph.id === id) ?? loaded.value.find((glyph) => glyph.id === id) ?? null
}

/**
 * Picks a membrane protein's glyph: the user's choice, else the first of its GO functions with one (a built-in
 * mapping before a loaded glyph's), else 'generic'.
 *
 * @param {string[]} [isVersionOf] - The component's bqbiol:isVersionOf CURIEs.
 * @param {string} [override] - The user's choice.
 * @returns {string} A glyph id.
 */
export function glyphFor(isVersionOf = [], override) {
  if (getGlyph(override)) return override
  for (const curie of isVersionOf) if (GO_FUNCTION_GLYPHS.has(curie)) return GO_FUNCTION_GLYPHS.get(curie)
  for (const curie of isVersionOf) {
    const glyph = loaded.value.find((entry) => entry.goFunctions?.includes(curie))
    if (glyph) return glyph.id
  }
  return 'generic'
}
