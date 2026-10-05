import { describe, expect, it } from 'vitest'
import { carryRenames, followPendingRename, renameCiInMathML } from '../../../../src/services/math/carryRenames'
import { reconcileRows } from '../../../../src/services/math/reconcileRows'

const analysis = (references, overrides = {}) => ({
  componentName: 'c',
  declared: [],
  referenced: [...new Set(references)],
  references,
  stateVariables: [],
  unresolved: [],
  assigned: [],
  voi: [],
  ...overrides,
})

const byName = (rows) => Object.fromEntries(rows.map((row) => [row.name, row]))

const V = { name: 'V', units: 'volt', value: '', type: 'variable', access: 'access', stateRole: 'state', initialiser: 'V_init' }
const V_INIT = { name: 'V_init', units: 'volt', value: '-0.08', type: 'constant', access: 'no_access' }
const K = { name: 'k', units: 'per_second', value: '2', type: 'constant', access: 'access' }

describe('carryRenames', () => {
  it('moves the row of a variable renamed everywhere', () => {
    const rows = [V, V_INIT, K]
    const { rows: carried, portRenames, partial } = carryRenames(
      analysis(['t', 'V', 'k', 'V']),
      analysis(['t', 'Vm', 'k', 'Vm']),
      rows
    )
    expect(byName(carried).Vm).toMatchObject({ units: 'volt', stateRole: 'state', initialiser: 'V_init' })
    expect(byName(carried).V).toBeUndefined()
    expect(portRenames).toEqual([{ from: 'V', to: 'Vm' }])
    expect(partial).toBeNull()
    expect(rows).toEqual([V, V_INIT, K]) // not mutated
  })

  it('keeps a renamed state on its initialiser rather than creating a new one', () => {
    const before = analysis(['t', 'V', 'k'], { stateVariables: ['V'], voi: ['t'] })
    const after = analysis(['t', 'Vm', 'k'], { stateVariables: ['Vm'], voi: ['t'] })
    const rows = byName(reconcileRows(after, carryRenames(before, after, [V, V_INIT, K]).rows))
    expect(rows.Vm).toMatchObject({ units: 'volt', stateRole: 'state', initialiser: 'V_init' })
    expect(rows.V_init.value).toBe('-0.08')
    expect(rows.Vm_init).toBeUndefined()
  })

  it('points states at a renamed initialiser', () => {
    const { rows } = carryRenames(analysis(['V', 'V_init']), analysis(['V', 'V0']), [V, V_INIT])
    expect(byName(rows).V.initialiser).toBe('V0')
    expect(byName(rows).V0.value).toBe('-0.08')
  })

  it('copies the row of a variable renamed in only some places, and reports it', () => {
    const { rows, portRenames, partial } = carryRenames(analysis(['k', 'x', 'k', 'k']), analysis(['rate', 'x', 'k', 'k']), [K])
    expect(byName(rows).rate).toMatchObject({ units: 'per_second', value: '2', type: 'constant' })
    expect(byName(rows).k).toBe(K)
    expect(portRenames).toEqual([])
    expect(partial).toEqual({ from: 'k', to: 'rate', uses: 2 })
  })

  it('leaves out the state fields of a copy', () => {
    const { rows } = carryRenames(analysis(['V', 'V']), analysis(['Vm', 'V']), [V])
    expect(byName(rows).Vm).not.toHaveProperty('stateRole')
    expect(byName(rows).Vm).not.toHaveProperty('initialiser')
  })

  it('leaves a name already in use with its own row', () => {
    const other = { name: 'j', units: 'metre', value: '1', type: 'constant', access: 'access' }
    const { rows, portRenames } = carryRenames(analysis(['k', 'j']), analysis(['j', 'j']), [K, other])
    expect(byName(rows).j).toBe(other)
    expect(portRenames).toEqual([])
  })

  it('renames ports once the offered rename has no uses left', () => {
    const copy = { ...K, name: 'rate' }
    const { portRenames } = carryRenames(analysis(['rate', 'k']), analysis(['rate', 'rate']), [K, copy], {
      pending: { from: 'k', to: 'rate', uses: 1 },
    })
    expect(portRenames).toEqual([{ from: 'k', to: 'rate' }])
  })

  it('gives the copy the state pairing once the offered rename has no uses left', () => {
    const copy = { name: 'Vm', units: 'volt', value: '', type: 'variable', access: 'access' }
    const { rows } = carryRenames(analysis(['V', 'Vm']), analysis(['Vm', 'Vm']), [V, V_INIT, copy], {
      pending: { from: 'V', to: 'Vm', uses: 1 },
    })
    expect(byName(rows).Vm).toMatchObject({ stateRole: 'state', initialiser: 'V_init' })
  })

  it('finds a rename made alongside other edits', () => {
    const { rows } = carryRenames(analysis(['x', 'k', 'y']), analysis(['x', 'rate', 'y', 'z']), [K])
    expect(byName(rows).rate).toMatchObject({ units: 'per_second', value: '2' })
  })

  it('changes nothing without reference sequences', () => {
    const rows = [K]
    expect(carryRenames(null, analysis(['k']), rows).rows).toBe(rows)
    expect(carryRenames({ referenced: ['k'] }, analysis(['rate']), rows).rows).toBe(rows)
  })
})

describe('followPendingRename', () => {
  const none = { renames: [], partial: null }

  it('offers a new partial rename', () => {
    const partial = { from: 'k', to: 'r', uses: 1 }
    expect(followPendingRename(null, { renames: [], partial }, analysis(['r', 'k']))).toEqual(partial)
  })

  it('follows the new name as it is typed', () => {
    const pending = { from: 'k', to: 'r', uses: 1 }
    const next = followPendingRename(pending, { renames: [{ from: 'r', to: 'ra' }], partial: null }, analysis(['ra', 'k']))
    expect(next).toEqual({ from: 'k', to: 'ra', uses: 1 })
  })

  it('updates the count of remaining uses', () => {
    const pending = { from: 'k', to: 'r', uses: 2 }
    expect(followPendingRename(pending, none, analysis(['r', 'k', 'r', 'k', 'k']))).toEqual({ from: 'k', to: 'r', uses: 3 })
  })

  it('drops the offer once either name has left the math', () => {
    const pending = { from: 'k', to: 'r', uses: 1 }
    expect(followPendingRename(pending, none, analysis(['r', 'r']))).toBeNull()
    expect(followPendingRename(pending, none, analysis(['k', 'k']))).toBeNull()
  })
})

describe('renameCiInMathML', () => {
  it('renames only <ci> elements naming the variable, keeping attributes', () => {
    const mathml =
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>k</ci><apply><times/><ci type="real"> k </ci><ci>k2</ci><cn>1</cn></apply></apply></math>'
    expect(renameCiInMathML(mathml, 'k', 'rate')).toBe(
      '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>rate</ci><apply><times/><ci type="real">rate</ci><ci>k2</ci><cn>1</cn></apply></apply></math>'
    )
  })

  it('treats the name literally', () => {
    expect(renameCiInMathML('<ci>a.b</ci><ci>axb</ci>', 'a.b', 'c')).toBe('<ci>c</ci><ci>axb</ci>')
  })
})
