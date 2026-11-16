import { describe, expect, it } from 'vitest'

import {
  changedSetEntries,
  hasNewValues,
  hasSetEntries,
  isInstanceSet,
  isSharedSet,
  otherSetUsers,
  isOwnInstanceSet,
  setAsUsedBy,
  setEntriesFromVariables,
} from '../../../src/utils/parameters/instanceSet.js'
import { parametersJson } from '../../../src/utils/parameters/write.js'

const rows = [
  { name: ' pH ', type: 'constant', value: ' 6.8 ', units: 'dim', data_reference: 'phlynx' },
  { name: 'area', type: 'constant', value: null, units: 'mm2' },
  { name: 'F', type: 'global_constant', value: '96485', units: 'C_per_mol' },
  { name: 'c', type: 'variable', value: '3', units: 'mM' },
]
const instanceSet = {
  ref: 'compartment',
  source: { file: '', importedAt: '', kind: 'instance', nodeId: 'n1' },
  globals: new Map(),
  values: new Map([['pH', { value: '7.4', units: 'dim', data_reference: '', extra: {} }]]),
}

describe('setEntriesFromVariables', () => {
  it('takes every row holding a value, globals apart, blank as null', () => {
    const { globals, values } = setEntriesFromVariables(rows)
    expect([...values]).toEqual([
      ['pH', { value: '6.8', units: 'dim', data_reference: 'phlynx', extra: {} }],
      ['area', { value: null, units: 'mm2', data_reference: '', extra: {} }],
    ])
    expect([...globals.keys()]).toEqual(['F'])
  })
})

describe('instance sets', () => {
  it('tells a set an instance made, and which node made it', () => {
    expect(isInstanceSet(instanceSet)).toBe(true)
    expect(isInstanceSet({ source: { file: 'x.json' } })).toBe(false)
    expect(isInstanceSet(null)).toBe(false)
    expect(isOwnInstanceSet(instanceSet, 'n1')).toBe(true)
    expect(isOwnInstanceSet(instanceSet, 'n2')).toBe(false)
  })

  it("gives the making node's current values, and the stored set to any other node", () => {
    const own = setAsUsedBy(instanceSet, { id: 'n1', data: { variables: rows } })
    expect(own.ref).toBe('compartment')
    expect(own.values.get('pH').value).toBe('6.8')
    expect(JSON.parse(parametersJson(own)).area.value).toBe('EMPTY_MUST_BE_FILLED')
    expect(setAsUsedBy(instanceSet, { id: 'n2', data: { variables: rows } })).toBe(instanceSet)
  })
})

describe('shared sets', () => {
  const imported = { ...instanceSet, source: { file: 'enterocyte_parameters.json', importedAt: '' } }

  it("tells a set others share: an imported one, or another node's", () => {
    expect(isSharedSet(imported, 'n1')).toBe(true)
    expect(isSharedSet(instanceSet, 'n2')).toBe(true)
    expect(isSharedSet(instanceSet, 'n1')).toBe(false)
    expect(isSharedSet(null, 'n1')).toBe(false)
  })

  it("tells the node's own set shared once another node is tagged with it", () => {
    const other = { id: 'n2', data: { mathRef: 'm', parameterisation: 'compartment' } }
    expect(isSharedSet(instanceSet, 'n1', [])).toBe(false)
    expect(isSharedSet(instanceSet, 'n1', [other])).toBe(true)
    expect(isSharedSet(null, 'n1', [other])).toBe(false)
  })

  it("gives only the values a save changes that the set doesn't already hold", () => {
    const before = rows
    const after = [
      { ...rows[0], value: '7.4' }, // back to the set's value
      { ...rows[1], value: '2' }, // changed
      { ...rows[2], value: '96000' }, // a changed global
      { ...rows[3], value: '4' }, // a variable, which holds no value
      { name: 'new', type: 'constant', value: '1' }, // not on the node before
    ]
    const entries = changedSetEntries(imported, before, after)
    expect([...entries.values.keys()]).toEqual(['area'])
    expect([...entries.globals.keys()]).toEqual(['F'])
    expect(hasSetEntries(entries)).toBe(true)
    expect(hasSetEntries(changedSetEntries(imported, before, before))).toBe(false)
    // Blank and null alike.
    expect(hasSetEntries(changedSetEntries(imported, before, [{ ...rows[1], value: '' }]))).toBe(false)
  })

  it('lists the other nodes tagged with a set on its math', () => {
    const node = (id, mathRef, parameterisation) => ({ id, data: { mathRef, parameterisation } })
    const nodes = [node('a', 'm', 'x'), node('b', 'm', 'x'), node('c', 'other', 'x'), node('d', 'm', 'y')]
    expect(otherSetUsers(nodes, { nodeId: 'a', mathRef: 'm', paramRef: 'x' }).map((n) => n.id)).toEqual(['b'])
  })
})

describe('hasNewValues', () => {
  it('tells a save that gives a row a value: changed, or on a new row', () => {
    expect(hasNewValues(rows, rows.map((row) => (row.name === 'area' ? { ...row, value: '2' } : row)))).toBe(true)
    expect(hasNewValues(rows, [...rows, { name: 'k', type: 'constant', value: '1' }])).toBe(true)
    expect(hasNewValues(rows, rows.map((row) => (row.name === 'F' ? { ...row, value: '1' } : row)))).toBe(true)
  })

  it('ignores an unchanged value, one cleared, a row dropped or blank, and a row with no value cell', () => {
    expect(hasNewValues(rows, rows)).toBe(false)
    expect(hasNewValues(rows, rows.map((row) => (row.name.trim() === 'pH' ? { ...row, value: '' } : row)))).toBe(false)
    expect(hasNewValues(rows, [...rows.slice(1), { name: 'k', type: 'constant', value: ' ' }])).toBe(false)
    expect(hasNewValues(rows, rows.map((row) => (row.name === 'c' ? { ...row, value: '4' } : row)))).toBe(false)
  })
})
