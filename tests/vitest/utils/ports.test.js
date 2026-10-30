import { beforeAll, describe, expect, it } from 'vitest'
import { canCouple } from '../../../src/utils/ports.js'
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
    const cell = toy.node('cell')
    const porterIn = toy.node('porter_in')
    const context = toy.context()
    expect(canCouple(toy.port('cell', 'c_A'), cell, labelled(''), porterIn, context)).toBe(false)
    expect(canCouple(labelled('c_A'), cell, toy.port('porter_in', 'c_A_i'), porterIn, context)).toBe(false)
  })

  it('couples annotated ports by their annotations, and blocks a mismatch', () => {
    const cell = toy.node('cell')
    const porterIn = toy.node('porter_in')
    const context = toy.context()
    expect(canCouple(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_i'), porterIn, context)).toBe(true)
    expect(canCouple(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_o'), porterIn, context)).toBe(false)
    // Without a context nothing is located.
    expect(canCouple(toy.port('cell', 'c_A'), cell, toy.port('porter_in', 'c_A_i'), porterIn)).toBe(false)
  })
})
