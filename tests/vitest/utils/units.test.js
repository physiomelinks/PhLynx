// @vitest-environment happy-dom
import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

import { STANDARD_UNITS } from '../../../src/utils/constants'
import { processCellMLData } from '../../../src/utils/cellml'
import { expandUnits, extractUnitDefinitions, formatUnitExpansion } from '../../../src/utils/units'
import { unitSuggestions } from '../../../src/utils/units'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const NAMES = ['millivolt', 'millisecond', 'mV_per_ms', 'mV', 'mL_per_s', 'second', 'per_second']

describe('unitSuggestions', () => {
  it('puts an exact match first, then prefixes, then substrings, each shortest first', () => {
    expect(unitSuggestions('mv', NAMES)).toEqual(['mV', 'mV_per_ms'])
    expect(unitSuggestions('second', NAMES)).toEqual(['second', 'per_second', 'millisecond'])
  })

  it('finds names containing the typed text', () => {
    expect(unitSuggestions('per_s', NAMES)).toEqual(['per_second', 'mL_per_s'])
  })

  it('ignores case', () => {
    expect(unitSuggestions('MILLI', NAMES)).toEqual(['millivolt', 'millisecond'])
  })

  it('breaks length ties alphabetically', () => {
    expect(unitSuggestions('b', ['cb', 'ab', 'bb'])).toEqual(['bb', 'ab', 'cb'])
  })

  it('stops at the limit', () => {
    expect(unitSuggestions('m', NAMES, 2)).toHaveLength(2)
  })

  it('offers nothing for blank text or a name that is already complete', () => {
    expect(unitSuggestions('', NAMES)).toEqual([])
    expect(unitSuggestions('  ', NAMES)).toEqual([])
    expect(unitSuggestions('millivolt', NAMES)).toEqual([])
  })

  it('accepts a Set', () => {
    expect(unitSuggestions('volt', new Set(NAMES))).toEqual(['millivolt'])
  })
})

/** Wraps `<units>` definitions in a CellML 2.0 model, as libcellml prints them. */
const model = (units) => `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">${units}</model>`
const expand = (...units) => expandUnits(units.map(model))

describe('formatUnitExpansion', () => {
  const format = (coefficient, power, dimensions, affine = false) =>
    formatUnitExpansion({ coefficient, power, dimensions, affine })

  it('writes powers of ten and dimensions with superscripts, in SI order', () => {
    expect(format(1, -3, { A: -1, s: -3, m: 2, kg: 1 })).toBe('10⁻³ kg·m²·s⁻³·A⁻¹')
    expect(format(1, 3, { s: -1 })).toBe('10³ s⁻¹')
    expect(format(1, 0, { mol: 1, m: -3 })).toBe('m⁻³·mol')
  })

  it('writes other scales as decimals, or in scientific notation when large or small', () => {
    expect(format(133.32, 0, { kg: 1, m: -1, s: -2 })).toBe('133.32 kg·m⁻¹·s⁻²')
    expect(format(1 / 133.32, 0, { s: 1 })).toBe('0.00750075 s')
    expect(format(1.3332, 8, { s: 1 })).toBe('1.3332×10⁸ s')
  })

  it('treats rounding error as an exact power of ten', () => {
    expect(format(10.000000000000002, 0, {})).toBe('10¹')
    expect(format(9.9999996, 8, {})).toBe('10⁹')
  })

  it('writes a negative scale with a leading minus', () => {
    expect(format(-2, 0, { m: 1 })).toBe('-2 m')
  })

  it('writes fractional exponents plainly and drops cancelled ones', () => {
    expect(format(1, 0, { kg: -0.5, m: 0.5 - 0.5 + 3.5, s: -0 })).toBe('kg^-0.5·m^3.5')
  })

  it('names a dimensionless units, or just its scale', () => {
    expect(format(1, 0, {})).toBe('dimensionless')
    expect(format(1, -2, {})).toBe('10⁻²')
  })

  it('puts a file\'s own base units after the SI ones, apart from SI symbols of the same name', () => {
    expect(format(1, 0, { 'user:m': 1, m: 1, 'user:apple': 2 })).toBe('m·apple²·m')
  })

  it('marks affine units', () => {
    expect(format(1, 0, { K: 1 }, true)).toBe('K (affine)')
  })
})

describe('expandUnits', () => {
  it('expands nested definitions, with the prefix inside the exponent', () => {
    const expansions = expand(
      '<units name="per_millis"><unit units="millis" exponent="-1"/></units>',
      '<units name="millis"><unit prefix="milli" units="second"/></units>' +
        '<units name="mm2"><unit prefix="milli" units="metre" exponent="2"/></units>'
    )
    expect(expansions.get('millis')).toBe('10⁻³ s')
    expect(expansions.get('per_millis')).toBe('10³ s⁻¹')
    expect(expansions.get('mm2')).toBe('10⁻⁶ m²')
  })

  it('keeps the multiplier outside the exponent', () => {
    const expansions = expand(
      '<units name="mmHg"><unit multiplier="133.32" units="pascal"/></units>' +
        '<units name="mmHg2"><unit units="mmHg" exponent="2"/></units>' +
        '<units name="per_mmHg"><unit units="mmHg" exponent="-1"/></units>' +
        '<units name="k_m2"><unit multiplier="1000" units="metre" exponent="2"/></units>'
    )
    expect(expansions.get('mmHg')).toBe('133.32 kg·m⁻¹·s⁻²')
    expect(expansions.get('mmHg2')).toBe('17774.2 kg²·m⁻²·s⁻⁴')
    expect(expansions.get('per_mmHg')).toBe('0.00750075 kg⁻¹·m·s²')
    expect(expansions.get('k_m2')).toBe('10³ m²')
  })

  it('cancels prefixes exactly', () => {
    const expansions = expand(
      '<units name="mmol_per_l"><unit prefix="milli" units="mole"/><unit units="litre" exponent="-1"/></units>'
    )
    expect(expansions.get('mmol_per_l')).toBe('m⁻³·mol')
  })

  it('reads integer prefixes, float exponents and blank attributes', () => {
    const expansions = expand(
      '<units name="a"><unit prefix="-3" units="second"/></units>' +
        '<units name="b"><unit units="second" exponent="-1.0"/></units>' +
        '<units name="c"><unit units="second" exponent=""/></units>'
    )
    expect(expansions.get('a')).toBe('10⁻³ s')
    expect(expansions.get('b')).toBe('s⁻¹')
    expect(expansions.get('c')).toBe('s')
  })

  it('resolves references forwards and across files, the first definition winning', () => {
    const expansions = expand(
      '<units name="x"><unit units="y"/></units><units name="y"><unit prefix="kilo" units="metre"/></units>' +
        '<units name="y"><unit units="second"/></units>',
      '<units name="x"><unit units="second"/></units><units name="z"><unit units="x" exponent="2"/></units>'
    )
    expect(expansions.get('x')).toBe('10³ m')
    expect(expansions.get('z')).toBe('10⁶ m²')
  })

  it('keeps names that differ only by case apart', () => {
    const expansions = expand(
      '<units name="mm"><unit prefix="milli" units="metre"/></units>' +
        '<units name="mM"><unit prefix="milli" units="mole"/><unit units="litre" exponent="-1"/></units>'
    )
    expect(expansions.get('mm')).toBe('10⁻³ m')
    expect(expansions.get('mM')).toBe('m⁻³·mol')
  })

  it('treats a units with no parts as a base unit of its own', () => {
    const expansions = expand(
      '<units name="widget"/><units name="per_widget"><unit units="widget" exponent="-1"/></units>'
    )
    expect(expansions.get('widget')).toBe('widget')
    expect(expansions.get('per_widget')).toBe('widget⁻¹')
  })

  it('expands affine units to kelvin and marks them', () => {
    const expansions = expand('<units name="per_celsius"><unit units="celsius" exponent="-1"/></units>')
    expect(expansions.get('celsius')).toBe('K (affine)')
    expect(expansions.get('fahrenheit')).toBe('0.555556 K (affine)')
    expect(expansions.get('per_celsius')).toBe('K⁻¹ (affine)')
  })

  it('leaves out units that are unknown, cyclic or malformed', () => {
    const expansions = expand(
      '<units name="unknown"><unit units="nowhere"/></units>' +
        '<units name="self"><unit units="self"/></units>' +
        '<units name="a"><unit units="b"/></units><units name="b"><unit units="a"/></units>' +
        '<units name="uses_cycle"><unit units="a"/></units>' +
        '<units name="bad_prefix"><unit prefix="mega_ultra" units="metre"/></units>' +
        '<units name="zero"><unit multiplier="0" units="metre"/></units>' +
        '<units name="neg"><unit multiplier="-2" units="metre"/></units>' +
        '<units name="neg_root"><unit units="neg" exponent="0.5"/></units>'
    )
    for (const name of ['unknown', 'self', 'a', 'b', 'uses_cycle', 'bad_prefix', 'zero', 'neg_root']) {
      expect(expansions.has(name), name).toBe(false)
    }
    expect(expansions.get('neg')).toBe('-2 m')
  })

  it('expands every built-in units, even with no library', () => {
    const expansions = expandUnits(['not xml'])
    for (const name of STANDARD_UNITS) expect(expansions.has(name), name).toBe(true)
    expect(expansions.get('gram')).toBe('10⁻³ kg')
    expect(expansions.get('volt')).toBe('kg·m²·s⁻³·A⁻¹')
    expect(expansions.get('radian')).toBe('dimensionless')
  })

  it('reads a CellML 1.1 base_units declaration', () => {
    const xml = '<model xmlns="http://www.cellml.org/cellml/1.1#" name="m"><units name="widget" base_units="yes"/></model>'
    expect(extractUnitDefinitions(xml).get('widget')).toEqual([])
  })
})

describe('expandUnits on the bundled units library', () => {
  let models

  beforeAll(async () => {
    await ensureLibCellmlReady()
    // As stored in the library: printed by libcellml.
    models = ['units', 'user_units'].map(
      (file) => processCellMLData(fs.readFileSync(`src/assets/units/${file}.cellml`, 'utf8')).units.model
    )
  })

  it('expands every units name', () => {
    const expansions = expandUnits(models)
    const names = models.flatMap((xml) => [...extractUnitDefinitions(xml).keys()])
    expect(names.length).toBeGreaterThan(200)
    expect(names.filter((name) => !expansions.has(name))).toEqual([])
  })

  it('expands representative units', () => {
    const expansions = expandUnits(models)
    expect(expansions.get('mV')).toBe('10⁻³ kg·m²·s⁻³·A⁻¹')
    expect(expansions.get('mmHg')).toBe('133.32 kg·m⁻¹·s⁻²')
    expect(expansions.get('UnitValve')).toBe('kg^-0.5·m^3.5')
    expect(expansions.get('Hz')).toBe(expansions.get('per_s'))
  })
})
