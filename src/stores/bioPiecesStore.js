import { defineStore } from 'pinia'
import { computed, shallowRef } from 'vue'

import { validatePieces, writtenPieces } from '../services/bioView/pieces/model'
import { stampTemplate } from '../services/bioView/pieces/stamp'
import { SKIN_ID, SKIN_LIMITS, freeSkinId, sanitiseSkin, skinParts } from '../services/bioView/skins'

const NONE = Object.freeze([])

const skinFiles = import.meta.glob('../assets/bio_skins/*.svg', { eager: true, query: '?raw', import: 'default' })
let shipped = null

/**
 * The skins PhLynx ships, read once: each named for its file. Reading one needs the page's XML parser, so where
 * there is none (outside a browser) there are none, and a piece that names one is drawn plain.
 *
 * @returns {Map<string, {id: string, name: string, svg: string, art: string|null, shape: Object|null}>}
 */
function builtInSkins() {
  if (shipped) return shipped
  if (typeof DOMParser === 'undefined') return new Map()
  shipped = new Map()
  for (const [path, text] of Object.entries(skinFiles)) {
    const id = path
      .split('/')
      .pop()
      .replace(/\.svg$/, '')
    const { svg, errors } = sanitiseSkin(text)
    if (!svg) console.error(`Built-in skin ${path} is invalid:`, errors)
    else shipped.set(id, Object.freeze({ id, name: id.replaceAll('-', ' '), svg, isBuiltIn: true, ...skinParts(svg) }))
  }
  return shipped
}

/**
 * The pieces the physiology view is built from (schema 4): compartments, membranes, tubes, folds and process zones,
 * and the skins they can be drawn with. They are the workspace's own; a template dropped on the view adds copies of
 * its pieces here. The list is frozen and replaced, never changed in place, so the same list means the same pieces.
 */
export const useBioPiecesStore = defineStore('bioPieces', () => {
  /** The pieces, validated. */
  const pieces = shallowRef(NONE)
  /**
   * The pieces as a drag in progress would leave them, validated, which the view lays out in their place until the
   * drag ends; null while nothing is dragged. Never saved, nor part of a step.
   */
  const draft = shallowRef(null)
  /**
   * The workspace's skins, by id: `{ id, name, svg, art, shape }`, the SVG cleaned (see sanitiseSkin), with its
   * artwork and the geometry it names apart (see skinParts). Replaced, never mutated.
   */
  const skins = shallowRef(new Map())
  /** Every skin a piece can be drawn with: the ones PhLynx ships, then the workspace's, which win by id. */
  const allSkins = computed(() => new Map([...builtInSkins(), ...skins.value]))
  /** The geometry of each skin that gives a membrane its shape, by skin id. */
  const shapes = computed(
    () => new Map([...allSkins.value].filter(([, skin]) => skin.shape).map(([id, skin]) => [id, skin.shape])),
  )

  function resetState() {
    pieces.value = NONE
    draft.value = null
    skins.value = new Map()
  }

  /**
   * Adds SVG artwork to the workspace's skins, cleaned.
   *
   * @param {string} name - What it is called, as its file is.
   * @param {string} text - The SVG file's contents.
   * @returns {{ skin: {id: string, name: string, svg: string}|null, errors: string[] }}
   */
  function addSkin(name, text) {
    if (skins.value.size >= SKIN_LIMITS.count)
      return { skin: null, errors: [`A workspace keeps at most ${SKIN_LIMITS.count} skins.`] }
    const { svg, errors } = sanitiseSkin(text)
    if (!svg) return { skin: null, errors }
    const same = [...skins.value.values()].find((skin) => skin.svg === svg)
    if (same) return { skin: same, errors: [] }
    const label =
      String(name ?? '')
        .replace(/\.svg$/i, '')
        .trim()
        .slice(0, SKIN_LIMITS.name) || 'Skin'
    const skin = Object.freeze({ id: freeSkinId(label, skins.value.keys()), name: label, svg, ...skinParts(svg) })
    skins.value = new Map([...skins.value, [skin.id, skin]])
    return { skin, errors: [] }
  }

  /** @param {string} id - A skin's. */
  function removeSkin(id) {
    if (!skins.value.has(id)) return false
    skins.value = new Map([...skins.value].filter(([key]) => key !== id))
    return true
  }

  /**
   * Replaces the pieces, once they validate.
   *
   * @param {*} raw - A list of pieces.
   * @returns {{ errors: string[], warnings: string[] }} The pieces are unchanged when there are errors.
   */
  function setPieces(raw) {
    const { pieces: valid, errors, warnings } = validatePieces(raw)
    if (valid) pieces.value = valid
    return { errors, warnings }
  }

  /**
   * Adds copies of a template's pieces, its corner at a point.
   *
   * @param {{ pieces: ReadonlyArray<Object> }} template - Validated.
   * @param {{x: number, y: number}} at - In flow coordinates.
   * @returns {{ ids: Map<string, string>, errors: string[] }} ids: each template piece's id -> its copy's.
   */
  function addTemplate(template, at) {
    const { pieces: all, ids, errors } = stampTemplate(pieces.value, template, at, { shapes: shapes.value })
    if (all) pieces.value = all
    return { ids, errors }
  }

  const snapshot = () => pieces.value
  /** @param {ReturnType<typeof snapshot>} state */
  const restoreSnapshot = (state) => {
    pieces.value = state
  }

  /**
   * Wraps a change to the store as a recordEdit `library` option, as the template store's edit does.
   *
   * @param {Function} mutate - Changes the store; its result is what `apply` returns.
   * @returns {{ apply: Function, isAt: (side: string) => boolean, restore: (side: string) => void }}
   */
  function edit(mutate) {
    const states = {}
    return {
      apply: () => {
        states.before = snapshot()
        const result = mutate()
        states.after = snapshot()
        return result
      },
      isAt: (side) => side in states && pieces.value === states[side],
      restore: (side) => {
        if (side in states) restoreSnapshot(states[side])
      },
    }
  }

  /**
   * Restores saved pieces and skins; pieces that don't validate are dropped whole, with a warning, and so is each
   * skin that isn't a drawing that can be used.
   *
   * @param {Object} [state] - From getState.
   */
  function loadState(state) {
    resetState()
    if (!state) return
    // Skins are read first, so the pieces' layout can find their shapes. They are cleaned again as they are read:
    // a saved file is no more trusted than a loaded one.
    const read = new Map()
    for (const [id, saved] of Object.entries(state.skins ?? {}).slice(0, SKIN_LIMITS.count)) {
      const { svg } = SKIN_ID.test(id) ? sanitiseSkin(saved?.svg) : { svg: null }
      if (svg)
        read.set(
          id,
          Object.freeze({ id, name: String(saved.name ?? id).slice(0, SKIN_LIMITS.name), svg, ...skinParts(svg) }),
        )
      else console.warn(`Skipping saved skin ${id}: it is not a drawing that can be used.`)
    }
    skins.value = read
    const { pieces: valid, errors } = validatePieces(state.pieces ?? [])
    if (valid) pieces.value = valid
    else console.warn('Skipping the saved physiology pieces:', errors)
  }

  /**
   * @returns {{ pieces: Array<Object>, skins?: Object<string, {name: string, svg: string}> }|null} Null with neither
   *   pieces nor skins, so a workspace without them saves as before.
   */
  function getState() {
    if (!pieces.value.length && !skins.value.size) return null
    const state = { pieces: writtenPieces(pieces.value) }
    if (skins.value.size)
      state.skins = Object.fromEntries([...skins.value].map(([id, { name, svg }]) => [id, { name, svg }]))
    return state
  }

  return {
    pieces,
    draft,
    skins,
    allSkins,
    shapes,
    resetState,
    addSkin,
    removeSkin,
    setPieces,
    addTemplate,
    snapshot,
    restoreSnapshot,
    edit,
    loadState,
    getState,
  }
})
