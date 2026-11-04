import { describe, expect, it } from 'vitest'

import { propertyUnitsProblem } from '../../../../src/services/annotations/propertyUnits.js'

const part = (units, prefix = 0, exponent = 1) => ({ units, prefix, exponent, multiplier: 1 })
// Synthetic units, as a library defines them.
const DEFINITIONS = new Map([
  ['mM', [part('mole', -3), part('litre', 0, -1)]],
  ['fmol', [part('mole', -15)]],
  ['fmol_per_s', [part('mole', -15), part('second', 0, -1)]],
  ['fmol_per_um2_s', [part('mole', -15), part('metre', -6, -2), part('second', 0, -1)]],
  ['pA', [part('ampere', -12)]],
  ['uA_per_cm2', [part('ampere', -6), part('metre', -2, -2)]],
  ['mV', [part('volt', -3)]],
  ['J_per_C', [part('joule'), part('coulomb', 0, -1)]],
  ['pL', [part('litre', -12)]],
  ['um2', [part('metre', -6, 2)]],
  ['widgets', []],
])
const check = (property, units) => propertyUnitsProblem(property, units, DEFINITIONS)

describe('propertyUnitsProblem', () => {
  it('accepts units with the dimensions of their property, whatever their scale', () => {
    expect(check('OPB:00340', 'mM')).toBeNull()
    expect(check('OPB:00425', 'fmol')).toBeNull()
    expect(check('OPB:00592', 'fmol_per_s')).toBeNull()
    expect(check('OPB:00592', 'fmol_per_um2_s')).toBeNull()
    expect(check('OPB:00318', 'pA')).toBeNull()
    expect(check('OPB:00318', 'uA_per_cm2')).toBeNull()
    expect(check('OPB:00506', 'mV')).toBeNull()
    expect(check('OPB:00506', 'J_per_C')).toBeNull()
    expect(check('OPB:00154', 'pL')).toBeNull()
    expect(check('OPB:00295', 'um2')).toBeNull()
  })

  it('names what the units are not', () => {
    expect(check('OPB:00340', 'fmol')).toBe('fmol isn’t a concentration')
    expect(check('OPB:00592', 'mM')).toBe('mM isn’t a molar flow rate')
    expect(check('OPB:00425', 'mM')).toBe('mM isn’t an amount')
    expect(check('OPB:00318', 'mV')).toBe('mV isn’t a charge flow rate')
    expect(check('OPB:00154', 'um2')).toBe('um2 isn’t a volume')
    expect(check('OPB:00295', 'pL')).toBe('pL isn’t an area')
    expect(check('OPB:00506', 'pA')).toBe('pA isn’t an electrical potential')
    expect(check('OPB:00340', 'widgets')).toBe('widgets isn’t a concentration')
  })

  it('takes a flow per area or not under the one flow property, and under the older density flow rate', () => {
    expect(check('OPB:00593', 'fmol_per_s')).toBeNull()
    expect(check('OPB:00593', 'fmol_per_um2_s')).toBeNull()
    expect(check('OPB:00593', 'mM')).toBe('mM isn’t a molar flow rate')
  })

  it('says nothing about an unknown property, missing units or units it cannot resolve', () => {
    expect(check('OPB:99999', 'fmol')).toBeNull()
    expect(check('OPB:00340', '')).toBeNull()
    expect(check('OPB:00340', null)).toBeNull()
    expect(check('OPB:00340', 'undefined_units')).toBeNull()
  })
})
