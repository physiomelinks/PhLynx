import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { contextOfModule, contextOfPiece } from '../../../src/services/bioView/skinContext.js'
import { allSkins, getSkin, resolveSkin } from '../../../src/services/bioView/skinRegistry.js'
import { skinLibraryFile } from '../../../src/services/bioView/skinLibrary.js'
import { validatePieces } from '../../../src/services/bioView/pieces/model.js'
import { topologyOf } from '../../../src/services/bioView/pieces/topology.js'
import { buildWorkspaceFile } from '../../../src/services/workspaceFile.js'
import {
  LOCAL_SKINS_KEY,
  MY_SKINS,
  SKINS_NOT_KEPT_WARNING,
  useSkinLibraryStore,
} from '../../../src/stores/skinLibraryStore.js'

const getGlyph = getSkin
/** The loaded skins' ids, the built-ins left out. */
const loadedIds = () => allSkins().filter((skin) => !skin.isBuiltIn).map((skin) => skin.id)

const cup = (extra = {}) => ({
  id: 'cup',
  name: 'Cup',
  appliesTo: ['protein'],
  terms: ['GO:0099999'],
  elements: [{ type: 'path', d: 'M 8 3 L 32 20 L 56 3 L 56 45 L 8 45 Z', fill: 'body', stroke: 'outline' }],
  palette: { light: { body: '#3366cc' } },
  ...extra,
})
const library = (skins = [cup()], extra = {}) => ({ schemaVersion: 1, id: 'mine', name: 'Mine', skins, ...extra })

function freshStore() {
  setActivePinia(createPinia())
  return useSkinLibraryStore()
}

const stored = () => JSON.parse(window.localStorage.getItem(LOCAL_SKINS_KEY))

describe('skinLibraryStore', () => {
  let warn

  beforeEach(() => {
    window.localStorage.clear()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    freshStore().resetState()
    vi.restoreAllMocks()
  })

  it('adds a library under local ids, registers its skins, and keeps it in localStorage', () => {
    const store = freshStore()
    const { library: added, errors, warnings } = store.addLocalLibrary(library())
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(added.id).toBe('local:mine')
    expect(added.skins.map((g) => g.id)).toEqual(['local:cup'])
    expect(getGlyph('local:cup')?.name).toBe('Cup')
    expect(resolveSkin(contextOfModule('membraneProtein', ['GO:0099999'])).id).toBe('local:cup')
    expect(resolveSkin(contextOfModule('membraneProtein'), 'local:cup').id).toBe('local:cup')
    expect(stored().map((l) => l.id)).toEqual(['local:mine'])

    // The next start reads it back.
    freshStore()
    expect(loadedIds()).toEqual(['local:cup'])
  })

  it('does not add the same library twice, and numbers a clashing skin id', () => {
    const store = freshStore()
    store.addLocalLibrary(library())
    expect(store.addLocalLibrary(library()).library.id).toBe('local:mine')
    const other = store.addLocalLibrary(library([cup({ name: 'Other cup' })], { name: 'Other' })).library
    expect(other.id).toBe('local:mine-2')
    expect(other.skins[0].id).toBe('local:cup-2')
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
    expect(store.addLocalLibrary(library()).warnings).toEqual([SKINS_NOT_KEPT_WARNING])
  })

  it('round-trips a library through its file', () => {
    const store = freshStore()
    const { library: added } = store.addLocalLibrary(library())
    const { text } = skinLibraryFile(added)
    store.removeLocalLibrary(added.id)
    expect(getGlyph('local:cup')).toBeNull()
    const again = store.addLocalLibrary(JSON.parse(text)).library
    expect(again).toEqual(added)
  })

  it('keeps the loaded skins a workspace uses, and only those', () => {
    const store = freshStore()
    store.addLocalLibrary(library([cup(), cup({ id: 'bowl', name: 'Bowl' })]))
    const flow = {
      nodes: [
        { id: 'a', data: { bioView: { skin: 'local:cup' } } },
        { id: 'b', data: { bioView: { skin: 'pump' } } },
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
    const file = buildWorkspaceFile({ flow, ...stores, bioSkins: store })
    expect(Object.keys(file.bioSkins.skins)).toEqual(['local:cup'])
    expect(file.bioSkins.skins['local:cup'].palette).toEqual({ light: { body: '#3366cc' } })
    // Only built-in skins: no key.
    const builtIn = buildWorkspaceFile({ flow: { nodes: [flow.nodes[1]] }, ...stores, bioSkins: store })
    expect(builtIn).not.toHaveProperty('bioSkins')
  })

  it('draws a workspace’s copy of a skin on a device without its library, and the embedded copy wins', () => {
    const saved = { skins: { 'local:cup': { ...cup(), id: 'local:cup', name: 'Saved cup' } } }
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
    expect(elsewhere.getState(['local:cup']).skins['local:cup'].name).toBe('Saved cup')

    // Invalid or mis-keyed copies are skipped.
    elsewhere.loadState({ skins: { 'local:x': { ...cup(), id: 'local:y' }, 'local:z': { id: 'local:z' } } })
    expect(loadedIds()).toEqual([])
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('keeps a chosen skin in the workspace after its library is removed', () => {
    const store = freshStore()
    const { library: added } = store.addLocalLibrary(library())
    store.adoptSkin('local:cup')
    store.adoptSkin('pump')
    store.removeLocalLibrary(added.id)
    expect(getGlyph('local:cup')?.name).toBe('Cup')
    expect([...store.definitions.keys()]).toEqual(['local:cup'])
    const snapshot = store.snapshot()
    store.resetState()
    expect(getGlyph('local:cup')).toBeNull()
    store.restoreSnapshot(snapshot)
    expect(getGlyph('local:cup')?.name).toBe('Cup')
  })

  const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" onclick="x()"/></svg>'

  it('puts an SVG loaded for a compartment in My skins, cleaned, once, and in the workspace', () => {
    const store = freshStore()
    const { skin, errors } = store.addSvg('Myocyte art.svg', SVG, { appliesTo: ['cytosol'] })
    expect(errors).toEqual([])
    expect(skin).toMatchObject({ id: 'local:myocyte-art', name: 'Myocyte art', appliesTo: ['cytosol'] })
    expect(skin.svg).not.toContain('onclick')
    expect(store.localLibraries.map((each) => [each.id, each.name])).toEqual([[MY_SKINS.id, MY_SKINS.name]])
    expect([...store.definitions.keys()]).toEqual(['local:myocyte-art'])
    expect(getSkin('local:myocyte-art').renderer).toBe('area')
    // The same again is the same skin; for something else, another; for no area, none.
    expect(store.addSvg('Myocyte art.svg', SVG, { appliesTo: ['cytosol'] }).skin.id).toBe('local:myocyte-art')
    expect(store.addSvg('Myocyte art.svg', SVG, { appliesTo: ['organelle'] }).skin.id).toBe('local:myocyte-art-2')
    expect(store.addSvg('cup.svg', SVG, { appliesTo: ['protein'] }).skin).toBeNull()
    expect(store.addSvg('bad.svg', '<p>no</p>', { appliesTo: ['cytosol'] }).skin).toBeNull()
    expect(store.localLibraries[0].skins).toHaveLength(2)
    // Kept on the device, and read back, cleaned again.
    freshStore()
    expect(loadedIds()).toEqual(['local:myocyte-art', 'local:myocyte-art-2'])
  })

  it('saves the area skins the pieces use with the workspace, cleaned again as they are read', () => {
    const store = freshStore()
    store.addSvg('art.svg', SVG, { appliesTo: ['subcompartment'], terms: ['GO:0001750'] })
    const stores = {
      library: { getState: () => ({}) },
      simulation: { getState: () => ({}) },
      inspectionModules: { getState: () => ({}) },
      omex: { getState: () => ({}) },
      parameters: { getState: () => ({}) },
      bioPieces: { getState: () => ({ pieces: [{ id: 'c', kind: 'compartment', label: 'C', skin: { ref: 'local:art' } }] }) },
    }
    const file = buildWorkspaceFile({ flow: { nodes: [] }, ...stores, bioSkins: store })
    expect(file.bioSkins.skins['local:art']).toMatchObject({ appliesTo: ['subcompartment'], terms: ['GO:0001750'] })

    window.localStorage.clear()
    const elsewhere = freshStore()
    const tampered = file.bioSkins.skins['local:art'].svg.replace('<rect', '<script>1</script><rect')
    elsewhere.loadState({ skins: { 'local:art': { ...file.bioSkins.skins['local:art'], svg: tampered } } })
    expect(getSkin('local:art').svg).not.toContain('script')
  })

  it('ships the rod’s skins, said by the manifest to be for its segments, and draws a segment by its term', () => {
    freshStore()
    expect(getSkin('rod-outer-segment')).toMatchObject({
      name: 'Rod outer segment',
      appliesTo: ['subcompartment'],
      terms: ['GO:0001750'],
      renderer: 'area',
      isBuiltIn: true,
    })
    const { pieces } = validatePieces([
      { id: 'os', kind: 'compartment', label: 'OS', term: 'GO:0001917', parent: 'cell' },
      { id: 'cell', kind: 'compartment', label: 'Cell' },
      { id: 'm', kind: 'membrane', label: 'M', encloses: ['cell'] },
    ])
    expect(resolveSkin(contextOfPiece(topologyOf(pieces), 'os')).id).toBe('rod-inner-segment')
  })
})
