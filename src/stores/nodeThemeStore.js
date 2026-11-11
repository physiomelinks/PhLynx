import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import {
  DEFAULT_THEME,
  THEMES_CDN_URL,
  deriveTheme,
  isLocalThemeId,
  isWorkspaceThemeId,
  parseThemeIndex,
  validateTheme,
  LOCAL_THEME_PREFIX,
  WORKSPACE_THEME_PREFIX,
} from '../utils/nodeThemes'

const ACTIVE_KEY = 'phlynx-node-theme'
const LOCAL_KEY = 'phlynx-node-themes-local'
const CACHE_KEY = 'phlynx-node-themes-cache'
const FETCH_TIMEOUT_MS = 10000

function readJson(key) {
  try {
    const raw = window.localStorage.getItem(key)
    return raw === null ? null : JSON.parse(raw)
  } catch (e) {
    return null // localStorage unavailable (e.g. private browsing) or unreadable
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value))
  } catch (e) {
    // ignore storage errors
  }
}

function readActiveId() {
  try {
    return window.localStorage.getItem(ACTIVE_KEY)
  } catch (e) {
    return null
  }
}

function readLocalThemes() {
  const stored = readJson(LOCAL_KEY)
  if (!Array.isArray(stored)) return []
  return stored.map((raw) => validateTheme(raw, { allowLocalId: true }).theme).filter((theme) => theme && isLocalThemeId(theme.id))
}

/**
 * @param {Object} theme
 * @returns {string} JSON that is the same for two themes exactly when they agree in all but id; a theme
 *   made in this session has not been through validateTheme, so has its fields in another order.
 */
const themeContent = (theme) => JSON.stringify({ ...validateTheme(theme, { allowLocalId: true }).theme, id: undefined })

/**
 * Node colour themes: the built-in default, shared themes from the CDN, themes made on this device,
 * and the theme a loaded workspace carries. The shared list is fetched in the background after the
 * app mounts; until it arrives the last copy fetched (if any) is used, so nothing waits on the
 * network.
 *
 * The active theme belongs to the workspace: a save records it (with a copy unless it is built in)
 * and a load restores it. The theme last chosen in this browser is the default for new workspaces
 * and for files saved without one.
 */
export const useNodeThemeStore = defineStore('nodeThemes', () => {
  const remoteThemes = ref([])
  const localThemes = ref(readLocalThemes())
  /** The theme last chosen in this browser. */
  const preferredThemeId = ref(readActiveId() || DEFAULT_THEME.id)
  const activeThemeId = ref(preferredThemeId.value)
  /**
   * The theme a loaded workspace carried, as saved, when no theme here matches it. It is never kept
   * in this browser; its listed copy has a 'workspace:' id so it cannot clash with a theme here.
   */
  const workspaceSource = ref(null)
  /** 'idle' | 'loading' | 'ready' | 'error' */
  const remoteStatus = ref('idle')
  const remoteError = ref(null)
  const remoteFetchedAt = ref(null)
  /** An unsaved theme being edited; while set it colours the canvas in place of the chosen theme. */
  const previewTheme = ref(null)

  let initialised = false
  let inFlight = null

  const builtInThemes = [DEFAULT_THEME]

  const workspaceThemes = computed(() => {
    const source = workspaceSource.value
    if (!source) return []
    const bareId = isLocalThemeId(source.id) ? source.id.slice(LOCAL_THEME_PREFIX.length) : source.id
    const theme = { ...source, id: `${WORKSPACE_THEME_PREFIX}${bareId}` }
    // A copy started from it should trace back to where the original came from.
    if (!isLocalThemeId(source.id) && !theme.derivedFrom) theme.derivedFrom = source.id
    return [theme]
  })

  const allThemes = computed(() => [
    ...workspaceThemes.value,
    ...builtInThemes,
    ...remoteThemes.value,
    ...localThemes.value,
  ])

  /** The chosen theme (or its preview); falls back to the default while a remote theme has not arrived or has gone. */
  const activeTheme = computed(
    () => previewTheme.value ?? allThemes.value.find((theme) => theme.id === activeThemeId.value) ?? DEFAULT_THEME
  )

  const isActiveThemeAvailable = computed(() => allThemes.value.some((theme) => theme.id === activeThemeId.value))

  function findTheme(id) {
    return allThemes.value.find((theme) => theme.id === id)
  }

  function applyRemoteIndex(index, fetchedAt) {
    const { themes, skipped } = parseThemeIndex(index)
    // Built-in ids win over remote ones with the same id.
    remoteThemes.value = themes.filter((theme) => !builtInThemes.some((builtIn) => builtIn.id === theme.id))
    remoteFetchedAt.value = fetchedAt
    if (skipped.length) console.warn('[nodeThemes] skipped invalid shared themes:', skipped)
  }

  function loadCachedRemote() {
    const cached = readJson(CACHE_KEY)
    if (cached?.index) applyRemoteIndex(cached.index, cached.fetchedAt ?? null)
  }

  /**
   * Fetches the shared theme list. Failures keep whatever list is already loaded.
   *
   * @param {Object} [options]
   * @param {Function} [options.fetchImpl=fetch]
   * @returns {Promise<void>}
   */
  function refreshRemote({ fetchImpl = globalThis.fetch } = {}) {
    if (inFlight) return inFlight
    remoteStatus.value = 'loading'
    remoteError.value = null

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const timer = controller ? setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS) : null

    inFlight = (async () => {
      try {
        const response = await fetchImpl(THEMES_CDN_URL, controller ? { signal: controller.signal } : undefined)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const index = await response.json()
        const fetchedAt = new Date().toISOString()
        applyRemoteIndex(index, fetchedAt)
        writeJson(CACHE_KEY, { fetchedAt, index })
        remoteStatus.value = 'ready'
      } catch (e) {
        remoteError.value = e?.name === 'AbortError' ? 'Timed out' : e?.message || String(e)
        remoteStatus.value = 'error'
      } finally {
        if (timer) clearTimeout(timer)
        inFlight = null
      }
    })()
    return inFlight
  }

  /**
   * Loads the cached shared themes now and refreshes them once the browser is idle. Safe to call
   * more than once.
   */
  function init() {
    if (initialised) return
    initialised = true
    loadCachedRemote()
    const schedule = globalThis.requestIdleCallback ?? ((callback) => setTimeout(callback, 1500))
    schedule(() => refreshRemote(), { timeout: 5000 })
  }

  /**
   * Shows a theme, and remembers it as this browser's choice unless it came with the workspace.
   *
   * @param {string} id
   */
  function setActiveTheme(id) {
    activeThemeId.value = id
    if (isWorkspaceThemeId(id)) return
    preferredThemeId.value = id
    writeJson(ACTIVE_KEY, id)
  }

  /**
   * @returns {{ id: string, theme?: Object }} The active theme for a workspace file: its id, and a
   *   copy unless it is built in (or is a shared theme that has not loaded, so cannot be copied).
   */
  function getState() {
    if (isWorkspaceThemeId(activeThemeId.value) && workspaceSource.value) {
      return { id: workspaceSource.value.id, theme: JSON.parse(JSON.stringify(workspaceSource.value)) }
    }
    const id = isWorkspaceThemeId(activeThemeId.value) ? DEFAULT_THEME.id : activeThemeId.value
    if (builtInThemes.some((theme) => theme.id === id)) return { id }
    const theme = findTheme(id)
    return theme ? { id, theme: JSON.parse(JSON.stringify(theme)) } : { id }
  }

  /**
   * Shows the theme a workspace file names. A theme here with the same id and colours is used as is;
   * otherwise the file's copy is listed for this workspace only. Files without a theme, or with an
   * unusable one, show this browser's choice.
   *
   * @param {{ id: string, theme?: Object }|null|undefined} state - From getState.
   */
  function loadState(state) {
    workspaceSource.value = null
    const id = typeof state?.id === 'string' ? state.id : null
    if (!id || isWorkspaceThemeId(id)) {
      activeThemeId.value = preferredThemeId.value
      return
    }
    if (!state.theme) {
      // A built-in or shared theme saved without a copy; a shared one shows once the list arrives.
      activeThemeId.value = id
      return
    }
    const { theme, errors } = validateTheme({ ...state.theme, id }, { allowLocalId: true })
    if (!theme) {
      console.warn(`[nodeThemes] the workspace's theme ${id} is unusable:`, errors)
      activeThemeId.value = findTheme(id) ? id : preferredThemeId.value
      return
    }
    const here = findTheme(id)
    if (here && themeContent(here) === themeContent(theme)) {
      activeThemeId.value = id
      return
    }
    workspaceSource.value = theme
    activeThemeId.value = workspaceThemes.value[0].id
  }

  /** Forgets the workspace's theme, for a new workspace. */
  function resetState() {
    workspaceSource.value = null
    activeThemeId.value = preferredThemeId.value
  }

  /** @returns {Object} For restoreSnapshot. */
  function snapshot() {
    return { workspaceSource: workspaceSource.value, activeThemeId: activeThemeId.value }
  }

  /** @param {Object} state - From snapshot. */
  function restoreSnapshot(state) {
    workspaceSource.value = state.workspaceSource
    activeThemeId.value = state.activeThemeId
  }

  function persistLocal() {
    writeJson(LOCAL_KEY, localThemes.value)
  }

  /**
   * Copies a theme into a new local theme and makes it active.
   *
   * @param {string} [fromId] - Defaults to the active theme.
   * @param {string} [name]
   * @returns {Object} The new theme.
   */
  function createLocalTheme(fromId = activeTheme.value.id, name) {
    const theme = draftLocalTheme(fromId, name)
    localThemes.value = [...localThemes.value, theme]
    persistLocal()
    setActiveTheme(theme.id)
    return theme
  }

  /**
   * Copies a theme under a new local id without keeping it; pass it to addLocalTheme to keep it.
   *
   * @param {string} [fromId] - Defaults to the active theme.
   * @param {string} [name]
   * @returns {Object} The unsaved theme.
   */
  function draftLocalTheme(fromId = activeTheme.value.id, name) {
    const base = findTheme(fromId) ?? DEFAULT_THEME
    return deriveTheme(base, { name, takenIds: allThemes.value.map((t) => t.id) })
  }

  /**
   * Validates and keeps a new local theme, and makes it active.
   *
   * @param {Object} theme - Usually from draftLocalTheme.
   * @returns {Array<string>} Validation errors; empty when saved.
   */
  function addLocalTheme(theme) {
    if (!isLocalThemeId(theme.id) || findTheme(theme.id)) return ['This theme already exists.']
    const { theme: clean, errors } = validateTheme(theme, { allowLocalId: true })
    if (!clean) return errors
    localThemes.value = [...localThemes.value, clean]
    persistLocal()
    setActiveTheme(clean.id)
    return []
  }

  /**
   * @param {Object|null} theme - The theme to show on the canvas while editing, or null to stop.
   */
  function setPreviewTheme(theme) {
    previewTheme.value = theme
  }

  /**
   * Replaces a local theme after validating it.
   *
   * @param {Object} theme - Must keep its id.
   * @returns {Array<string>} Validation errors; empty when saved.
   */
  function saveLocalTheme(theme) {
    const index = localThemes.value.findIndex((t) => t.id === theme.id)
    if (index < 0) return ['Only themes made on this device can be edited.']
    const { theme: clean, errors } = validateTheme(theme, { allowLocalId: true })
    if (!clean) return errors
    const next = [...localThemes.value]
    next[index] = clean
    localThemes.value = next
    persistLocal()
    return []
  }

  function deleteLocalTheme(id) {
    const theme = localThemes.value.find((t) => t.id === id)
    if (!theme) return
    localThemes.value = localThemes.value.filter((t) => t.id !== id)
    persistLocal()
    if (activeThemeId.value === id) {
      setActiveTheme(theme.derivedFrom && findTheme(theme.derivedFrom) ? theme.derivedFrom : DEFAULT_THEME.id)
    }
  }

  /**
   * Adds a theme from JSON text as a new local theme.
   *
   * @param {string} text
   * @returns {{ theme: Object|null, errors: Array<string> }}
   */
  function importTheme(text) {
    let raw
    try {
      raw = JSON.parse(text)
    } catch (e) {
      return { theme: null, errors: ['The file is not valid JSON.'] }
    }
    const bareId = typeof raw?.id === 'string' ? raw.id.replace(LOCAL_THEME_PREFIX, '') : raw?.id
    const { theme, errors } = validateTheme({ ...raw, id: bareId })
    if (!theme) return { theme: null, errors }
    const local = deriveTheme(theme, { name: theme.name, takenIds: allThemes.value.map((t) => t.id) })
    if (theme.derivedFrom) local.derivedFrom = theme.derivedFrom
    if (theme.author) local.author = theme.author
    if (theme.license) local.license = theme.license
    localThemes.value = [...localThemes.value, local]
    persistLocal()
    setActiveTheme(local.id)
    return { theme: local, errors: [] }
  }

  return {
    remoteThemes,
    localThemes,
    workspaceThemes,
    activeThemeId,
    preferredThemeId,
    activeTheme,
    isActiveThemeAvailable,
    allThemes,
    builtInThemes,
    remoteStatus,
    remoteError,
    remoteFetchedAt,
    previewTheme,
    findTheme,
    init,
    refreshRemote,
    setActiveTheme,
    createLocalTheme,
    draftLocalTheme,
    addLocalTheme,
    setPreviewTheme,
    saveLocalTheme,
    deleteLocalTheme,
    importTheme,
    getState,
    loadState,
    resetState,
    snapshot,
    restoreSnapshot,
  }
})
