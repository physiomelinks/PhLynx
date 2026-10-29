import { CellMLTextGenerator, parseLayout, serializeLayout } from 'cellml-text-editor'
import { describe, expect, it } from 'vitest'

import { sectionLayout } from '../../../../src/services/celldl/sectionLayout.js'

const equation = (lhs, rhs) => `<apply><eq/>${lhs}<ci>${rhs}</ci></apply>`
const MATH = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m"><component name="one">
  <variable name="t" units="second"/><variable name="q" units="mole"/><variable name="u" units="J_per_mol"/>
  <variable name="v" units="mol_per_s"/><variable name="a" units="J_per_mol"/>
  <math xmlns="http://www.w3.org/1998/Math/MathML">
    ${equation('<ci>u</ci>', 'a')}
    ${equation('<ci>v</ci>', 'u')}
    ${equation('<apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply>', 'v')}
  </math></component></model>`
const SECTIONS = [
  { title: 'Potentials', variables: ['u'] },
  { title: 'Element flows', variables: ['v'] },
  { title: 'Conservation', variables: ['q'] },
]

const textOf = (layout, simplified) => new CellMLTextGenerator({ simplified }).generateResult(MATH, { layout }).text

describe('sectionLayout', () => {
  it('heads each section with its title, a blank line before it', () => {
    const layout = sectionLayout(MATH, 'one', SECTIONS)

    expect(textOf(layout, true)).toBe(
      ['// Potentials', 'u = a;', '', '// Element flows', 'v = u;', '', '// Conservation', 'ode(q, t) = v;', ''].join('\n')
    )
    // Advanced Mode puts the first heading after the variables, with a blank line.
    expect(textOf(layout, false)).toMatch(/var a: J_per_mol \{interface: public\};\n\n {4}\/\/ Potentials\n {4}u = a;\n\n/)
  })

  it('survives a workspace save and reload, which checks layouts with parseLayout', () => {
    const layout = sectionLayout(MATH, 'one', SECTIONS)
    expect(parseLayout(serializeLayout(layout))).toEqual(layout)
  })

  it('lays out the only component when given no name', () => {
    expect(sectionLayout(MATH, undefined, SECTIONS)).toEqual(sectionLayout(MATH, 'one', SECTIONS))
  })

  it("gives none without sections, for another component, or when the sections don't count the equations", () => {
    expect(sectionLayout(MATH, 'one', [])).toBeNull()
    expect(sectionLayout(MATH, 'one', undefined)).toBeNull()
    expect(sectionLayout(MATH, 'other', SECTIONS)).toBeNull()
    expect(sectionLayout(MATH, 'one', SECTIONS.slice(1))).toBeNull()
  })
})
