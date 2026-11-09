import { describe, expect, it } from 'vitest'

import {
  instanceConfigSource,
  isOwnConfig,
  isSoleOwnConfig,
  newConfigRef,
  withoutOwner,
} from '../../../src/services/configOwnership.js'

const owned = { moduleRef: 'glut:a', source: instanceConfigSource('n1') }

describe('configOwnership', () => {
  it('marks a config as an instance’s own', () => {
    expect(isOwnConfig(owned, 'n1')).toBe(true)
    expect(isOwnConfig(owned, 'n2')).toBe(false)
    expect(isOwnConfig({ moduleRef: 'glut:base' }, 'n1')).toBe(false)
    expect(isOwnConfig({ moduleRef: 'glut:base', source: { kind: 'library', nodeId: 'n1' } }, 'n1')).toBe(false)
    expect(isOwnConfig(undefined, 'n1')).toBe(false)
  })

  it('updates silently only while its owner is its only user', () => {
    expect(isSoleOwnConfig(owned, 'n1', 0)).toBe(true)
    expect(isSoleOwnConfig(owned, 'n1', 1)).toBe(false)
    expect(isSoleOwnConfig(owned, 'n2', 0)).toBe(false)
    expect(isSoleOwnConfig({ moduleRef: 'glut:base' }, 'n1', 0)).toBe(false)
  })

  it('names a new config after the instance, within its module type, numbering past taken refs', () => {
    const taken = new Set(['glut:a', 'glut:a_2', 'other:b'])
    const isTaken = (ref) => taken.has(ref)
    expect(newConfigRef('glut:base', 'b', isTaken)).toBe('glut:b')
    expect(newConfigRef('glut:base', 'a', isTaken)).toBe('glut:a_3')
    expect(newConfigRef('glut:base', 'my instance', isTaken)).toBe('glut:my_instance')
  })

  it('drops only an instance owner from a module', () => {
    expect(withoutOwner(owned)).toEqual({ moduleRef: 'glut:a' })
    const library = { moduleRef: 'glut:base' }
    expect(withoutOwner(library)).toBe(library)
  })
})
