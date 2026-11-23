import { describe, expect, it } from 'vitest'

import { isReload, swapLastTabId } from '../../../../src/services/recovery/tabSession.js'

/** A sessionStorage stand-in. */
function memoryStorage() {
  const items = new Map()
  return { getItem: (key) => items.get(key) ?? null, setItem: (key, value) => void items.set(key, String(value)) }
}

const navigation = (type) => ({ getEntriesByType: () => [{ type }] })

describe('tabSession', () => {
  it('notes each page’s id, handing back the one the page before it noted', () => {
    const storage = memoryStorage()
    expect(swapLastTabId('first', storage)).toBeNull()
    expect(swapLastTabId('second', storage)).toBe('first')
  })

  it('has no last id when sessionStorage cannot be used', () => {
    const storage = {
      getItem: () => {
        throw new Error('Blocked.')
      },
    }
    expect(swapLastTabId('first', storage)).toBeNull()
  })

  it('tells a reload from other loads', () => {
    expect(isReload(navigation('reload'))).toBe(true)
    expect(isReload(navigation('navigate'))).toBe(false)
    expect(isReload(navigation('back_forward'))).toBe(false)
    expect(isReload({ getEntriesByType: () => [] })).toBe(false)
    expect(isReload(undefined)).toBe(false)
  })
})
