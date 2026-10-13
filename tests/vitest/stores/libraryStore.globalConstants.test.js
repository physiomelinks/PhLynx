// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'

const node = (...names) => ({ data: { variables: names.map((name) => ({ name })) } })

describe('libraryStore global constants', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.assignGlobalConstant('k', 1, 'second', null)
    store.assignGlobalConstant('m', 2, 'metre', 'ref_m')
    store.assignGlobalConstant('z', 3, 'kg', null)
  })

  describe('assignGlobalConstant', () => {
    it('does not overwrite an existing constant by default', () => {
      store.assignGlobalConstant('k', 99, 'other', null)
      expect(store.getGlobalConstant('k')).toEqual({ value: 1, units: 'second', data_reference: null })
    })

    it('overwrites an existing constant when overwrite is true', () => {
      store.assignGlobalConstant('k', 99, 'other', 'r', true)
      expect(store.getGlobalConstant('k')).toEqual({ value: 99, units: 'other', data_reference: 'r' })
    })
  })

  describe('cleanupUnusedGlobalConstants', () => {
    it('removes constants that no remaining node references and returns them', () => {
      const removed = store.cleanupUnusedGlobalConstants([node('k', 'other')])
      expect(removed).toHaveLength(2)
      expect(removed).toEqual(expect.arrayContaining([
        { name: 'm', value: 2, units: 'metre', data_reference: 'ref_m' },
        { name: 'z', value: 3, units: 'kg', data_reference: null },
      ]))
      expect(store.getGlobalConstant('m')).toBeUndefined()
      expect(store.getGlobalConstant('z')).toBeUndefined()
    })

    it('keeps constants referenced by any remaining node', () => {
      store.cleanupUnusedGlobalConstants([node('k'), node('m')])
      expect(store.getGlobalConstant('k')).toBeDefined()
      expect(store.getGlobalConstant('m')).toBeDefined()
      expect(store.getGlobalConstant('z')).toBeUndefined()
    })

    it('trims variable names before matching', () => {
      const removed = store.cleanupUnusedGlobalConstants([node('  k ', 'm', 'z')])
      expect(removed).toEqual([])
      expect(store.globalVariables.size).toBe(3)
    })

    it('ignores nodes without variables or with unnamed variables', () => {
      const nodes = [{ data: {} }, {}, { data: { variables: [{ name: '' }, {}] } }, node('k')]
      const removed = store.cleanupUnusedGlobalConstants(nodes)
      expect(removed.map((c) => c.name).sort()).toEqual(['m', 'z'])
      expect(store.getGlobalConstant('k')).toBeDefined()
    })

    it('cleans every constant when no nodes remain', () => {
      const removed = store.cleanupUnusedGlobalConstants([])
      expect(removed.map((c) => c.name).sort()).toEqual(['k', 'm', 'z'])
      expect(store.globalVariables.size).toBe(0)
    })

    it('returns an empty list when there are no constants', () => {
      store.resetGlobalConstants()
      expect(store.cleanupUnusedGlobalConstants([node('k')])).toEqual([])
    })

    it('is idempotent: a second cleanup removes nothing more', () => {
      const nodes = [node('k')]
      expect(store.cleanupUnusedGlobalConstants(nodes)).toHaveLength(2)
      expect(store.cleanupUnusedGlobalConstants(nodes)).toEqual([])
      expect([...store.globalVariables.keys()]).toEqual(['k'])
    })

    it('lets removed constants be restored with assignGlobalConstant', () => {
      const removed = store.cleanupUnusedGlobalConstants([])
      removed.forEach((c) => store.assignGlobalConstant(c.name, c.value, c.units, c.data_reference))
      expect(store.getGlobalConstant('m')).toEqual({ value: 2, units: 'metre', data_reference: 'ref_m' })
    })
  })
})
