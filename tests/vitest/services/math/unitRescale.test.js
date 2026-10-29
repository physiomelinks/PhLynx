// @vitest-environment happy-dom
// Rescaling values whose units regenerated math changed, e.g. a CellDL module switched between SI and Cellular.
import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  declaredUnits,
  findUnitRescales,
  formatFactor,
  isIdentityFactor,
  rescaleRows,
  rescaleValues,
  scaleValue,
  withInitialiserRescales,
  unitsFactor,
} from '../../../../src/services/math/unitRescale'
import { processCellMLData } from '../../../../src/utils/cellml'
import { mergeUnitDefinitions } from '../../../../src/utils/units'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

// The library's units, as stored (printed by libcellml), as both sides of a change see them.
let definitions
beforeAll(async () => {
  await ensureLibCellmlReady()
  const library = mergeUnitDefinitions(
    ['units', 'user_units'].map((file) => processCellMLData(fs.readFileSync(`src/assets/units/${file}.cellml`, 'utf8')).units.model)
  )
  definitions = { from: library, to: library }
})

const factorOf = (from, to) => unitsFactor(from, to, definitions)

describe('unitsFactor', () => {
  it('gives the factor between SI and Cellular units as an exact power of ten', () => {
    expect(factorOf('mole', 'fmol')).toEqual({ coefficient: 1, power: 15 })
    expect(factorOf('per_mol', 'per_fmol')).toEqual({ coefficient: 1, power: -15 })
    expect(factorOf('mol_per_s', 'fmol_per_s')).toEqual({ coefficient: 1, power: 15 })
    expect(factorOf('litre', 'pL')).toEqual({ coefficient: 1, power: 12 })
    expect(factorOf('L_per_mol', 'pL_per_fmol')).toEqual({ coefficient: 1, power: -3 })
    expect(factorOf('J_per_m3', 'fJ_per_pL')).toEqual({ coefficient: 1, power: 0 })
    expect(factorOf('fmol', 'mole')).toEqual({ coefficient: 1, power: -15 })
  })

  it('gives units that only differ in name a factor of one', () => {
    expect(isIdentityFactor(factorOf('J_per_mol', 'nJ_per_fmol'))).toBe(false)
    expect(factorOf('J_per_mol', 'nJ_per_fmol')).toEqual({ coefficient: 1, power: -6 })
    expect(isIdentityFactor(factorOf('mM', 'mmol_per_l'))).toBe(true)
  })

  it('keeps a factor that is not a power of ten', () => {
    const minutes = mergeUnitDefinitions(['<model><units name="min"><unit multiplier="60" units="second"/></units></model>'])
    const factor = unitsFactor('min', 'second', { from: minutes, to: minutes })
    expect(factor).toEqual({ coefficient: 60, power: 0 })
  })

  it('gives no factor for incompatible, affine or unknown units', () => {
    expect(factorOf('mole', 'pL')).toBeNull()
    expect(factorOf('celsius', 'kelvin')).toBeNull()
    expect(factorOf('nowhere', 'mole')).toBeNull()
  })

  it('resolves each side among its own units', () => {
    const before = mergeUnitDefinitions(['<model><units name="amount"><unit units="mole"/></units></model>'])
    const after = mergeUnitDefinitions(['<model><units name="amount"><unit prefix="femto" units="mole"/></units></model>'])
    expect(unitsFactor('amount', 'amount', { from: before, to: after })).toEqual({ coefficient: 1, power: 15 })
  })
})

describe('scaleValue', () => {
  it('shifts the decimal exponent, so a power of ten is exact', () => {
    expect(scaleValue('5e-15', { coefficient: 1, power: 15 })).toBe('5')
    expect(scaleValue('0.3', { coefficient: 1, power: -15 })).toBe('3e-16')
    expect(scaleValue('1.1e-15', { coefficient: 1, power: 15 })).toBe('1.1')
    expect(scaleValue('2', { coefficient: 1, power: 15 })).toBe('2000000000000000')
    expect(scaleValue(-7, { coefficient: 1, power: 3 })).toBe('-7000')
  })

  it('multiplies by a coefficient', () => {
    expect(scaleValue('2', { coefficient: 60, power: 0 })).toBe('120')
    expect(scaleValue('0.1', { coefficient: 3, power: 0 })).toBe('0.3')
  })

  it('keeps zero as written, and gives nothing for what is not a number', () => {
    expect(scaleValue('0', { coefficient: 1, power: 15 })).toBe('0')
    expect(scaleValue('', { coefficient: 1, power: 15 })).toBeNull()
    expect(scaleValue('k0', { coefficient: 1, power: 15 })).toBeNull()
    expect(scaleValue(undefined, { coefficient: 1, power: 15 })).toBeNull()
  })
})

describe('formatFactor', () => {
  it('writes large powers of ten as powers, and others as numbers', () => {
    expect(formatFactor({ coefficient: 1, power: 15 })).toBe('×10¹⁵')
    expect(formatFactor({ coefficient: 1, power: -15 })).toBe('×10⁻¹⁵')
    expect(formatFactor({ coefficient: 1, power: 3 })).toBe('×1000')
    expect(formatFactor({ coefficient: 60, power: 0 })).toBe('×60')
    expect(formatFactor({ coefficient: 60, power: -15 })).toBe('×60×10⁻¹⁵')
  })
})

describe('findUnitRescales', () => {
  it('lists the variables whose units changed to compatible ones', () => {
    const from = new Map([['q_A', 'mole'], ['K_A', 'per_mol'], ['u_A', 'J_per_mol'], ['t', 'second'], ['gone', 'mole'], ['odd', 'mole']])
    const to = new Map([['q_A', 'fmol'], ['K_A', 'per_fmol'], ['u_A', 'J_per_mol'], ['t', 'second'], ['new', 'fmol'], ['odd', 'pL']])
    expect(findUnitRescales(from, to, definitions)).toEqual([
      { name: 'q_A', from: 'mole', to: 'fmol', factor: { coefficient: 1, power: 15 } },
      { name: 'K_A', from: 'per_mol', to: 'per_fmol', factor: { coefficient: 1, power: -15 } },
    ])
  })
})

describe('declaredUnits', () => {
  it("keys each declared variable's units by its name after renames", () => {
    const analysis = { declared: [{ name: 'k', units: 'per_mol' }, { name: 'q', units: 'mole' }] }
    expect(declaredUnits(analysis, new Map([['k', 'kr']]))).toEqual(new Map([['kr', 'per_mol'], ['q', 'mole']]))
    expect(declaredUnits(null)).toEqual(new Map())
  })
})

describe('rescaleRows and rescaleValues', () => {
  const RESCALES = [
    { name: 'q_A', from: 'mole', to: 'fmol', factor: { coefficient: 1, power: 15 } },
    { name: 'K_A', from: 'per_mol', to: 'per_fmol', factor: { coefficient: 1, power: -15 } },
  ]

  it('rescales rows still in the old units, and gives their units the new ones', () => {
    const rows = [
      { name: 'q_A', value: '5e-15', units: 'mole' },
      { name: 'K_A', value: '', units: 'per_mol' },
      { name: 'other', value: '1', units: 'mole' },
    ]
    expect(rescaleRows(rows, RESCALES)).toEqual([
      { name: 'q_A', value: '5', units: 'fmol' },
      { name: 'K_A', value: '', units: 'per_fmol' },
      { name: 'other', value: '1', units: 'mole' },
    ])
    expect(rows[0].value).toBe('5e-15')
  })

  it('leaves rows in other units alone', () => {
    const rows = [{ name: 'q_A', value: '5', units: 'fmol' }]
    expect(rescaleRows(rows, RESCALES)).toEqual(rows)
  })

  it('rescales values by name, under their old names when renamed', () => {
    const values = new Map([['q_A', '2'], ['K_old', '1e15'], ['x', 'y0']])
    expect(rescaleValues(values, RESCALES, new Map([['K_old', 'K_A']]))).toEqual(
      new Map([['q_A', '2000000000000000'], ['K_old', '1'], ['x', 'y0']])
    )
  })
})

describe('withInitialiserRescales', () => {
  it("rescales a state's initialiser row with it, as it takes the state's units", () => {
    const q = { name: 'q_A', from: 'fmol', to: 'mole', factor: { coefficient: 1, power: -15 } }
    const rows = [
      { name: 'q_A', units: 'fmol', initialiser: 'q_A_init' },
      { name: 'q_A_init', value: '5e15', units: 'fmol' },
    ]
    const rescales = withInitialiserRescales([q], rows)
    expect(rescales).toEqual([q, { ...q, name: 'q_A_init' }])
    expect(rescaleRows(rows, rescales)[1]).toEqual({ name: 'q_A_init', value: '5', units: 'mole' })
    expect(withInitialiserRescales([q], [{ name: 'q_A', units: 'fmol' }])).toEqual([q])
  })
})
