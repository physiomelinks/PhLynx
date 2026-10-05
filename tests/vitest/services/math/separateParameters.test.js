import { readdirSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { analyzeMathXml } from '../../../../src/services/math/analyzeMath'
import { separateParameters } from '../../../../src/services/math/separateParameters'
import { isNumericLiteral } from '../../../../src/utils/variables'

/** A one-component model with the given declarations and dx/dt = -k * x. */
const model = (variables) => `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="c">
    ${variables}
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`

const declared = (xml) => new Map(analyzeMathXml(xml).declared.map((variable) => [variable.name, variable]))

describe('separateParameters', () => {
  it('moves a constant value out of the math', () => {
    const { math, values } = separateParameters(
      model('<variable name="t" units="second"/><variable name="x" units="metre" initial_value="x0"/><variable name="x0" units="metre"/><variable name="k" units="per_second" initial_value="0.5"/>')
    )
    expect(values).toEqual(new Map([['k', '0.5']]))
    expect(declared(math).get('k').initialValue).toBe('')
    expect(declared(math).get('k').units).toBe('per_second')
  })

  it('keeps a state linked to its initialiser', () => {
    const xml = model('<variable name="t" units="second"/><variable name="x" units="metre" initial_value="x0"/><variable name="x0" units="metre"/><variable name="k" units="per_second"/>')
    expect(separateParameters(xml)).toEqual({ math: xml, values: new Map(), initialisers: new Set() })
  })

  it('moves a numeric state value to a new initialiser the state links to', () => {
    const { math, values } = separateParameters(
      model('<variable name="t" units="second"/><variable name="x" units="metre" initial_value="1.5" interface="public"/><variable name="k" units="per_second"/>')
    )
    expect(values).toEqual(new Map([['x_init', '1.5']]))
    const variables = declared(math)
    expect(variables.get('x')).toMatchObject({ initialValue: 'x_init', interface: 'public' })
    expect(variables.get('x_init')).toMatchObject({ units: 'metre', initialValue: '', interface: 'public' })
  })

  it('links a state with no initial value, choosing a name that is free', () => {
    const { math, values } = separateParameters(
      model('<variable name="t" units="second"/><variable name="x" units="metre"/><variable name="x_init" units="metre"/><variable name="k" units="per_second"/>')
    )
    expect(values.size).toBe(0)
    expect(declared(math).get('x').initialValue).toBe('x_init_1')
    expect(declared(math).get('x_init_1').units).toBe('metre')
  })

  it('reads the non-self-closing form', () => {
    const { math, values } = separateParameters(
      model('<variable name="t" units="second"></variable><variable name="x" units="metre" initial_value="x0"></variable><variable name="x0" units="metre" initial_value="2"></variable><variable name="k" units="per_second"/>')
    )
    expect(values).toEqual(new Map([['x0', '2']]))
    expect(declared(math).get('x0').initialValue).toBe('')
  })

  it('leaves separated math unchanged', () => {
    const { math } = separateParameters(model('<variable name="t" units="second"/><variable name="x" units="metre" initial_value="1"/><variable name="k" units="per_second" initial_value="2"/>'))
    expect(separateParameters(math)).toEqual({ math, values: new Map(), initialisers: new Set() })
  })

  it('separates every bundled library component without changing its states', () => {
    for (const file of readdirSync('src/assets/modules').filter((name) => name.endsWith('.cellml'))) {
      const text = readFileSync(`src/assets/modules/${file}`, 'utf8')
      for (const [component] of text.matchAll(/<component name="[^"]+"[\s\S]*?<\/component>/g)) {
        const xml = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">${component}</model>`
        const { math } = separateParameters(xml)
        const before = analyzeMathXml(xml)
        const after = analyzeMathXml(math)

        expect(after.stateVariables).toEqual(before.stateVariables)
        expect(after.declared.filter((variable) => isNumericLiteral(variable.initialValue))).toEqual([])
        const initialValueOf = new Map(after.declared.map((variable) => [variable.name, variable.initialValue]))
        for (const state of after.stateVariables) expect(initialValueOf.get(state)).toBeTruthy()
      }
    }
  })
})
