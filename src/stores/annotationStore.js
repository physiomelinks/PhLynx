import { defineStore } from 'pinia'
import { markRaw, ref } from 'vue'

import { parseApiCoords } from '../services/annotations/apicoord'

/**
 * Normalises a saved instance source, or returns null when it has no location or text.
 *
 * @param {Object} source
 * @returns {{ location: string, format: string, text: string }|null}
 */
function normaliseSource(source) {
  if (!source || typeof source.location !== 'string' || !source.location || typeof source.text !== 'string') return null
  return {
    location: source.location,
    format: typeof source.format === 'string' && source.format ? source.format : 'turtle',
    text: source.text,
  }
}

/**
 * Merges parsed instance files into one: later files' coords and scopes win, and each warning names its file.
 *
 * @param {Array<{ location: string, parsed: Object }>} parses - From parseApiCoords.
 * @returns {{ instances: Array, coords: Map, scopes: Map, warnings: Array }}
 */
function mergeApiCoords(parses) {
  const merged = {
    instances: [],
    coords: new Map(),
    scopes: new Map(),
    warnings: [],
  }
  for (const { location, parsed } of parses) {
    merged.instances.push(...parsed.instances.map((instance) => ({ ...instance, location })))
    parsed.coords.forEach((coord, iri) => merged.coords.set(iri, coord))
    parsed.scopes.forEach((scope, iri) => merged.scopes.set(iri, scope))
    merged.warnings.push(...parsed.warnings.map((warning) => ({ ...warning, location })))
  }
  return merged
}

/**
 * The workspace's annotation state: the ApiCoord instance files kept as loaded, their parse (a cache, never
 * saved), and the suggestion keys the user dismissed.
 */
export const useAnnotationStore = defineStore('annotations', () => {
  /** The instance files, verbatim, so export can write them back unchanged. */
  const instanceSources = ref([])
  /** Keys (see match.js suggestionKey) of the suggestions the user dismissed. */
  const dismissedSuggestions = ref(new Set())

  // location -> { text, format, parsed }. Non-reactive; parses counts filled entries, so getApiCoords' readers
  // recompute once a parse lands.
  const parsedSources = markRaw(new Map())
  const pendingParses = new Map()
  const parses = ref(0)

  function resetState() {
    instanceSources.value = []
    dismissedSuggestions.value = new Set()
    parsedSources.clear()
    pendingParses.clear()
  }

  /**
   * Adds an instance file, replacing the one at its location.
   *
   * @param {{ location: string, format?: string, text: string }} source
   */
  function addInstanceSource(source) {
    const added = normaliseSource(source)
    if (!added) throw new Error('An instance file needs a location and text.')
    const index = instanceSources.value.findIndex(({ location }) => location === added.location)
    instanceSources.value =
      index < 0
        ? [...instanceSources.value, added]
        : instanceSources.value.map((entry, i) => (i === index ? added : entry))
  }

  /**
   * Removes the instance file at a location.
   *
   * @param {string} location
   */
  function removeInstanceSource(location) {
    instanceSources.value = instanceSources.value.filter((source) => source.location !== location)
    parsedSources.delete(location)
  }

  /**
   * Gets a source's cached parse if it is for the source as it is now.
   *
   * @param {{ location: string, format: string, text: string }} source
   * @returns {Object|null}
   */
  function currentParse(source) {
    const cached = parsedSources.get(source.location)
    return cached && cached.text === source.text && cached.format === source.format ? cached.parsed : null
  }

  /**
   * Parses one source, sharing a parse already under way and caching it while the source is unchanged.
   *
   * @param {{ location: string, format: string, text: string }} source
   * @returns {Promise<Object>} From parseApiCoords.
   */
  function parseSource(source) {
    const cached = currentParse(source)
    if (cached) return Promise.resolve(cached)
    const { location, format, text } = source
    const pending = pendingParses.get(location)
    if (pending?.text === text && pending.format === format) return pending.promise

    const promise = parseApiCoords(text, { format }).then((parsed) => {
      if (pendingParses.get(location)?.promise === promise) pendingParses.delete(location)
      const current = instanceSources.value.find((entry) => entry.location === location)
      if (current?.text === text && current.format === format) {
        parsedSources.set(location, { text, format, parsed: markRaw(parsed) })
        parses.value += 1
      }
      return parsed
    })
    pendingParses.set(location, { text, format, promise })
    return promise
  }

  /**
   * Parses every instance file not yet parsed and merges them.
   *
   * @returns {Promise<{ instances: Array, coords: Map, scopes: Map, warnings: Array }|null>} Null without files.
   */
  async function ensureApiCoords() {
    const sources = instanceSources.value
    if (!sources.length) return null
    const parsed = await Promise.all(sources.map(parseSource))
    return mergeApiCoords(
      sources.map((source, i) => ({
        location: source.location,
        parsed: parsed[i],
      }))
    )
  }

  /**
   * Gets the merged instance files if ensureApiCoords has parsed all of them as they are now. Reactive: readers
   * recompute when a parse lands.
   *
   * @returns {{ instances: Array, coords: Map, scopes: Map, warnings: Array }|null}
   */
  function getApiCoords() {
    void parses.value
    const sources = instanceSources.value
    if (!sources.length) return null
    const parsed = sources.map(currentParse)
    if (parsed.some((entry) => !entry)) return null
    return mergeApiCoords(
      sources.map((source, i) => ({
        location: source.location,
        parsed: parsed[i],
      }))
    )
  }

  /** @param {string} key */
  function dismissSuggestion(key) {
    dismissedSuggestions.value = new Set([...dismissedSuggestions.value, key])
  }

  /** @param {string} key */
  function restoreSuggestion(key) {
    const next = new Set(dismissedSuggestions.value)
    next.delete(key)
    dismissedSuggestions.value = next
  }

  /**
   * @param {string} key
   * @returns {boolean}
   */
  function isDismissed(key) {
    return dismissedSuggestions.value.has(key)
  }

  /**
   * Restores saved state; a workspace without annotations loads empty.
   *
   * @param {Object} [state] - From getState.
   */
  function loadState(state) {
    resetState()
    if (!state) return
    const sources = Array.isArray(state.instanceSources)
      ? state.instanceSources.map(normaliseSource).filter(Boolean)
      : []
    instanceSources.value = sources
    if (Array.isArray(state.dismissedSuggestions)) {
      dismissedSuggestions.value = new Set(state.dismissedSuggestions.filter((key) => typeof key === 'string'))
    }
  }

  function getState() {
    return {
      instanceSources: instanceSources.value.map((source) => ({ ...source })),
      dismissedSuggestions: [...dismissedSuggestions.value],
    }
  }

  return {
    instanceSources,
    dismissedSuggestions,
    resetState,
    addInstanceSource,
    removeInstanceSource,
    ensureApiCoords,
    getApiCoords,
    dismissSuggestion,
    restoreSuggestion,
    isDismissed,
    loadState,
    getState,
  }
})
