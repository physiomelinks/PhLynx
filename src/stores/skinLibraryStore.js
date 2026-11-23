import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import { bareTemplateId, freeLocalId } from '../services/bioView/localIds'
import { SKIN_SCHEMA_VERSION, isLocalSkinId, validateSkin, validateSkinLibrary } from '../services/bioView/skinLibrary'
import { setLoadedSkins } from '../services/bioView/skinRegistry'

/** Where the user's own skin libraries are kept, in localStorage. */
export const LOCAL_SKINS_KEY = 'phlynx-bio-skins-local'

/** The warning given when a library could not be kept on this device. */
export const SKINS_NOT_KEPT_WARNING =
  'It could not be kept on this device, so its skins will be gone from the Skin menus next time.'

/** The library a loose SVG drawing, loaded from a compartment's Skin menu, joins. */
export const MY_SKINS = Object.freeze({ id: 'local:my-skins', name: 'My skins' })

/** @returns {Array<Object>} The user's libraries kept on this device; invalid or repeated ones are skipped. */
function readLocalLibraries() {
  let stored
  try {
    stored = JSON.parse(window.localStorage.getItem(LOCAL_SKINS_KEY) ?? '[]')
  } catch {
    return [] // localStorage unavailable (e.g. private browsing) or unreadable
  }
  if (!Array.isArray(stored)) return []
  const kept = new Map()
  const skinIds = new Set()
  for (const raw of stored) {
    // Kept SVG is cleaned again as it is read: what is on the device is no more trusted than a file.
    const { library } = validateSkinLibrary(raw, { allowLocalId: true })
    if (!library || !isLocalSkinId(library.id) || kept.has(library.id)) continue
    if (library.skins.some((skin) => !isLocalSkinId(skin.id) || skinIds.has(skin.id))) continue
    library.skins.forEach((skin) => skinIds.add(skin.id))
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
    window.localStorage.setItem(LOCAL_SKINS_KEY, JSON.stringify(libraries))
    return true
  } catch {
    return false
  }
}

/** Whether two skins are the same apart from their ids. */
const sameSkin = (a, b) => JSON.stringify({ ...a, id: '' }) === JSON.stringify({ ...b, id: '' })

/** Whether two libraries are the same apart from their own and their skins' ids. */
const sameLibrary = (a, b) =>
  a.skins.length === b.skins.length &&
  JSON.stringify({ ...a, id: '', skins: [] }) === JSON.stringify({ ...b, id: '', skins: [] }) &&
  a.skins.every((skin, i) => sameSkin(skin, b.skins[i]))

/** An id for a skin from its file's name: lower-case letters, digits and hyphens, starting with a letter. */
function idFromName(name) {
  const base = String(name ?? '')
    .toLowerCase()
    .replace(/\.svg$/, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^[^a-z]+|-+$/g, '')
    .slice(0, 40)
  return base.length >= 2 ? base : `skin${base ? `-${base}` : ''}`
}

/**
 * The skins drawn beside the built-ins: the user's own libraries, kept on this device, and the copies a workspace
 * keeps of the skins it uses. The workspace's copy wins, so a workspace from another device looks as it was saved.
 * The skin registry (services/bioView/skinRegistry.js) is kept in step.
 */
export const useSkinLibraryStore = defineStore('skinLibrary', () => {
  /** The user's own libraries, with 'local:' ids for the library and its skins. */
  const localLibraries = ref(readLocalLibraries())
  /** Skin id -> the workspace's copy. Frozen values, so replaced, never mutated. */
  const definitions = shallowRef(new Map())

  /** Every loaded skin, the workspace's copies first, so they win over the libraries'. */
  const skins = computed(() => {
    const own = localLibraries.value.flatMap((library) => library.skins)
    return [...definitions.value.values(), ...own.filter((skin) => !definitions.value.has(skin.id))]
  })

  const publish = () => setLoadedSkins(skins.value)
  publish()

  /** @returns {string[]} The skin ids the user's libraries use. */
  const ownSkinIds = () => localLibraries.value.flatMap((library) => library.skins.map((skin) => skin.id))
  const takenSkinIds = () => new Set([...ownSkinIds(), ...definitions.value.keys()])

  /** Keeps the libraries on this device; the warnings, with one more should they not fit. */
  function keep(warnings) {
    publish()
    return writeLocalLibraries(localLibraries.value) ? warnings : [...warnings, SKINS_NOT_KEPT_WARNING]
  }

  /**
   * Validates a library and adds it to the user's own under 'local:' ids. A skin id another skin has gets a number
   * added; a skin a workspace keeps from another device keeps its id. The same library loaded again is not added
   * twice.
   *
   * @param {*} raw - Parsed JSON, usually a skin library file.
   * @returns {{ library: Object|null, errors: Array<string>, warnings: Array<string> }} The kept copy.
   */
  function addLocalLibrary(raw) {
    const bare = (value) => (typeof value?.id === 'string' ? { ...value, id: bareTemplateId(value.id) } : value)
    const unprefixed = raw && Array.isArray(raw.skins) ? { ...bare(raw), skins: raw.skins.map(bare) } : bare(raw)
    const { library, errors, warnings } = validateSkinLibrary(unprefixed)
    if (!library) return { library: null, errors, warnings }

    const known = localLibraries.value.find((local) => sameLibrary(local, library))
    if (known) return { library: known, errors, warnings }

    const taken = takenSkinIds()
    const skinIds = []
    for (const skin of library.skins) {
      // A workspace's copy of a skin from another device joins the library under the same id.
      const embedded = [...definitions.value.values()].find(
        (definition) =>
          sameSkin(definition, skin) && !skinIds.includes(definition.id) && !ownSkinIds().includes(definition.id),
      )
      skinIds.push(embedded?.id ?? freeLocalId(skin.id, [...taken, ...skinIds]))
    }
    const libraryId = freeLocalId(
      library.id,
      localLibraries.value.map((local) => local.id),
    )
    const copy = JSON.parse(JSON.stringify(library))
    copy.id = libraryId
    copy.skins.forEach((skin, i) => (skin.id = skinIds[i]))
    const { library: local } = validateSkinLibrary(copy, { allowLocalId: true })
    localLibraries.value = [...localLibraries.value, local]
    return { library: local, errors, warnings: keep(warnings) }
  }

  /**
   * Adds an SVG drawing loaded for a compartment to the user's "My skins" library, cleaned, and to the workspace. The
   * same drawing for the same things is added once.
   *
   * @param {string} name - Its file's name.
   * @param {string} text - The SVG file's contents.
   * @param {{ appliesTo: string[], terms?: string[] }} tags - What it is for.
   * @returns {{ skin: Object|null, errors: Array<string>, warnings: Array<string> }}
   */
  function addSvg(name, text, tags) {
    const label =
      String(name ?? '')
        .replace(/\.svg$/i, '')
        .trim()
        .slice(0, 64) || 'Skin'
    const id = freeLocalId(idFromName(label), takenSkinIds())
    const { skin, errors, warnings } = validateSkin({ id, name: label, ...tags, svg: text }, { allowLocalId: true })
    if (!skin) return { skin: null, errors, warnings }
    const same = skins.value.find((each) => sameSkin(each, skin))
    if (same) {
      adoptSkin(same.id)
      return { skin: same, errors, warnings }
    }
    const mine = localLibraries.value.find((library) => library.id === MY_SKINS.id)
    const raw = mine
      ? { ...JSON.parse(JSON.stringify(mine)), skins: [...JSON.parse(JSON.stringify(mine.skins)), skin] }
      : { schemaVersion: SKIN_SCHEMA_VERSION, ...MY_SKINS, skins: [skin] }
    const { library, errors: invalid } = validateSkinLibrary(raw, { allowLocalId: true })
    if (!library) return { skin: null, errors: invalid, warnings }
    localLibraries.value = mine
      ? localLibraries.value.map((each) => (each.id === MY_SKINS.id ? library : each))
      : [...localLibraries.value, library]
    const kept = keep(warnings)
    adoptSkin(id)
    return { skin: library.skins.find((each) => each.id === id), errors: [], warnings: kept }
  }

  /**
   * Removes a library from the user's own. Workspaces that use its skins keep their own copies.
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
   * Keeps a copy of a loaded skin in the workspace as it is chosen, so removing its library later leaves the
   * workspace as it is. Built-ins are never copied.
   *
   * @param {string} id
   */
  function adoptSkin(id) {
    if (!isLocalSkinId(id) || definitions.value.has(id)) return
    const skin = skins.value.find((entry) => entry.id === id)
    if (!skin) return
    definitions.value = new Map(definitions.value).set(id, skin)
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
   * Restores the skins a saved workspace keeps; invalid ones are skipped, and what names them drawn as though it
   * named none. SVG is cleaned again as it is read.
   *
   * @param {Object} [state] - From getState.
   */
  function loadState(state) {
    const read = new Map()
    for (const [id, raw] of Object.entries(state?.skins ?? {})) {
      const { skin, errors } = validateSkin(raw, { allowLocalId: true })
      if (!skin) console.warn(`Skipping saved skin ${id}:`, errors)
      else if (skin.id !== id || !isLocalSkinId(id)) console.warn(`Skipping saved skin ${id}: its id is ${skin.id}.`)
      else read.set(id, skin)
    }
    definitions.value = read
    publish()
  }

  /**
   * @param {Iterable<string>} used - The skin ids the workspace's nodes and pieces name.
   * @returns {{ skins: Object<string, Object> }|null} The loaded skins among them; null when there are none, so a
   *   workspace with only built-in skins saves without the key.
   */
  function getState(used) {
    const saved = {}
    for (const id of new Set(used)) {
      const skin = isLocalSkinId(id) && skins.value.find((entry) => entry.id === id)
      if (skin) saved[id] = JSON.parse(JSON.stringify(skin))
    }
    return Object.keys(saved).length ? { skins: saved } : null
  }

  return {
    localLibraries,
    definitions,
    skins,
    addLocalLibrary,
    addSvg,
    removeLocalLibrary,
    adoptSkin,
    resetState,
    snapshot,
    restoreSnapshot,
    loadState,
    getState,
  }
})
