import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getGlyph, glyphFor, loadedGlyphs } from '../../../src/services/bioView/glyphs.js'
import { glyphLibraryFile } from '../../../src/services/bioView/glyphLibrary.js'
import { buildWorkspaceFile } from '../../../src/services/workspaceFile.js'
import { GLYPHS_NOT_KEPT_WARNING, LOCAL_GLYPHS_KEY, useGlyphLibraryStore } from '../../../src/stores/glyphLibraryStore.js'

const cup = (extra = {}) => ({
  id: 'cup',
  name: 'Cup',
  goFunctions: ['GO:0099999'],
  elements: [{ type: 'path', d: 'M 8 3 L 32 20 L 56 3 L 56 45 L 8 45 Z', fill: 'body', stroke: 'outline' }],
  palette: { light: { body: '#3366cc' } },
  ...extra,
})
const library = (glyphs = [cup()], extra = {}) => ({ schemaVersion: 1, id: 'mine', name: 'Mine', glyphs, ...extra })

function freshStore() {
  setActivePinia(createPinia())
  return useGlyphLibraryStore()
}

const stored = () => JSON.parse(window.localStorage.getItem(LOCAL_GLYPHS_KEY))

describe('glyphLibraryStore', () => {
  let warn

  beforeEach(() => {
    window.localStorage.clear()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    freshStore().resetState()
    vi.restoreAllMocks()
  })

  it('adds a library under local ids, registers its glyphs, and keeps it in localStorage', () => {
    const store = freshStore()
    const { library: added, errors, warnings } = store.addLocalLibrary(library())
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(added.id).toBe('local:mine')
    expect(added.glyphs.map((g) => g.id)).toEqual(['local:cup'])
    expect(getGlyph('local:cup')?.name).toBe('Cup')
    expect(glyphFor(['GO:0099999'])).toBe('local:cup')
    expect(glyphFor([], 'local:cup')).toBe('local:cup')
    expect(stored().map((l) => l.id)).toEqual(['local:mine'])

    // The next start reads it back.
    freshStore()
    expect(loadedGlyphs().map((g) => g.id)).toEqual(['local:cup'])
  })

  it('does not add the same library twice, and numbers a clashing glyph id', () => {
    const store = freshStore()
    store.addLocalLibrary(library())
    expect(store.addLocalLibrary(library()).library.id).toBe('local:mine')
    const other = store.addLocalLibrary(library([cup({ name: 'Other cup' })], { name: 'Other' })).library
    expect(other.id).toBe('local:mine-2')
    expect(other.glyphs[0].id).toBe('local:cup-2')
    expect(store.localLibraries).toHaveLength(2)
  })

  it('refuses an invalid library and says why', () => {
    const { library: none, errors } = freshStore().addLocalLibrary(library([cup({ elements: [{ type: 'image' }] })]))
    expect(none).toBeNull()
    expect(errors).toHaveLength(1)
    expect(stored()).toBeNull()
  })

  it('warns when the library cannot be kept on this device', () => {
    const store = freshStore()
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(full)
    expect(store.addLocalLibrary(library()).warnings).toEqual([GLYPHS_NOT_KEPT_WARNING])
  })

  it('round-trips a library through its file', () => {
    const store = freshStore()
    const { library: added } = store.addLocalLibrary(library())
    const { text } = glyphLibraryFile(added)
    store.removeLocalLibrary(added.id)
    expect(getGlyph('local:cup')).toBeNull()
    const again = store.addLocalLibrary(JSON.parse(text)).library
    expect(again).toEqual(added)
  })

  it('embeds the loaded glyphs a workspace uses, and only those', () => {
    const store = freshStore()
    store.addLocalLibrary(library([cup(), cup({ id: 'bowl', name: 'Bowl' })]))
    const flow = {
      nodes: [
        { id: 'a', data: { bioView: { glyph: 'local:cup' } } },
        { id: 'b', data: { bioView: { glyph: 'pump' } } },
        { id: 'c', data: {} },
      ],
    }
    const stores = {
      library: { getState: () => ({}) },
      simulation: { getState: () => ({}) },
      inspectionModules: { getState: () => ({}) },
      omex: { getState: () => ({}) },
      parameters: { getState: () => ({}) },
    }
    const file = buildWorkspaceFile({ flow, ...stores, bioGlyphs: store })
    expect(Object.keys(file.bioGlyphs.glyphs)).toEqual(['local:cup'])
    expect(file.bioGlyphs.glyphs['local:cup'].palette).toEqual({ light: { body: '#3366cc' } })
    // Only built-in cartoons: saved as before.
    const builtIn = buildWorkspaceFile({ flow: { nodes: [flow.nodes[1]] }, ...stores, bioGlyphs: store })
    expect(builtIn).not.toHaveProperty('bioGlyphs')
  })

  it('draws a workspace’s embedded glyph on a device without its library, and the embedded copy wins', () => {
    const saved = { glyphs: { 'local:cup': { ...cup(), id: 'local:cup', name: 'Saved cup' } } }
    const store = freshStore()
    store.addLocalLibrary(library())
    store.loadState(saved)
    expect(getGlyph('local:cup').name).toBe('Saved cup')
    store.resetState()
    expect(getGlyph('local:cup').name).toBe('Cup')

    // Elsewhere, with no library at all.
    window.localStorage.clear()
    const elsewhere = freshStore()
    elsewhere.loadState(saved)
    expect(getGlyph('local:cup').name).toBe('Saved cup')
    expect(elsewhere.getState(['local:cup']).glyphs['local:cup'].name).toBe('Saved cup')

    // Invalid or mis-keyed copies are skipped.
    elsewhere.loadState({ glyphs: { 'local:x': { ...cup(), id: 'local:y' }, 'local:z': { id: 'local:z' } } })
    expect(loadedGlyphs()).toEqual([])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('keeps a chosen glyph in the workspace after its library is removed', () => {
    const store = freshStore()
    const { library: added } = store.addLocalLibrary(library())
    store.adoptGlyph('local:cup')
    store.adoptGlyph('pump')
    store.removeLocalLibrary(added.id)
    expect(getGlyph('local:cup')?.name).toBe('Cup')
    expect([...store.definitions.keys()]).toEqual(['local:cup'])
    const snapshot = store.snapshot()
    store.resetState()
    expect(getGlyph('local:cup')).toBeNull()
    store.restoreSnapshot(snapshot)
    expect(getGlyph('local:cup')?.name).toBe('Cup')
  })
})
