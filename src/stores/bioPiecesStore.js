import { defineStore } from 'pinia'
import { shallowRef } from 'vue'

import { validatePieces } from '../services/bioView/pieces/model'
import { stampTemplate } from '../services/bioView/pieces/stamp'

const NONE = Object.freeze([])

/**
 * The pieces the physiology view is built from (schema 4): compartments, membranes, tubes, folds and process zones.
 * They are the workspace's own; a template dropped on the view adds copies of its pieces here. The list is frozen and
 * replaced, never changed in place, so the same list means the same pieces.
 */
export const useBioPiecesStore = defineStore('bioPieces', () => {
  /** The pieces, validated. */
  const pieces = shallowRef(NONE)

  function resetState() {
    pieces.value = NONE
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
   * @param {{ shapes?: Map<string, Object> }} [options] - The skins' geometry.
   * @returns {{ ids: Map<string, string>, errors: string[] }} ids: each template piece's id -> its copy's.
   */
  function addTemplate(template, at, options) {
    const { pieces: all, ids, errors } = stampTemplate(pieces.value, template, at, options)
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
   * Restores saved pieces; ones that don't validate are dropped whole, with a warning.
   *
   * @param {Object} [state] - From getState.
   */
  function loadState(state) {
    resetState()
    if (!state) return
    const { pieces: valid, errors } = validatePieces(state.pieces ?? [])
    if (valid) pieces.value = valid
    else console.warn('Skipping the saved physiology pieces:', errors)
  }

  /** @returns {{ pieces: Array<Object> }|null} Null with no pieces, so a workspace without them saves as before. */
  function getState() {
    return pieces.value.length ? { pieces: JSON.parse(JSON.stringify(pieces.value)) } : null
  }

  return { pieces, resetState, setPieces, addTemplate, snapshot, restoreSnapshot, edit, loadState, getState }
})
