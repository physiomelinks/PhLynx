import { describe, expect, it } from 'vitest'

import { CHEBI, GO, OPB } from '../../../../src/services/annotations/iris.js'
import {
  derivativeTerms,
  findNameSpecies,
  learnSpeciesTokens,
  splitVariableName,
  suggestAnnotations,
} from '../../../../src/services/annotations/suggest.js'
import { propertiesForUnits } from '../../../../src/services/annotations/propertyUnits.js'

const part = (units, prefix = 0, exponent = 1) => ({ units, prefix, exponent, multiplier: 1 })
// Synthetic units, as a library defines them.
const DEFINITIONS = new Map([
  ['mM', [part('mole', -3), part('litre', 0, -1)]],
  ['fmol', [part('mole', -15)]],
  ['fmol_per_s', [part('mole', -15), part('second', 0, -1)]],
  ['pA', [part('ampere', -12)]],
  ['mV', [part('volt', -3)]],
  ['pL', [part('litre', -12)]],
  ['um2', [part('metre', -6, 2)]],
  ['per_s', [part('second', 0, -1)]],
])

const rows = (spec) => Object.entries(spec).map(([name, units]) => ({ name, units }))
const suggest = (input) => suggestAnnotations({ unitDefinitions: DEFINITIONS, ...input })
const entryOf = (result, name) => result.variables.get(name)?.entry

describe('propertiesForUnits', () => {
  it('lists every property units suit, and none for unknown units', () => {
    expect(propertiesForUnits('mM', DEFINITIONS)).toEqual([OPB.concentration])
    expect(propertiesForUnits('fmol_per_s', DEFINITIONS)).toEqual([OPB.molarFlowRate, OPB.amountDensityFlowRate])
    expect(propertiesForUnits('widgets', DEFINITIONS)).toEqual([])
    expect(propertiesForUnits('per_s', DEFINITIONS)).toEqual([])
  })
})

describe('reading names', () => {
  it('splits a name into the property prefix, its middle and the side suffix', () => {
    expect(splitVariableName('c_Na_i')).toEqual({ prefix: 'c', middle: ['Na'], suffix: 'i' })
    expect(splitVariableName('v_glc_o')).toEqual({ prefix: 'v', middle: ['glc'], suffix: 'o' })
    expect(splitVariableName('area')).toEqual({ prefix: null, middle: ['area'], suffix: null })
  })

  it('finds symbols by case and longer names in any case, and learns tokens from side-cars', () => {
    expect(findNameSpecies(['Na']).map((s) => s.curie)).toEqual([CHEBI.sodium])
    expect(findNameSpecies(['k'])).toEqual([])
    expect(findNameSpecies(['NaK']).map((s) => s.curie)).toEqual([CHEBI.sodium, CHEBI.potassium])
    expect(findNameSpecies(['Glucose']).map((s) => s.curie)).toEqual([CHEBI.glucose])
    const learned = learnSpeciesTokens([{ variables: [{ variable: 'c_A', species: ['CHEBI:1'] }] }])
    expect(findNameSpecies(['A'], learned)).toEqual([{ curie: 'CHEBI:1', token: 'A', isLearned: true }])
  })
})

describe('derivativeTerms', () => {
  it('signs each term of a derivative', () => {
    const cellml = `<model xmlns="http://www.cellml.org/cellml/2.0#"><component name="cell">
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>c_Na</ci></apply>
          <apply><divide/><apply><minus/><ci>v_in</ci><ci>v_out</ci></apply><ci>W</ci></apply></apply>
        <apply><eq/><ci>x</ci><ci>v_in</ci></apply>
      </math></component></model>`
    expect(derivativeTerms(cellml)).toEqual(new Map([['c_Na', new Map([['v_in', 1], ['v_out', -1]])]]))
    expect(derivativeTerms('')).toEqual(new Map())
  })
})

describe('suggestAnnotations', () => {
  it('suggests a transporter’s kind, sides and sources from its units and names', () => {
    const result = suggest({
      rows: rows({ c_Na_i: 'mM', c_Na_o: 'mM', v_Na_i: 'fmol_per_s', v_Na_o: 'fmol_per_s', I_Na: 'pA', u: 'mV' }),
      componentName: 'SGLT1',
    })
    expect(result.componentKind).toMatchObject({ kind: 'transporter' })
    expect(entryOf(result, 'c_Na_o')).toEqual({ property: OPB.concentration, species: [CHEBI.sodium], location: GO.extracellularRegion, from: null })
    expect(entryOf(result, 'v_Na_i')).toEqual({
      property: OPB.molarFlowRate,
      species: [CHEBI.sodium],
      location: GO.cytoplasm,
      from: GO.extracellularRegion,
    })
    // The current of one ion takes the sides of that ion's flow.
    expect(entryOf(result, 'I_Na')).toEqual({
      property: OPB.chargeFlowRate,
      species: [CHEBI.sodium],
      location: GO.cytoplasm,
      from: GO.extracellularRegion,
    })
    expect(result.variables.get('I_Na').basis).toEqual(expect.arrayContaining(['units', 'name', 'topology']))
    expect(entryOf(result, 'u')).toMatchObject({ property: OPB.electricalPotential, location: GO.plasmaMembrane })
  })

  it('reads a current written in amount units by its name, and a net current as the membrane’s', () => {
    const result = suggest({ rows: rows({ i_tot: 'fmol_per_s', u: 'mV' }), componentName: 'wall' })
    expect(result.componentKind).toMatchObject({ kind: 'membrane' })
    expect(entryOf(result, 'i_tot')).toEqual({ property: OPB.chargeFlowRate, species: [], location: 'self', from: null })
    expect(entryOf(result, 'u')).toMatchObject({ location: 'self' })
  })

  it('follows a compartment’s derivative: flows added come in, flows taken away leave', () => {
    const cellml = `<model xmlns="http://www.cellml.org/cellml/2.0#"><component name="cytosol">
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>c_Na</ci></apply>
          <apply><divide/><apply><minus/><ci>v_in</ci><ci>v_out</ci></apply><ci>W</ci></apply></apply>
      </math></component></model>`
    const result = suggest({
      rows: rows({ t: 's', c_Na: 'mM', v_in: 'fmol_per_s', v_out: 'fmol_per_s', W: 'pL', area: 'um2' }),
      kinds: new Map([['t', 'voi'], ['c_Na', 'state'], ['W', 'constant'], ['area', 'constant']]),
      cellml,
      componentName: 'cytosol',
    })
    expect(result.componentKind).toMatchObject({ kind: 'compartment' })
    expect(result.variables.has('t')).toBe(false)
    expect(entryOf(result, 'c_Na')).toMatchObject({ species: [CHEBI.sodium], location: 'self' })
    expect(entryOf(result, 'v_in')).toEqual({ property: OPB.molarFlowRate, species: [CHEBI.sodium], location: 'self', from: null })
    expect(entryOf(result, 'v_out')).toMatchObject({ species: [CHEBI.sodium], location: null })
    expect(entryOf(result, 'W')).toMatchObject({ property: OPB.fluidVolume, location: 'self' })
    expect(entryOf(result, 'area')).toMatchObject({ location: `self+${GO.plasmaMembrane}` })
  })

  it('keeps the module’s kind, leaves annotated variables and species parameters alone', () => {
    const result = suggest({
      rows: rows({ c_Na_i: 'mM', Km_Na: 'mM', c_K_init: 'mM', v_K_o: 'fmol_per_s' }),
      kinds: new Map([['Km_Na', 'constant']]),
      componentKind: 'transporter',
      annotated: new Set(['v_K_o']),
    })
    expect(result.componentKind).toBeNull()
    expect([...result.variables.keys()]).toEqual(['c_Na_i'])
  })

  it('suggests no place without a kind, and no property for units that fit none', () => {
    const result = suggest({ rows: rows({ c_Na_i: 'mM', k: 'per_s' }) })
    expect(entryOf(result, 'c_Na_i')).toEqual({ property: OPB.concentration, species: [CHEBI.sodium], location: null, from: null })
    expect(result.variables.has('k')).toBe(false)
  })
})
