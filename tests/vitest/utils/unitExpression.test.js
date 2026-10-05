// @vitest-environment happy-dom
import fs from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'

import { AFFINE_UNIT_CONVERSIONS, STANDARD_UNITS } from '../../../src/utils/constants'
import { processCellMLData } from '../../../src/utils/cellml'
import {
  interpretUnitExpression,
  nameUnits,
  parseUnitExpression,
  resolveSymbol,
  suggestUnits,
  unitsModelXml,
} from '../../../src/utils/unitExpression'
import { expandDefinition, expandUnits, extractUnitDefinitions, mergeUnitDefinitions } from '../../../src/utils/units'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

/** A library from units files' XML, shaped as the store gives it. */
function libraryOf(models) {
  const definitions = mergeUnitDefinitions(models)
  return {
    names: new Set([...STANDARD_UNITS, ...Object.keys(AFFINE_UNIT_CONVERSIONS), ...definitions.keys()]),
    definitions,
    expansions: expandUnits(models),
  }
}

const model = (units) => `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">${units}</model>`
const SMALL = libraryOf([
  model(
    '<units name="mM"><unit prefix="milli" units="mole"/><unit units="litre" exponent="-1"/></units>' +
      '<units name="Hz2"><unit units="second" exponent="-2"/></units>' +
      '<units name="widget"/>' +
      '<units name="per_widget"><unit units="widget" exponent="-1"/></units>'
  ),
])

const interpret = (text, library = SMALL) => interpretUnitExpression(text, library)
/** The SI expansion of an expression's new definition. */
const expansionOf = (text, library = SMALL) => interpret(text, library).expansion

describe('parseUnitExpression', () => {
  const symbols = (text) => parseUnitExpression(text).symbols?.map(({ text: written, sign }) => `${sign < 0 ? '/' : ''}${written}`)

  it('reads . and / left to right, as UCUM does', () => {
    expect(symbols('mV/ms')).toEqual(['mV', '/ms'])
    expect(symbols('mmol/L/s')).toEqual(['mmol', '/L', '/s'])
    expect(symbols('mmol/L.s')).toEqual(['mmol', '/L', 's'])
  })

  it('groups with brackets, dividing by the whole group', () => {
    expect(symbols('mmol/(L.s)')).toEqual(['mmol', '/L', '/s'])
    expect(symbols('/(m/s)')).toEqual(['/m', 's'])
  })

  it('keeps exponents and square brackets with their symbol', () => {
    expect(symbols('kg.m-3')).toEqual(['kg', 'm-3'])
    expect(symbols('mm[Hg]-1.s2')).toEqual(['mm[Hg]-1', 's2'])
  })

  it('reads a leading / as one over', () => {
    expect(parseUnitExpression('/s')).toEqual({ factor: 1, symbols: [{ text: 's', sign: -1 }] })
  })

  it('reads integers and powers of ten as factors', () => {
    expect(parseUnitExpression('10*3/uL').factor).toBe(1000)
    expect(parseUnitExpression('10^-6.mol').factor).toBeCloseTo(1e-6, 18)
    expect(parseUnitExpression('1/s')).toEqual({ factor: 1, symbols: [{ text: 's', sign: -1 }] })
    expect(parseUnitExpression('/100').factor).toBe(0.01)
  })

  it('drops annotations, counting one on its own as 1', () => {
    expect(parseUnitExpression('{cells}/mL')).toEqual({ factor: 1, symbols: [{ text: 'mL', sign: -1 }] })
    expect(symbols('mL{RBC}/min')).toEqual(['mL', '/min'])
  })

  it('reports what it cannot read', () => {
    expect(parseUnitExpression('').error).toBeTruthy()
    expect(parseUnitExpression('mV /ms').error).toMatch(/Spaces/)
    expect(parseUnitExpression('m^2').error).toMatch(/straight after/)
    expect(parseUnitExpression('(m.s)2').error).toMatch(/exponent/)
    expect(parseUnitExpression('(m.s').error).toMatch(/\)/)
    expect(parseUnitExpression('mV/').error).toBeTruthy()
    expect(parseUnitExpression('m{x').error).toMatch(/\{/)
  })
})

describe('resolveSymbol', () => {
  const resolve = (text) => resolveSymbol(text, SMALL.names)

  it('prefers a library name as written', () => {
    expect(resolve('Hz2')).toMatchObject({ library: 'Hz2', exponent: 1 })
    expect(resolve('mM')).toMatchObject({ library: 'mM' })
  })

  it('reads UCUM symbols, with a prefix on metric ones only', () => {
    expect(resolve('mV')).toMatchObject({ atom: { units: 'volt' }, prefix: -3 })
    expect(resolve('dL')).toMatchObject({ atom: { units: 'litre' }, prefix: -1 })
    expect(resolve('dam')).toMatchObject({ atom: { units: 'metre' }, prefix: 1 })
    expect(resolve('min')).toMatchObject({ atom: { units: 'second', factor: 60 }, prefix: 0 })
    expect(resolve('cd')).toMatchObject({ atom: { units: 'candela' } })
    expect(resolve('mmin')).toBeNull()
  })

  it('reads a trailing integer as the exponent only when the whole symbol is unknown', () => {
    expect(resolve('m2')).toMatchObject({ atom: { units: 'metre' }, exponent: 2, label: 'm' })
    expect(resolve('s-1')).toMatchObject({ atom: { units: 'second' }, exponent: -1 })
    expect(resolve('m+2')).toMatchObject({ exponent: 2, label: 'm' })
    expect(resolve('mm[Hg]-1')).toMatchObject({ atom: { units: 'pascal' }, exponent: -1, label: 'mm[Hg]' })
    expect(resolve('mM2')).toMatchObject({ library: 'mM', exponent: 2 })
  })

  it('accepts bracketed symbols without their brackets', () => {
    expect(resolve('mmHg')).toMatchObject({ atom: { units: 'pascal', factor: 133322 }, prefix: -3 })
    expect(resolve('cmH2O')).toMatchObject({ atom: { units: 'pascal' }, prefix: -2 })
  })

  it('maps affine temperatures to their units', () => {
    expect(resolve('Cel')).toMatchObject({ affine: 'celsius' })
    expect(resolve('[degF]')).toMatchObject({ affine: 'fahrenheit' })
  })

  it('returns null for unknown symbols', () => {
    expect(resolve('xyz')).toBeNull()
    expect(resolve('2m')).toBeNull()
  })
})

describe('nameUnits', () => {
  const named = (text) => interpret(text).name

  it('names units in the library style', () => {
    expect(named('mV/ms')).toBe('mV_per_ms')
    expect(named('mmol/L/s')).toBe('mmol_per_L_per_s')
    expect(named('kg.m-3')).toBe('kg_per_m3')
    expect(named('mm[Hg]')).toBe('mmHg')
    expect(named('m2')).toBe('m2')
    expect(named('/s')).toBe('per_s')
    expect(named('%')).toBe('percent')
  })

  it('combines repeated symbols', () => {
    expect(named('m.m/s')).toBe('m2_per_s')
  })

  it('names factors with a prefix word where there is one', () => {
    expect(named('10*9/L')).toBe('giga_per_L')
    expect(named('10*-3.mol')).toBe('milli_mol')
    expect(named('10*4/L')).toBe('_1e4_per_L')
    expect(nameUnits([{ label: 's', exponent: 1 }], 2.5)).toBe('_2p5_s')
    expect(nameUnits([{ label: 's', exponent: 1 }], 0.4)).toBe('s_per_2p5')
  })

  it('keeps clear of names already taken by other units', () => {
    const library = libraryOf([model('<units name="mV_per_ms"><unit units="second"/></units>')])
    expect(interpret('mV/ms', library).name).toBe('mV_per_ms_1')
  })
})

describe('interpretUnitExpression', () => {
  it('writes a new units in CellML built-in units, prefixes kept', () => {
    expect(interpret('mV/ms')).toMatchObject({
      parts: [
        { units: 'volt', prefix: -3, exponent: 1, multiplier: 1 },
        { units: 'second', prefix: -3, exponent: -1, multiplier: 1 },
      ],
    })
    expect(expansionOf('mV/ms')).toBe('kg·m²·s⁻⁴·A⁻¹')
  })

  it('puts scales in the first part\'s multiplier', () => {
    expect(interpret('mL/min').parts).toEqual([
      { units: 'litre', prefix: -3, exponent: 1, multiplier: 1 / 60 },
      { units: 'second', prefix: 0, exponent: -1, multiplier: 1 },
    ].map((part, index) => (index === 0 ? { ...part, multiplier: Number((1 / 60).toPrecision(12)) } : part)))
    expect(expansionOf('mm[Hg]')).toBe('133.322 kg·m⁻¹·s⁻²')
    expect(expansionOf('10*3/uL')).toBe('10¹² m⁻³')
  })

  it('writes a scale with no units as dimensionless', () => {
    expect(interpret('%').parts).toEqual([{ units: 'dimensionless', prefix: 0, exponent: 1, multiplier: 0.01 }])
  })

  it('reads mol as a dimension of its own, unlike UCUM', () => {
    expect(expansionOf('mmol/L')).toBe('m⁻³·mol')
  })

  it('expands library units into built-in units, so the new file stands alone', () => {
    const result = interpret('mM/s')
    expect(result.parts.map((part) => part.units)).toEqual(['mole', 'litre', 'second'])
    expect(result.expansion).toBe('m⁻³·s⁻¹·mol')
    expect(interpret('Hz2.s').parts).toEqual([{ units: 'second', prefix: 0, exponent: -1, multiplier: 1 }])
  })

  it('treats only CellML 2.0 names as built-in units', () => {
    const library = libraryOf([model('<units name="old"><unit units="liter"/></units>')])
    expect(interpret('kat/L').parts.map((part) => part.units)).toEqual(['katal', 'litre'])
    expect(interpret('old.s', library).error).toMatch(/built-in/)
  })

  it('finds library units that expand to the same thing', () => {
    expect(interpret('mmol/L').equivalents).toEqual(['mM'])
    expect(interpret('kg').equivalents).toEqual(['kilogram'])
  })

  it('gives an existing name when the expression is one', () => {
    expect(interpret('mM')).toEqual({ name: 'mM', existing: true })
    expect(interpret('Cel')).toEqual({ name: 'celsius', existing: true })
    expect(interpret('m/m')).toEqual({ name: 'dimensionless', existing: true })
  })

  it('refuses what CellML built-in units cannot hold', () => {
    expect(interpret('Cel/s').error).toMatch(/Celsius/)
    expect(interpret('per_widget.s').error).toMatch(/built-in/)
    expect(interpret('xyz/s').error).toMatch(/Unknown units "xyz"/)
    expect(interpret('m^2').error).toBeTruthy()
  })
})

describe('suggestUnits', () => {
  const values = (typed) => suggestUnits(typed, SMALL).map((item) => item.value)

  it('offers library equivalents, then a new units, then library matches', () => {
    const items = suggestUnits('mmol/L', SMALL)
    expect(items.map((item) => item.value)).toEqual(['mM', 'mmol_per_L'])
    expect(items[0].detail).toBe('same as mmol/L · m⁻³·mol')
    expect(items[1]).toMatchObject({ detail: 'new · m⁻³·mol', create: { name: 'mmol_per_L' } })
  })

  it('shows a new units in built-in units when asked', () => {
    const [item] = suggestUnits('mV/ms', SMALL, { builtIn: true })
    expect(item.detail).toBe('new · V·s⁻¹')
  })

  it('offers a UCUM symbol on its own as a new units', () => {
    expect(values('kg')).toEqual(['kilogram', 'kg'])
  })

  it('offers only library matches when the text is not an expression', () => {
    expect(values('wid')).toEqual(['widget', 'per_widget'])
    expect(values('mV/')).toEqual([])
    expect(values('')).toEqual([])
  })

  it('offers the existing units an expression names', () => {
    expect(values('Cel')).toEqual(['celsius'])
    expect(values('mM')).toEqual([])
  })
})

describe('unitsModelXml', () => {
  it('writes prefix names and leaves out defaults, reading back the same', () => {
    const definitions = new Map([
      ['mV_per_ms', interpret('mV/ms').parts],
      ['mL_per_min', interpret('mL/min').parts],
    ])
    const xml = unitsModelXml(definitions)
    expect(xml).toContain('<unit units="volt" prefix="milli"/>')
    expect(xml).toContain('<unit units="second" prefix="milli" exponent="-1"/>')
    expect(extractUnitDefinitions(xml)).toEqual(definitions)
  })
})

describe('generated units on the bundled library, checked by libcellml', () => {
  let libcellml
  let bundled

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
    // As stored in the library: printed by libcellml.
    bundled = libraryOf(
      ['units', 'user_units'].map(
        (file) => processCellMLData(fs.readFileSync(`src/assets/units/${file}.cellml`, 'utf8')).units.model
      )
    )
  })

  /** Parses and validates a units file, returning every issue. */
  function issuesIn(xml) {
    const parser = new libcellml.Parser(true)
    const validator = new libcellml.Validator()
    const parsed = parser.parseModel(xml)
    validator.validateModel(parsed)
    const issues = []
    for (const logger of [parser, validator]) {
      for (let i = 0; i < logger.issueCount(); i++) issues.push(logger.issue(i).description())
    }
    parsed.delete()
    parser.delete()
    validator.delete()
    return issues
  }

  const EXPRESSIONS = [
    'mV/ms', 'mmol/L/s', 'mmol/(L.s)', 'kg.m-3', 'mm[Hg]-1', '10*3/uL', '{cells}/mL', 'cm[H2O]', 'umol/min/kg',
    'nA/pF', 'mS/cm2', '%', 'kat/L', 'mM/s', 'mmol_per_l.s-1', 'uL/(min.mm[Hg])',
  ]

  it('writes units files libcellml accepts', () => {
    const definitions = new Map()
    for (const text of EXPRESSIONS) {
      const result = interpretUnitExpression(text, bundled)
      expect(result.error, text).toBeUndefined()
      // Some are already in the library under the same name, e.g. kg_per_m3.
      if (!result.existing) definitions.set(result.name, result.parts)
    }
    expect(definitions.size).toBeGreaterThan(EXPRESSIONS.length / 2)
    expect(issuesIn(unitsModelXml(definitions))).toEqual([])
  })

  it('matches the library units an expression equals', () => {
    expect(interpretUnitExpression('mmol/L', bundled).equivalents).toEqual(expect.arrayContaining(['mM', 'mmol_per_l']))
    expect(interpretUnitExpression('mV/ms', bundled).equivalents).toEqual(
      expect.arrayContaining([...bundled.expansions].filter(([, value]) => value === 'kg·m²·s⁻⁴·A⁻¹').map(([name]) => name))
    )
  })

  it('uses library names before UCUM symbols', () => {
    expect(interpretUnitExpression('mmHg', bundled)).toEqual({ name: 'mmHg', existing: true })
    expect(interpretUnitExpression('mmHg/s', bundled).parts[0]).toMatchObject({ units: 'pascal', multiplier: 133.322 })
  })

  it('agrees with UCUM on the library\'s mmHg, so mm[Hg] reuses it', () => {
    expect(interpretUnitExpression('mm[Hg]', bundled)).toEqual({ name: 'mmHg', existing: true })
    expect(expandDefinition(interpretUnitExpression('mm[Hg]/s', bundled).parts)).toBe('133.322 kg·m⁻¹·s⁻³')
  })
})
