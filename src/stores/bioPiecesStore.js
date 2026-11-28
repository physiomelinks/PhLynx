import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

import { imageIdOf, isImageEntry } from '../services/bioView/images'
import { validatePieces, writtenPieces } from '../services/bioView/pieces/model'
import { stampTemplate } from '../services/bioView/pieces/stamp'

const NONE = Object.freeze([])
const NO_IMAGES = Object.freeze({})

/**
 * The pieces the physiology view is built from (schema 4): compartments, membranes, tubes, folds, process zones and
 * images, with the pictures the images are drawn with.
 * They are the workspace's own; a template dropped on the view adds copies of
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
   * The pictures image pieces are drawn with, by id (see services/bioView/images.js): { type, data, width, height }.
   * Only ever added to while the workspace is open, so a step undone or redone always finds its pictures; a save
   * keeps only those an image piece names.
   */
  const images = shallowRef(NO_IMAGES)
  function resetState() {
    pieces.value = NONE
    draft.value = null
    images.value = NO_IMAGES
  }

  /**
   * Keeps a picture, once: the same picture added again is the one kept already.
   *
   * @param {{type: string, data: string, width: number, height: number}} entry - See isImageEntry.
   * @returns {string|null} Its id; null where it is no picture this build draws.
   */
  function addImage(entry) {
    if (!isImageEntry(entry)) return null
    const id = imageIdOf(entry.data)
    if (!images.value[id]) {
      const { type, data, width, height } = entry
      images.value = Object.freeze({ ...images.value, [id]: Object.freeze({ type, data, width, height }) })
    }
    return id
  }

  /** @param {string} id @returns {Object|null} A kept picture. */
  const imageOf = (id) => images.value[id] ?? null

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
   * @param {{ into?: {id: string, corner: {x: number, y: number}}|null }} [options] - The compartment it is dropped
   *   in (see stampTemplate); none, the canvas.
   * @returns {{ ids: Map<string, string>, errors: string[] }} ids: each template piece's id -> its copy's.
   */
  function addTemplate(template, at, { into = null } = {}) {
    const { pieces: all, ids, errors } = stampTemplate(pieces.value, template, at, { into })
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
   * Restores saved pieces; pieces that don't validate are dropped whole, with a warning.
   *
   * @param {Object} [state] - From getState.
   * @returns {string[]} Why the saved pieces were dropped; empty when they were kept, or there were none.
   */
  function loadState(state) {
    resetState()
    if (!state) return []
    const { pieces: valid, errors } = validatePieces(state.pieces ?? [])
    if (valid) pieces.value = valid
    else console.warn('Skipping the saved physiology pieces:', errors)
    // Each kept under the id its data gives, whatever it was saved under, so a picture is never mislabelled.
    const saved = state.images && typeof state.images === 'object' ? state.images : {}
    const kept = {}
    for (const [id, entry] of Object.entries(saved)) {
      if (!isImageEntry(entry)) {
        console.warn(`Skipping saved picture "${id}": it is not a picture this version can draw.`)
        continue
      }
      kept[imageIdOf(entry.data)] = Object.freeze({ ...entry })
    }
    images.value = Object.freeze(kept)
    return valid ? [] : errors
  }

  /**
   * @returns {{ pieces: Array<Object>, images?: Object }|null} Null with no pieces, so a workspace without them saves
   *   without them; the pictures only those its image pieces name.
   */
  function getState() {
    if (!pieces.value.length) return null
    const used = new Set(
      pieces.value.filter((piece) => piece.kind === 'image' && piece.image).map((piece) => piece.image),
    )
    const kept = Object.fromEntries([...used].filter((id) => images.value[id]).map((id) => [id, images.value[id]]))
    return { pieces: writtenPieces(pieces.value), ...(Object.keys(kept).length && { images: kept }) }
  }

  return {
    pieces,
    draft,
    images,
    addImage,
    imageOf,
    resetState,
    setPieces,
    addTemplate,
    snapshot,
    restoreSnapshot,
    edit,
    loadState,
    getState,
  }
})
