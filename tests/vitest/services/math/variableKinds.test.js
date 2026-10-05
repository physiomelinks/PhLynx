// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'
import { analyzeMathXml } from '../../../../src/services/math/analyzeMath'
import { readFileSync, readdirSync } from 'node:fs'
import { classifyRows, findConnectionSupplied, isInitialisable } from '../../../../src/services/math/variableKinds'
import { getPortVariables, reconcileRows } from '../../../../src/services/math/reconcileRows'
import { normalisePorts, normaliseVariables } from '../../../../src/utils/config'

/** A component whose math is the given equations, in MathML. */
const model = (equations) => `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="c">
    <math xmlns="http://www.w3.org/1998/Math/MathML">${equations}</math>
  </component>
</model>`

// dV/dt = I, k_eff = k1 * k2, I = g * (V - E_in)
const MATH = model(`
  <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply><ci>I</ci></apply>
  <apply><eq/><ci>k_eff</ci><apply><times/><ci>k1</ci><ci>k2</ci></apply></apply>
  <apply><eq/><ci>I</ci><apply><times/><ci>g</ci><apply><minus/><ci>V</ci><ci>E_in</ci></apply></apply></apply>
`)

const ROWS = [
  { name: 't', type: 'variable' },
  { name: 'V', type: 'variable', stateRole: 'state', initialiser: 'V_init' },
  { name: 'V_init', type: 'constant' },
  { name: 'k1', type: 'constant' },
  { name: 'k2', type: 'global_constant' },
  { name: 'k_eff', type: 'variable' },
  { name: 'g', type: 'constant' },
  { name: 'I', type: 'variable' },
  { name: 'E_in', type: 'variable' }, // not defined here, so it comes through a port
]

const byName = (name) => ROWS.find((row) => row.name === name)

describe('classifyRows', () => {
  const kinds = classifyRows(analyzeMathXml(MATH), ROWS)

  it("takes the constants from the rows' types", () => {
    expect(kinds.get('k1')).toBe('constant')
    expect(kinds.get('k2')).toBe('constant')
    expect(kinds.get('g')).toBe('constant')
  })

  it('classifies what the math computes', () => {
    expect(kinds.get('t')).toBe('voi')
    expect(kinds.get('V')).toBe('state')
    expect(kinds.get('k_eff')).toBe('computed_constant')
    expect(kinds.get('I')).toBe('algebraic')
  })

  it('treats a variable the math uses but does not define as an input from a port', () => {
    expect(kinds.get('E_in')).toBe('external')
  })

  it('follows a row whose type changes', () => {
    const rows = ROWS.map((row) => (row.name === 'k1' ? { ...row, type: 'variable' } : row))
    const changed = classifyRows(analyzeMathXml(MATH), rows)
    expect(changed.get('k1')).toBe('external')
    expect(changed.get('k_eff')).toBe('algebraic')
  })

  it('returns null without an analysis', () => {
    expect(classifyRows(null, ROWS)).toBeNull()
  })
})

describe('isInitialisable', () => {
  const kinds = classifyRows(analyzeMathXml(MATH), ROWS)

  it('allows constants and computed constants only', () => {
    expect(isInitialisable(byName('k1'), kinds)).toBe(true)
    expect(isInitialisable(byName('k_eff'), kinds)).toBe(true)
    for (const name of ['t', 'V', 'I', 'E_in']) expect(isInitialisable(byName(name), kinds), name).toBe(false)
  })

  it('falls back to the row type without kinds, or for a row the math does not mention', () => {
    expect(isInitialisable(byName('V_init'), kinds)).toBe(true)
    expect(isInitialisable(byName('k1'), null)).toBe(true)
    expect(isInitialisable(byName('k_eff'), null)).toBe(false)
  })
})

describe('boundary conditions', () => {
  // dV/dt = I, k_b = 2 * b, I = g * V, with b supplied through a port
  const BC_MATH = model(`
    <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply><ci>I</ci></apply>
    <apply><eq/><ci>k_b</ci><apply><times/><cn>2</cn><ci>b</ci></apply></apply>
    <apply><eq/><ci>I</ci><apply><times/><ci>g</ci><ci>V</ci></apply></apply>
  `)
  const BC_ROWS = [
    { name: 't', type: 'variable' },
    { name: 'V', type: 'variable', stateRole: 'state', initialiser: 'k_b' },
    { name: 'b', type: 'boundary_condition' },
    { name: 'k_b', type: 'variable' },
    { name: 'g', type: 'constant' },
    { name: 'I', type: 'variable' },
  ]
  const row = (name) => BC_ROWS.find((candidate) => candidate.name === name)
  const analysis = analyzeMathXml(BC_MATH)
  const kinds = classifyRows(analysis, BC_ROWS)

  it('treats a boundary condition, and what the math computes from it, as constant', () => {
    expect(kinds.get('b')).toBe('constant')
    expect(kinds.get('k_b')).toBe('computed_constant')
    expect(isInitialisable(row('b'), kinds)).toBe(true)
    expect(isInitialisable(row('k_b'), kinds)).toBe(true)
  })

  it('still calls what changes over time time-varying', () => {
    for (const name of ['t', 'V', 'I']) expect(isInitialisable(row(name), kinds), name).toBe(false)
  })

  it('lists only the names a connection makes constant', () => {
    expect(findConnectionSupplied(analysis, BC_ROWS)).toEqual(new Set(['b', 'k_b']))
    expect(findConnectionSupplied(analyzeMathXml(MATH), ROWS)).toEqual(new Set())
    expect(findConnectionSupplied(null, BC_ROWS)).toBeNull()
  })
})

describe('heart_Ca_input', () => {
  const file = readFileSync('src/assets/modules/heart_modules.cellml', 'utf8')
  const component = file.match(/<component name="heart_Ca_input">[\s\S]*?<\/component>/)[0]
  const xml = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">${component}</model>`
  const config = JSON.parse(readFileSync('src/assets/module_configs/heart.json', 'utf8')).find(
    (module) => module.component_type === 'heart_Ca_input'
  )

  it.each(['simple', 'advanced'])('treats the q_*_init initialisers as constants in %s mode', (mode) => {
    const analysis = analyzeMathXml(xml)
    const rows = reconcileRows(analysis, normaliseVariables(config.variables_and_units), {
      mode,
      portVariables: getPortVariables(normalisePorts(config)),
    })
    const kinds = classifyRows(analysis, rows)
    const rowsByName = new Map(rows.map((row) => [row.name, row]))

    for (const name of ['q_ra_init', 'q_rv_init', 'q_la_init', 'q_lv_init']) {
      expect(rowsByName.get(name).type).toBe('global_constant')
    }
    const timeVarying = rows.filter(
      (row) => row.stateRole === 'state' && row.initialiser && !isInitialisable(rowsByName.get(row.initialiser), kinds)
    )
    expect(timeVarying.map((row) => row.name)).toEqual([])
    expect(rowsByName.get('u_root').type).toBe('boundary_condition')
    expect(rowsByName.get('u_par').type).toBe('boundary_condition')
  })
})

describe('bundled library modules', () => {
  const componentXml = new Map()
  for (const file of readdirSync('src/assets/modules').filter((name) => name.endsWith('.cellml'))) {
    const text = readFileSync(`src/assets/modules/${file}`, 'utf8')
    for (const match of text.matchAll(/<component name="([^"]+)"[\s\S]*?<\/component>/g)) {
      componentXml.set(`${file}:${match[1]}`, match[0])
    }
  }

  it('keeps every configured type, apart from port variables nothing computes', () => {
    const changed = []
    for (const configFile of readdirSync('src/assets/module_configs')) {
      const modules = JSON.parse(readFileSync(`src/assets/module_configs/${configFile}`, 'utf8'))
      if (!Array.isArray(modules)) continue
      for (const module of modules) {
        const component = componentXml.get(`${module.component_file}:${module.component_type}`)
        if (!component) continue
        const configured = normaliseVariables(module.variables_and_units)
        const rows = reconcileRows(analyzeMathXml(`<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">${component}</model>`), configured, {
          portVariables: getPortVariables(normalisePorts(module)),
        })
        const typeOf = new Map(rows.map((row) => [row.name, row.type]))
        for (const row of configured) {
          if (typeOf.has(row.name) && typeOf.get(row.name) !== row.type) {
            changed.push({ file: configFile, change: `${row.type} -> ${typeOf.get(row.name)}` })
          }
        }
      }
    }
    // A few microvasculature modules list port inputs as `variable`; they are boundary conditions.
    // Two are declared but unused (constant_pressure_BC_type_micro.v), and are kept as rows.
    expect(changed.length).toBe(14)
    expect(new Set(changed.map(({ file, change }) => `${file}: ${change}`))).toEqual(
      new Set(['microvasculature_network.json: variable -> boundary_condition'])
    )
  })
})
