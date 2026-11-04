import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import { isLocalGlyphId, validateGlyph, validateGlyphLibrary } from '../services/bioView/glyphLibrary'
import { setLoadedGlyphs } from '../services/bioView/glyphs'
import { bareTemplateId, freeLocalId } from '../services/bioView/templates'

/** Where the user's own glyph libraries are kept, in localStorage. */
export const LOCAL_GLYPHS_KEY = 'phlynx-bio-glyphs-local'

/** The warning given when a library could not be kept on this device. */
export const GLYPHS_NOT_KEPT_WARNING =
  'It could not be kept on this device, so its glyphs will be gone from the Cartoon menu next time.'

/** @returns {Array<Object>} The user's libraries kept on this device; invalid or repeated ones are skipped. */
function readLocalLibraries() {
  let stored
  try {
    stored = JSON.parse(window.localStorage.getItem(LOCAL_GLYPHS_KEY) ?? '[]')
  } catch {
    return [] // localStorage unavailable (e.g. private browsing) or unreadable
  }
  if (!Array.isArray(stored)) return []
  const kept = new Map()
  const glyphIds = new Set()
  for (const raw of stored) {
    const { library } = validateGlyphLibrary(raw, { allowLocalId: true })
    if (!library || !isLocalGlyphId(library.id) || kept.has(library.id)) continue
    if (library.glyphs.some((glyph) => !isLocalGlyphId(glyph.id) || glyphIds.has(glyph.id))) continue
    library.glyphs.forEach((glyph) => glyphIds.add(glyph.id))
    kept.set(library.id, library)
  }
  return [...kept.values()]
}

/**
 * @param {Array<Object>} libraries - Kept on this device.
 * @returns {boolean} Whether they were kept; false when localStorage is full or unavailable.
 */
function writeLocalLibraries(libraries) {
  try {
    window.localStorage.setItem(LOCAL_GLYPHS_KEY, JSON.stringify(libraries))
    return true
  } catch {
    return false
  }
}

/** Whether two glyphs are the same apart from their ids. */
const sameGlyph = (a, b) => JSON.stringify({ ...a, id: '' }) === JSON.stringify({ ...b, id: '' })

/** Whether two libraries are the same apart from their own and their glyphs' ids. */
const sameLibrary = (a, b) =>
  a.glyphs.length === b.glyphs.length &&
  JSON.stringify({ ...a, id: '', glyphs: [] }) === JSON.stringify({ ...b, id: '', glyphs: [] }) &&
  a.glyphs.every((glyph, i) => sameGlyph(glyph, b.glyphs[i]))

/**
 * The glyphs drawn beside the built-ins: the user's own libraries, kept on this device, and the copies a
 * workspace embeds of the glyphs it uses. The embedded copy wins, so a workspace from another device looks as
 * it was saved. The glyph registry (services/bioView/glyphs.js) is kept in step.
 */
export const useGlyphLibraryStore = defineStore('glyphLibrary', () => {
  /** The user's own libraries, with 'local:' ids for the library and its glyphs. */
  const localLibraries = ref(readLocalLibraries())
  /** Glyph id -> the workspace's copy. Frozen values, so replaced, never mutated. */
  const definitions = shallowRef(new Map())

  /** Every loaded glyph, the workspace's copies first, so they win over the library's. */
  const glyphs = computed(() => {
    const own = localLibraries.value.flatMap((library) => library.glyphs)
    return [...definitions.value.values(), ...own.filter((glyph) => !definitions.value.has(glyph.id))]
  })

  const publish = () => setLoadedGlyphs(glyphs.value)
  publish()

  /** @returns {Set<string>} The glyph ids the libraries or this workspace use. */
  const ownGlyphIds = () => localLibraries.value.flatMap((library) => library.glyphs.map((glyph) => glyph.id))
  const takenGlyphIds = () => new Set([...ownGlyphIds(), ...definitions.value.keys()])

  /**
   * Validates a library and adds it to the user's own under 'local:' ids. A glyph id another glyph has gets a
   * number added; a glyph a workspace embeds from another device keeps its id. The same library loaded again is
   * not added twice.
   *
   * @param {*} raw - Parsed JSON, usually a glyph library file.
   * @returns {{ library: Object|null, errors: Array<string>, warnings: Array<string> }} The kept copy.
   */
  function addLocalLibrary(raw) {
    const bare = (value) => (typeof value?.id === 'string' ? { ...value, id: bareTemplateId(value.id) } : value)
    const unprefixed = raw && Array.isArray(raw.glyphs) ? { ...bare(raw), glyphs: raw.glyphs.map(bare) } : bare(raw)
    const { library, errors, warnings } = validateGlyphLibrary(unprefixed)
    if (!library) return { library: null, errors, warnings }

    const known = localLibraries.value.find((local) => sameLibrary(local, library))
    if (known) return { library: known, errors, warnings }

    const taken = takenGlyphIds()
    const glyphIds = []
    for (const glyph of library.glyphs) {
      // A workspace's copy of a glyph from another device joins the library under the same id.
      const embedded = [...definitions.value.values()].find(
        (definition) =>
          sameGlyph(definition, glyph) && !glyphIds.includes(definition.id) && !ownGlyphIds().includes(definition.id)
      )
      const id = embedded?.id ?? freeLocalId(glyph.id, [...taken, ...glyphIds])
      glyphIds.push(id)
    }
    const libraryId = freeLocalId(library.id, localLibraries.value.map((local) => local.id))
    const copy = JSON.parse(JSON.stringify(library))
    copy.id = libraryId
    copy.glyphs.forEach((glyph, i) => (glyph.id = glyphIds[i]))
    const { library: local } = validateGlyphLibrary(copy, { allowLocalId: true })
    localLibraries.value = [...localLibraries.value, local]
    publish()
    const kept = writeLocalLibraries(localLibraries.value)
    return { library: local, errors, warnings: kept ? warnings : [...warnings, GLYPHS_NOT_KEPT_WARNING] }
  }

  /**
   * Removes a library from the user's own. Workspaces that use its glyphs keep their own copies.
   *
   * @param {string} id
   * @returns {boolean} Whether it was there.
   */
  function removeLocalLibrary(id) {
    const remaining = localLibraries.value.filter((library) => library.id !== id)
    if (remaining.length === localLibraries.value.length) return false
    localLibraries.value = remaining
    writeLocalLibraries(remaining)
    publish()
    return true
  }

  /**
   * Embeds a loaded glyph in the workspace as it is chosen, so removing its library later leaves the workspace's
   * cartoons as they are. Built-ins are never embedded.
   *
   * @param {string} id
   */
  function adoptGlyph(id) {
    if (!isLocalGlyphId(id) || definitions.value.has(id)) return
    const glyph = glyphs.value.find((entry) => entry.id === id)
    if (!glyph) return
    definitions.value = new Map(definitions.value).set(id, glyph)
    publish()
  }

  function resetState() {
    definitions.value = new Map()
    publish()
  }

  /** @returns {Map<string, Object>} The workspace's copies, for undo. */
  const snapshot = () => new Map(definitions.value)

  /** @param {Map<string, Object>} state - From snapshot. */
  function restoreSnapshot(state) {
    definitions.value = new Map(state)
    publish()
  }

  /**
   * Restores the glyphs a saved workspace embeds; invalid ones are skipped, and their nodes drawn as their
   * GO functions or a generic protein say.
   *
   * @param {Object} [state] - From getState.
   */
  function loadState(state) {
    const loaded = new Map()
    for (const [id, raw] of Object.entries(state?.glyphs ?? {})) {
      const { glyph, errors } = validateGlyph(raw, { allowLocalId: true })
      if (!glyph) console.warn(`Skipping saved glyph ${id}:`, errors)
      else if (glyph.id !== id || !isLocalGlyphId(id)) {
        console.warn(`Skipping saved glyph ${id}: its id is ${glyph.id}.`)
      } else loaded.set(id, glyph)
    }
    definitions.value = loaded
    publish()
  }

  /**
   * @param {Iterable<string>} used - The glyph ids the workspace's nodes name.
   * @returns {{ glyphs: Object<string, Object> }|null} The loaded glyphs among them; null when there are none,
   *   so a workspace with only built-in cartoons saves as before.
   */
  function getState(used) {
    const saved = {}
    for (const id of new Set(used)) {
      const glyph = isLocalGlyphId(id) && glyphs.value.find((entry) => entry.id === id)
      if (glyph) saved[id] = JSON.parse(JSON.stringify(glyph))
    }
    return Object.keys(saved).length ? { glyphs: saved } : null
  }

  return {
    localLibraries,
    definitions,
    glyphs,
    addLocalLibrary,
    removeLocalLibrary,
    adoptGlyph,
    resetState,
    snapshot,
    restoreSnapshot,
    loadState,
    getState,
  }
})
