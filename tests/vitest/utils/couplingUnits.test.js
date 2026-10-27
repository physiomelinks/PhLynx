import { describe, expect, it } from 'vitest'

import { couplingUnitConflicts } from '../../../src/utils/couplingUnits.js'
import { mergeUnitDefinitions } from '../../../src/utils/units.js'

const UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="mm"><unit prefix="milli" units="metre"/></units>
  <units name="fmol"><unit prefix="femto" units="mole"/></units>
  <units name="m_per_m"><unit units="metre"/><unit units="metre" exponent="-1"/></units>
  <units name="cell"><!-- a base unit of its own --></units>
  <units name="beat" base_units="yes"/>
</model>`
const definitions = mergeUnitDefinitions([UNITS])

const port = (variables, multiportType = 'None') => ({ label: 'p', variables, multiportType })
const rows = (units) => [{ name: 'x', units }]

/** The conflicts of a one-variable coupling, x in sourceUnits to x in targetUnits. */
const conflicts = (sourceUnits, targetUnits, multiportTypes = ['None', 'None']) =>
  couplingUnitConflicts(port(['x'], multiportTypes[0]), port(['x'], multiportTypes[1]), rows(sourceUnits), rows(targetUnits), definitions)

describe('couplingUnitConflicts', () => {
  it('flags units of different dimensions', () => {
    expect(conflicts('second', 'metre')).toEqual(['"x" (second) and "x" (metre) have incompatible units.'])
  })

  it.each([
    ['mm', 'metre'],
    ['fmol', 'mole'],
    ['celsius', 'kelvin'],
    ['m_per_m', 'dimensionless'],
  ])('leaves %s and %s, which differ only in scale, alone', (a, b) => {
    expect(conflicts(a, b)).toEqual([])
  })

  it('flags an affine unit coupled to another dimension', () => {
    expect(conflicts('celsius', 'second')).toHaveLength(1)
  })

  it('flags a base unit a file declares coupled to an SI one', () => {
    expect(conflicts('beat', 'metre')).toHaveLength(1)
    expect(conflicts('cell', 'metre')).toHaveLength(1)
  })

  it('skips units it can’t resolve, empty units and variables without a row', () => {
    expect(conflicts('unknown_units', 'metre')).toEqual([])
    expect(conflicts('', 'metre')).toEqual([])
    expect(couplingUnitConflicts(port(['x']), port(['y']), rows('second'), rows('metre'), definitions)).toEqual([])
  })

  it.each([
    ['Sum', 'Multiply'],
    ['Sum', 'True'],
    ['Multiply', 'True'],
  ])('checks a %s variable paired with a %s one', (a, b) => {
    expect(conflicts('second', 'metre', [a, b])).toHaveLength(1)
  })

  it('pairs variables by position, reading { name } entries', () => {
    const source = port([{ name: 'a' }, { name: 'b' }])
    const target = port(['c', 'd'])
    const sourceRows = [{ name: 'a', units: 'metre' }, { name: 'b', units: 'second' }]
    const targetRows = [{ name: 'c', units: 'mm' }, { name: 'd', units: 'metre' }]
    expect(couplingUnitConflicts(source, target, sourceRows, targetRows, definitions)).toEqual([
      '"b" (second) and "d" (metre) have incompatible units.',
    ])
  })
})
