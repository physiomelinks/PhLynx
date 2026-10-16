import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useWorkspaceAppearanceStore } from '../../../src/stores/workspaceAppearanceStore.js'

describe('workspaceAppearanceStore', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useWorkspaceAppearanceStore()
  })

  it('starts with the built-in appearance for new connections', () => {
    expect(store.connectionDefaults).toEqual({})
    expect(store.isDefault).toBe(true)
    expect(store.getState()).toEqual({ connections: {} })
  })

  it('keeps only the default values that differ from the built-in ones', () => {
    store.setConnectionDefaults({ colour: '#00ff00', path: 'smoothstep', width: 'thick' })
    expect(store.connectionDefaults).toEqual({ colour: '#00ff00', width: 'thick' })
    expect(store.isDefault).toBe(false)
  })

  it('round-trips through getState and loadState', () => {
    store.setConnectionDefaults({ arrow: 'small', path: 'bezier' })
    const saved = JSON.parse(JSON.stringify(store.getState()))

    setActivePinia(createPinia())
    const loaded = useWorkspaceAppearanceStore()
    loaded.loadState(saved)
    expect(loaded.connectionDefaults).toEqual({ arrow: 'small', path: 'bezier' })
  })

  it('resets when loading a workspace with no appearance', () => {
    store.setConnectionDefaults({ width: 'thin' })
    store.loadState(undefined)
    expect(store.isDefault).toBe(true)
  })

  it('hands out copies of the default, so changing one leaves the store alone', () => {
    store.setConnectionDefaults({ width: 'thin' })
    const copy = store.newConnectionAppearance()
    copy.width = 'thick'
    expect(store.connectionDefaults).toEqual({ width: 'thin' })
  })

  it('gives new edges the default without changing them', () => {
    store.setConnectionDefaults({ arrow: 'large' })
    const edges = [{ id: 'e', data: { couplings: [] } }, { id: 'f' }]

    expect(store.withConnectionDefaults(edges)).toEqual([
      { id: 'e', data: { couplings: [], appearance: { arrow: 'large' } } },
      { id: 'f', data: { appearance: { arrow: 'large' } } },
    ])
    expect(edges[0].data).toEqual({ couplings: [] })
  })
})
