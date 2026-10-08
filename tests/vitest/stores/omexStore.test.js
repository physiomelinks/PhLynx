import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useOmexStore } from '../../../src/stores/omexStore.js'

/**
 * Gives the archive files at the locations given, each holding its own location.
 *
 * @param {string[]} locations
 */
function setExtras(locations) {
  useOmexStore().setArchive({ extras: locations.map((location) => ({ location, format: 'application/json', payload: new TextEncoder().encode(location).buffer })) })
}

const locations = () => useOmexStore().preservedExtras.map(({ location }) => location)

describe('omexStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('moves a file to another place, the others keeping their order', () => {
    setExtras(['a', 'b', 'c', 'd'])
    const store = useOmexStore()
    store.moveExtra('d', 1)
    expect(locations()).toEqual(['a', 'd', 'b', 'c'])
    store.moveExtra('a', 10)
    expect(locations()).toEqual(['d', 'b', 'c', 'a'])
    store.moveExtra('missing', 0)
    expect(locations()).toEqual(['d', 'b', 'c', 'a'])
    // The order is saved and read back.
    const state = store.getState()
    store.loadState(state)
    expect(locations()).toEqual(['d', 'b', 'c', 'a'])
  })

  it('removes a file', () => {
    setExtras(['a', 'b', 'c'])
    useOmexStore().removeExtra('b')
    expect(locations()).toEqual(['a', 'c'])
  })

  it('renames a file in its place, refusing a location another file has', () => {
    setExtras(['a', 'b', 'c'])
    const store = useOmexStore()
    store.renameExtra('b', 'folder/e')
    expect(locations()).toEqual(['a', 'folder/e', 'c'])
    expect(store.preservedExtras[1].payload).toBeInstanceOf(ArrayBuffer)
    expect(() => store.renameExtra('a', 'c')).toThrow('c already exists.')
    expect(locations()).toEqual(['a', 'folder/e', 'c'])
  })
})
