import { describe, expect, it } from 'vitest'

import { dropDrivenStates } from '../../../../src/services/math/dropDrivenStates'

const MODEL = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="c">
    <variable name="t" units="second"/>
    <variable name="q" units="mole" initial_value="q_init"/>
    <variable name="q_init" units="mole" initial_value="1"/>
    <variable name="p" units="mole" initial_value="2"/>
    <variable name="v" units="mole_per_second"/>
    <variable name="u" units="volt"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply><ci>v</ci></apply>
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>p</ci></apply><ci>v</ci></apply>
      <apply><eq/><ci>u</ci><ci>q</ci></apply>
    </math>
  </component>
</model>`

const parse = (xml) => new DOMParser().parseFromString(xml, 'application/xml')
const variable = (doc, name) => [...doc.getElementsByTagName('variable')].find((v) => v.getAttribute('name') === name)
const odeStates = (doc) => [...doc.getElementsByTagName('bvar')].map((bvar) => bvar.nextElementSibling?.textContent.trim())

describe('dropDrivenStates', () => {
  it("drops a driven state's ODE and initial value, and the initialiser nothing else uses", () => {
    const doc = parse(dropDrivenStates(MODEL, ['q']))
    expect(odeStates(doc)).toEqual(['p'])
    expect(variable(doc, 'q').hasAttribute('initial_value')).toBe(false)
    expect(variable(doc, 'q_init')).toBeUndefined()
    // What uses the state, and other states, are left alone.
    expect(variable(doc, 'p').getAttribute('initial_value')).toBe('2')
    expect(doc.getElementsByTagName('eq')).toHaveLength(2)
    expect(variable(doc, 'u')).toBeDefined()
  })

  it('finds the derivative on either side, with its bvar in any order, across math blocks', () => {
    const model = MODEL.replace(
      '<apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply><ci>v</ci></apply>',
      '<apply><eq/><ci>v</ci><apply><diff/><ci>q</ci><bvar><ci>t</ci></bvar></apply></apply>'
    ).replace(
      '<apply><eq/><ci>u</ci><ci>q</ci></apply>',
      '</math><math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>u</ci><ci>q</ci></apply>'
    )
    const doc = parse(dropDrivenStates(model, ['q']))
    expect(doc.getElementsByTagName('diff')).toHaveLength(1)
    expect(odeStates(doc)).toEqual(['p'])
    expect(doc.getElementsByTagName('math')).toHaveLength(2)
    expect(variable(doc, 'q').hasAttribute('initial_value')).toBe(false)
  })

  it('removes a math block the dropped ODE leaves empty', () => {
    const ode = '<apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply><ci>v</ci></apply>'
    const model = MODEL.replace(ode, '').replace(
      '<apply><eq/><ci>u</ci><ci>q</ci></apply>',
      `<apply><eq/><ci>u</ci><ci>q</ci></apply></math><math xmlns="http://www.w3.org/1998/Math/MathML">${ode}`
    )
    expect(parse(model).getElementsByTagName('math')).toHaveLength(2)
    const doc = parse(dropDrivenStates(model, ['q']))
    expect(doc.getElementsByTagName('math')).toHaveLength(1)
    expect(odeStates(doc)).toEqual(['p'])
  })

  it('leaves the model as it is when nothing is driven', () => {
    expect(dropDrivenStates(MODEL, [])).toBe(MODEL)
  })
})
