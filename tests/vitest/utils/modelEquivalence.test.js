import { beforeAll, describe, expect, it } from 'vitest'

import { areModelsEquivalent } from '../../../src/utils/cellml'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const MODEL = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="c">
    <variable name="t" units="second"/>
    <variable name="x" units="metre"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <cn cellml:units="metre" xmlns:cellml="http://www.cellml.org/cellml/2.0#">1</cn>
      </apply>
    </math>
  </component>
</model>`

describe('areModelsEquivalent', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  it('ignores the indentation of the math and the order of the variables', () => {
    const compact = MODEL.replace(/>\s+</g, '><').replace(
      '<variable name="t" units="second"/><variable name="x" units="metre"/>',
      '<variable name="x" units="metre"/><variable name="t" units="second"/>'
    )
    expect(areModelsEquivalent(MODEL, compact)).toBe(true)
  })

  it('tells apart different math', () => {
    expect(areModelsEquivalent(MODEL, MODEL.replace('>1</cn>', '>2</cn>'))).toBe(false)
    expect(areModelsEquivalent(MODEL, '')).toBe(false)
  })
})
