import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createPinia, setActivePinia } from 'pinia'
import { computed } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import { useAnnotationStore } from '../../../src/stores/annotationStore.js'

const TOY_COORDS = readFileSync(resolve(__dirname, '../fixtures/annotations/toy/toy-apicoords.ttl'), 'utf8')
const SOURCE = { location: 'apicoords.ttl', format: 'turtle', text: TOY_COORDS }

describe('annotationStore', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useAnnotationStore()
  })

  it('keeps instance sources verbatim and replaces one at the same location', () => {
    store.addInstanceSource(SOURCE)
    store.addInstanceSource({ location: 'other.ttl', text: '# empty' })
    store.addInstanceSource({ ...SOURCE, text: `${TOY_COORDS}# again\n` })
    expect(store.instanceSources.map((source) => source.location)).toEqual(['apicoords.ttl', 'other.ttl'])
    expect(store.instanceSources[0].text).toBe(`${TOY_COORDS}# again\n`)
    expect(store.instanceSources[1].format).toBe('turtle')

    store.removeInstanceSource('other.ttl')
    expect(store.instanceSources).toHaveLength(1)
    expect(() => store.addInstanceSource({ location: '', text: 'x' })).toThrow()
  })

  it('round trips sources and dismissed keys through getState and loadState', () => {
    store.addInstanceSource(SOURCE)
    store.dismissSuggestion('a|b|x')
    store.dismissSuggestion('c|d|y')
    store.restoreSuggestion('c|d|y')
    const state = JSON.parse(JSON.stringify(store.getState()))
    expect(state).toEqual({
      instanceSources: [SOURCE],
      dismissedSuggestions: ['a|b|x'],
    })

    setActivePinia(createPinia())
    const fresh = useAnnotationStore()
    fresh.loadState(state)
    expect(fresh.getState()).toEqual(state)
    expect(fresh.instanceSources[0].text).toBe(TOY_COORDS)
    expect(fresh.isDismissed('a|b|x')).toBe(true)
  })

  it('loads a workspace without annotations, or with malformed entries, empty or filtered', () => {
    store.addInstanceSource(SOURCE)
    store.loadState(undefined)
    expect(store.getState()).toEqual({
      instanceSources: [],
      dismissedSuggestions: [],
    })

    store.loadState({
      instanceSources: [{ location: 'x' }, SOURCE, null],
      dismissedSuggestions: [1, 'k'],
    })
    expect(store.getState()).toEqual({
      instanceSources: [SOURCE],
      dismissedSuggestions: ['k'],
    })
  })

  it('parses on ensure, caches, and serves the merged coords from the sync accessor', async () => {
    expect(await store.ensureApiCoords()).toBeNull()
    store.addInstanceSource(SOURCE)
    const coords = computed(() => store.getApiCoords())
    expect(coords.value).toBeNull()

    const parsed = await store.ensureApiCoords()
    expect(parsed.instances.map((instance) => instance.name).sort()).toEqual([
      'cell',
      'outside',
      'porter_in',
      'porter_out',
      'vessel',
      'wall',
    ])
    expect(parsed.instances.every((instance) => instance.location === 'apicoords.ttl')).toBe(true)
    expect(coords.value.instances).toHaveLength(6)
    expect(coords.value.coords.size).toBe(parsed.coords.size)
  })

  it('does not cache a parse the source changed under', async () => {
    store.addInstanceSource(SOURCE)
    const pending = store.ensureApiCoords()
    store.addInstanceSource({ ...SOURCE, text: `${TOY_COORDS}# edited\n` })
    await pending
    expect(store.getApiCoords()).toBeNull()
    await store.ensureApiCoords()
    expect(store.getApiCoords().instances).toHaveLength(6)
  })

  it('resets everything', async () => {
    store.addInstanceSource(SOURCE)
    store.dismissSuggestion('k')
    await store.ensureApiCoords()
    store.resetState()
    expect(store.getState()).toEqual({
      instanceSources: [],
      dismissedSuggestions: [],
    })
    expect(store.getApiCoords()).toBeNull()
  })
})
