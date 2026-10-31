import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useSuggestionStore } from '../../../src/stores/suggestionStore.js'

describe('suggestionStore', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useSuggestionStore()
  })

  it('holds the derived suggestions and conflicts', () => {
    store.setSuggestions([{ key: 'a->b' }, { key: 'b->c' }], [{ key: 'cyto:x' }])
    expect(store.count).toBe(2)
    expect(store.conflicts).toEqual([{ key: 'cyto:x' }])
  })

  it('hides suggestions by key, before the next recompute', () => {
    store.setSuggestions([{ key: 'a->b' }, { key: 'b->c' }])
    store.remove(['a->b'])
    expect(store.suggestions.map((s) => s.key)).toEqual(['b->c'])
  })

  it('has no state to save: nothing but derived suggestions', () => {
    store.setSuggestions([{ key: 'a->b' }], [{ key: 'x' }])
    store.resetState()
    expect(store.suggestions).toEqual([])
    expect(store.conflicts).toEqual([])
    expect(store.getState).toBeUndefined()
  })
})
