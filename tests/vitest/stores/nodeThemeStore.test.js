import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useNodeThemeStore } from '../../../src/stores/nodeThemeStore'
import { DEFAULT_THEME, THEMES_CDN_URL } from '../../../src/utils/nodeThemes'

const index = {
  schemaVersion: 1,
  themes: [
    {
      schemaVersion: 1,
      id: 'domain-types',
      name: 'Domain types',
      categories: [{ key: 'membrane', label: 'Membrane', color: '#ffe2ec' }],
    },
  ],
}

const okFetch = (body = index) => vi.fn(async () => ({ ok: true, status: 200, json: async () => body }))

describe('nodeThemeStore', () => {
  beforeEach(() => {
    window.localStorage.clear()
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts on the built-in theme', () => {
    const store = useNodeThemeStore()
    expect(store.activeTheme.id).toBe(DEFAULT_THEME.id)
    expect(store.allThemes.map((t) => t.id)).toEqual([DEFAULT_THEME.id])
  })

  it('fetches shared themes from the CDN and caches them', async () => {
    const store = useNodeThemeStore()
    const fetchImpl = okFetch()
    await store.refreshRemote({ fetchImpl })
    expect(fetchImpl.mock.calls[0][0]).toBe(THEMES_CDN_URL)
    expect(store.remoteStatus).toBe('ready')
    expect(store.remoteThemes.map((t) => t.id)).toEqual(['domain-types'])

    // A fresh session shows the cached copy before any fetch.
    setActivePinia(createPinia())
    const next = useNodeThemeStore()
    next.init()
    expect(next.remoteThemes.map((t) => t.id)).toEqual(['domain-types'])
  })

  it('keeps the current list when a fetch fails', async () => {
    const store = useNodeThemeStore()
    await store.refreshRemote({ fetchImpl: okFetch() })
    await store.refreshRemote({ fetchImpl: vi.fn(async () => ({ ok: false, status: 503 })) })
    expect(store.remoteStatus).toBe('error')
    expect(store.remoteError).toBe('HTTP 503')
    expect(store.remoteThemes).toHaveLength(1)
  })

  it('remembers a shared theme that has not loaded yet and uses the default meanwhile', async () => {
    const store = useNodeThemeStore()
    store.setActiveTheme('domain-types')
    setActivePinia(createPinia())
    const next = useNodeThemeStore()
    expect(next.activeThemeId).toBe('domain-types')
    expect(next.isActiveThemeAvailable).toBe(false)
    expect(next.activeTheme.id).toBe(DEFAULT_THEME.id)
    await next.refreshRemote({ fetchImpl: okFetch() })
    expect(next.activeTheme.id).toBe('domain-types')
  })

  it('creates, edits, persists and deletes local themes', async () => {
    const store = useNodeThemeStore()
    await store.refreshRemote({ fetchImpl: okFetch() })
    store.setActiveTheme('domain-types')

    const theme = store.createLocalTheme(undefined, 'Mine')
    expect(theme.id).toBe('local:mine')
    expect(theme.derivedFrom).toBe('domain-types')
    expect(store.activeThemeId).toBe('local:mine')

    expect(store.saveLocalTheme({ ...theme, categories: [{ key: 'membrane', label: 'Membrane', color: 'red' }] })).not.toEqual([])
    expect(store.saveLocalTheme({ ...theme, name: 'Mine, edited' })).toEqual([])

    setActivePinia(createPinia())
    const next = useNodeThemeStore()
    expect(next.localThemes.map((t) => t.name)).toEqual(['Mine, edited'])

    next.deleteLocalTheme('local:mine')
    expect(next.localThemes).toEqual([])
    // Not loaded in this session, so it falls back to the built-in theme rather than a missing one.
    expect(next.activeThemeId).toBe(DEFAULT_THEME.id)
  })

  it('imports a theme file as a new local theme', () => {
    const store = useNodeThemeStore()
    const { theme } = store.importTheme(JSON.stringify(index.themes[0]))
    expect(theme.id).toBe('local:domain-types')
    expect(store.activeThemeId).toBe('local:domain-types')
    expect(store.importTheme('{nope').errors).toEqual(['The file is not valid JSON.'])
    expect(store.importTheme('{"id":"x"}').theme).toBeNull()
  })
  describe('workspace theme', () => {
    const mine = {
      schemaVersion: 1,
      id: 'local:mine',
      name: 'Mine',
      categories: [{ key: 'pump', label: 'Pump', color: '#ffeedd' }],
    }

    it('saves a built-in theme by id only', () => {
      expect(useNodeThemeStore().getState()).toEqual({ id: DEFAULT_THEME.id })
    })

    it('saves a copy of a local or shared theme', async () => {
      const store = useNodeThemeStore()
      await store.refreshRemote({ fetchImpl: okFetch() })
      store.setActiveTheme('domain-types')
      expect(store.getState()).toEqual({ id: 'domain-types', theme: index.themes[0] })

      const local = store.createLocalTheme(undefined, 'Mine')
      expect(store.getState()).toEqual({ id: local.id, theme: local })
    })

    it('lists a theme this browser lacks for the workspace only, and saves it back unchanged', () => {
      const store = useNodeThemeStore()
      store.loadState({ id: mine.id, theme: mine })

      expect(store.activeTheme.id).toBe('workspace:mine')
      expect(store.activeTheme.categories).toEqual(mine.categories)
      expect(store.localThemes).toEqual([])
      expect(store.preferredThemeId).toBe(DEFAULT_THEME.id)
      expect(window.localStorage.getItem('phlynx-node-theme')).toBeNull()
      expect(window.localStorage.getItem('phlynx-node-themes-local')).toBeNull()
      expect(store.getState()).toEqual({ id: mine.id, theme: mine })
    })

    it('uses a theme here when it has the same id and colours', () => {
      const store = useNodeThemeStore()
      const local = store.createLocalTheme(undefined, 'Mine')
      store.setActiveTheme(DEFAULT_THEME.id)

      store.loadState({ id: local.id, theme: local })
      expect(store.activeThemeId).toBe(local.id)
      expect(store.workspaceThemes).toEqual([])
    })

    it('keeps the workspace copy when a theme here has the same id but other colours', () => {
      const store = useNodeThemeStore()
      const local = store.createLocalTheme(undefined, 'Mine')
      const changed = { ...local, categories: [{ key: 'pump', label: 'Pump', color: '#000000' }] }

      store.loadState({ id: local.id, theme: changed })
      expect(store.activeThemeId).toBe('workspace:mine')
      expect(store.activeTheme.categories).toEqual(changed.categories)
      expect(store.findTheme(local.id).categories).toEqual(local.categories)
    })

    it("shows this browser's choice for files without a theme, and after a reset", () => {
      const store = useNodeThemeStore()
      const local = store.createLocalTheme(undefined, 'Mine')

      store.loadState({ id: DEFAULT_THEME.id })
      expect(store.activeThemeId).toBe(DEFAULT_THEME.id)
      store.loadState(undefined)
      expect(store.activeThemeId).toBe(local.id)

      store.loadState({ id: mine.id, theme: { ...mine, categories: [] } })
      expect(store.activeThemeId).toBe(local.id)

      store.loadState({ id: 'local:other', theme: { ...mine, id: 'local:other' } })
      const snap = store.snapshot()
      store.resetState()
      expect(store.activeThemeId).toBe(local.id)
      expect(store.workspaceThemes).toEqual([])
      store.restoreSnapshot(snap)
      expect(store.activeThemeId).toBe('workspace:other')
    })

    it('copies the workspace theme into this browser on request', () => {
      const store = useNodeThemeStore()
      store.loadState({ id: mine.id, theme: mine })
      const copy = store.createLocalTheme(undefined, 'Kept')

      expect(copy.categories).toEqual(mine.categories)
      expect(store.activeThemeId).toBe(copy.id)
      expect(store.preferredThemeId).toBe(copy.id)
    })
  })
})
