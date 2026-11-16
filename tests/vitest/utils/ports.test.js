import { beforeAll, describe, expect, it } from 'vitest'
import { canCouple, canKeepCoupling } from '../../../src/utils/ports.js'
import { loadToyNodes } from '../services/annotations/toyNodes.js'

const labelled = (label, variables = ['x'], portType = 'general_ports') => ({ portType, label, variables })

describe('canCouple', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  it('couples unannotated ports by equal label and compatible type, as before', () => {
    const [a, b] = [{ id: 'a' }, { id: 'b' }]
    expect(canCouple(labelled('flow', ['x'], 'exit_ports'), a, labelled('flow', ['y'], 'entrance_ports'), b)).toBe(true)
    expect(canCouple(labelled('flow'), a, labelled('pressure'), b)).toBe(false)
    expect(canCouple(labelled(''), a, labelled(''), b)).toBe(false)
    expect(canCouple(labelled('flow', ['x'], 'entrance_ports'), a, labelled('flow', ['y'], 'exit_ports'), b)).toBe(
      false
    )
  })

  it('never couples an annotated port to an unannotated one', () => {
    const cell = toy.unplaced('cell')
    const porterIn = toy.unplaced('porter_in')
    const context = toy.context()
    expect(canCouple(toy.port('cell', 'c_A'), cell, labelled(''), porterIn, context)).toBe(false)
    expect(canCouple(labelled('c_A'), cell, toy.port('porter_in', 'c_A_i'), porterIn, context)).toBe(false)
  })

  it('does not couple annotated ports while their nodes have no place', () => {
    const context = toy.context()
    expect(canCouple(toy.port('cell', 'c_A'), toy.unplaced('cell'), toy.port('porter_in', 'c_A_i'), toy.unplaced('porter_in'), context)).toBe(false)
  })
})

describe('canKeepCoupling', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  it('keeps a coupling of unplaced nodes whose annotations still agree', () => {
    const context = toy.context()
    const [cell, porterIn] = [toy.unplaced('cell'), toy.unplaced('porter_in')]
    expect(canKeepCoupling(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_i'), porterIn, context)).toBe(true)
    // Outside, too: the places are not told apart until the nodes are placed.
    expect(canKeepCoupling(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_o'), porterIn, context)).toBe(true)
  })

  it('drops a coupling whose property or roles no longer agree', () => {
    const context = toy.context()
    const [cell, porterIn] = [toy.unplaced('cell'), toy.unplaced('porter_in')]
    expect(canKeepCoupling(toy.port('cell', 'volume'), cell, toy.port('porter_in', 'c_A_i'), porterIn, context)).toBe(false)
    const outside = toy.unplaced('outside')
    expect(canKeepCoupling(toy.port('cell', 'c_A'), cell, toy.port('outside', 'c_A'), outside, context)).toBe(false)
  })

  it('drops a coupling between an annotated and an unannotated port', () => {
    const context = toy.context()
    expect(canKeepCoupling(toy.port('cell', 'c_A'), toy.unplaced('cell'), labelled('c_A'), toy.unplaced('porter_in'), context)).toBe(false)
  })
})

describe('canCouple and canKeepCoupling between placed nodes', () => {
  let toy

  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  it('couples annotated ports only at one place', () => {
    const [cell, porterIn] = [toy.node('cell'), toy.node('porter_in')]
    const context = toy.context([cell, porterIn])
    expect(canCouple(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_i'), porterIn, context)).toBe(true)
    // The porter's outside is the apical fluid, not the cell.
    expect(canCouple(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_o'), porterIn, context)).toBe(false)
  })

  it('keeps a coupling only while its ports still meet at one place', () => {
    const [cell, porterIn] = [toy.node('cell'), toy.node('porter_in')]
    const context = toy.context([cell, porterIn])
    expect(canKeepCoupling(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_i'), porterIn, context)).toBe(true)
    expect(canKeepCoupling(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_o'), porterIn, context)).toBe(false)
  })
})
