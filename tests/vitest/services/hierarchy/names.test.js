import { describe, expect, it } from 'vitest'

import { expandHierarchy } from '../../../../src/services/hierarchy/expand.js'
import {
  flatNameOfNames,
  flatNameOfPath,
  pathOfNames,
  resolveName,
  splitFlat,
  toPath,
} from '../../../../src/services/hierarchy/names.js'
import { localNameProblem } from '../../../../src/utils/hierarchy.js'
import { exposed, exposures, module, superInstance, supermodule } from '../../fixtures/hierarchy/graph.js'

describe('flat names and paths', () => {
  it('joins levels with "__" in flat names and "/" in paths', () => {
    expect(flatNameOfNames(['heart', 'ra'])).toBe('heart__ra')
    expect(flatNameOfPath('neuron/soma/membrane')).toBe('neuron__soma__membrane')
    expect(pathOfNames(['heart', 'ra'])).toBe('heart/ra')
  })

  it('leaves a root name as it is', () => {
    expect(flatNameOfPath('heart_ra')).toBe('heart_ra')
    expect(splitFlat('heart_ra')).toBe('heart_ra')
  })

  it('splits a prefixed flat name back into its path', () => {
    for (const path of ['heart/ra', 'a/b_c', 'a_b/c', 'neuron/soma/membrane', 'x1/y2/z3/w4', 'solo']) {
      expect(splitFlat(flatNameOfPath(path))).toBe(path)
    }
  })

  it('keeps names that differ only in where an underscore is apart', () => {
    expect(flatNameOfPath('a/b_c')).toBe('a__b_c')
    expect(flatNameOfPath('a_b/c')).toBe('a_b__c')
  })
})

describe('local name rules', () => {
  it('rejects separators and edge underscores inside super-modules', () => {
    for (const name of ['a/b', 'a~b', 'a::b', 'a@b', 'a__b', '_a', 'a_', '']) {
      expect(localNameProblem(name, { scope: 'sm_1' })).toBeTruthy()
    }
    expect(localNameProblem('a_b', { scope: 'sm_1' })).toBeNull()
  })

  it('holds super instance names to them too, as they prefix flat names', () => {
    expect(localNameProblem('heart_', { superInstance: true })).toMatch(/starts or ends with "_"/)
    expect(localNameProblem('heart', { superInstance: true })).toBeNull()
  })

  it('leaves root module names to today’s rules', () => {
    expect(localNameProblem('a__b')).toBeNull()
    expect(localNameProblem('_a')).toBeNull()
  })

  it('makes every prefixed flat name of valid names split back', () => {
    const valid = ['a', 'a_b', 'b_c', 'x1', 'heart']
    for (const first of valid) {
      for (const second of valid) {
        expect(splitFlat(flatNameOfNames([first, second]))).toBe(`${first}/${second}`)
      }
    }
  })
})

describe('resolveName', () => {
  /** Root host and a super instance "cell" of "wrap" whose children are self and gate, under the given naming. */
  function graph(naming) {
    const self = module('self', 'self', { scope: 'sm_1', data: { originalName: 'fast_sodium_current' } })
    const gate = module('gate', 'm_gate', { scope: 'sm_1', data: { originalName: 'fast_sodium_current_m_gate' } })
    const sm = supermodule('sm_1', 'wrap', { submoduleOrder: ['self', 'gate'], naming })
    const exposure = exposures('sm_1', [exposed('xp', 'self', 'general_ports', 'V')])
    const cell = superInstance({ nodes: [sm, self, gate], edges: exposure }, 'dndnode_1', 'cell', 'sm_1')
    return expandHierarchy([module('dndnode_0', 'membrane'), cell, sm, self, gate], exposure)
  }

  it('finds a prefixed module by its flat name or its path', () => {
    const expansion = graph('prefixed')
    expect(resolveName('cell__m_gate', expansion)).toEqual({ id: 'dndnode_1/gate', path: 'cell/m_gate' })
    expect(resolveName('cell/m_gate', expansion)).toEqual({ id: 'dndnode_1/gate', path: 'cell/m_gate' })
    expect(toPath('cell__m_gate', expansion)).toBe('cell/m_gate')
    expect(resolveName('membrane', expansion)).toEqual({ id: 'dndnode_0', path: 'membrane' })
    expect(resolveName('nobody', expansion)).toBeNull()
  })

  it('finds a preserved module through the expansion, as its flat name holds no path', () => {
    const expansion = graph('preserve')
    expect(expansion.nameOf('dndnode_1/gate')).toBe('fast_sodium_current_m_gate')
    expect(resolveName('fast_sodium_current_m_gate', expansion)).toEqual({ id: 'dndnode_1/gate', path: 'cell/m_gate' })
    expect(toPath('fast_sodium_current', expansion)).toBe('cell/self')
    // Splitting it would be wrong.
    expect(splitFlat('fast_sodium_current_m_gate')).not.toBe('cell/m_gate')
  })

  it('splits every prefixed flat name of an expansion back into its path', () => {
    const cap = module('cap', 'cap_x', { scope: 'sm_2' })
    const inner = supermodule('sm_2', 'bed_sm', { submoduleOrder: ['cap'] })
    const bed = superInstance([inner, cap], 'bed', 'bed_1', 'sm_2', { scope: 'sm_1' })
    const art = module('art', 'art_a', { scope: 'sm_1' })
    const outer = supermodule('sm_1', 'limb', { submoduleOrder: ['art', 'bed'] })
    const leg = superInstance([outer, art, bed, inner, cap], 'dndnode_1', 'leg_l', 'sm_1')
    const expansions = [expandHierarchy([module('dndnode_0', 'a_b'), leg, outer, art, bed, inner, cap], []), graph('prefixed')]
    for (const expansion of expansions) {
      const nested = expansion.nodes.map((node) => node.id).filter((id) => id.includes('/'))
      expect(nested.length).toBeGreaterThan(1)
      for (const id of nested) expect(splitFlat(expansion.nameOf(id))).toBe(expansion.pathOf(id))
    }
    expect(expansions[0].pathOf('dndnode_1/bed/cap')).toBe('leg_l/bed_1/cap_x')
  })

  it('gives a prefixed self leaf its super instance\'s flat name, its path still its own', () => {
    const self = module('self', 'self', { scope: 'sm_1', data: { originalName: 'fast_sodium_current', role: 'self' } })
    const gate = module('gate', 'm_gate', { scope: 'sm_1' })
    const sm = supermodule('sm_1', 'wrap', { submoduleOrder: ['self', 'gate'] })
    const cell = superInstance([sm, self, gate], 'cell_1', 'cell', 'sm_1', { scope: 'sm_2' })
    const outer = supermodule('sm_2', 'tissue', { submoduleOrder: ['cell_1'] })
    const graph = [superInstance([outer, cell, sm, self, gate], 'dndnode_1', 'heart', 'sm_2'), outer, cell, sm, self, gate]
    const expansion = expandHierarchy(graph, [])
    const id = 'dndnode_1/cell_1/self'
    expect(expansion.nameOf(id)).toBe('heart__cell')
    expect(expansion.pathOf(id)).toBe('heart/cell/self')
    expect(expansion.nameOf('dndnode_1/cell_1/gate')).toBe('heart__cell__m_gate')
    for (const name of ['heart__cell', 'heart/cell/self']) expect(resolveName(name, expansion)).toEqual({ id, path: 'heart/cell/self' })
    expect(toPath('heart__cell', expansion)).toBe('heart/cell/self')
    expect(expansion.errors.filter((error) => error.kind === 'flatNameClash')).toEqual([])

    // A root module named so still clashes with it.
    const clashing = expandHierarchy([...graph, module('dndnode_2', 'heart__cell')], [])
    const clash = clashing.errors.filter((error) => error.kind === 'flatNameClash')
    expect(clash.map((error) => error.ids.sort())).toEqual([[id, 'dndnode_2'].sort()])
    expect(clash[0].message).toContain('"heart/cell/self"')
  })

  it('reads a path as a path', () => {
    expect(toPath('heart/ra')).toBe('heart/ra')
    expect(toPath('heart__ra')).toBe('heart/ra')
  })
})
