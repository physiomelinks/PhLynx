// @vitest-environment happy-dom
import { beforeAll, describe, expect, it } from 'vitest'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'
import {
  applyVariableIds,
  carryVariableIds,
  ensureVariableIds,
  listElementIds,
  prepareSavedMath,
  reservedIdsOf,
  stripIds,
  variableIdsOf,
} from '../../../../src/services/math/variableIds'

const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m" id="model_id">
  <units name="per_second" id="u1"><unit units="second" exponent="-1"/></units>
  <component name="decay" id="comp_id">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" id="vx000000"/>
    <variable name="k" units="per_second" id="vk000000"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><ci>k</ci><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`
const BARE = stripIds(XML)

beforeAll(async () => {
  await ensureLibCellmlReady()
})

describe('reading ids', () => {
  it('lists every element id', () => {
    expect(listElementIds(XML)).toEqual(new Set(['model_id', 'u1', 'comp_id', 'vx000000', 'vk000000']))
  })

  it('reserves component names alongside ids', () => {
    expect(reservedIdsOf(XML).has('decay')).toBe(true)
  })

  it('maps variable names to ids', () => {
    expect(variableIdsOf(XML)).toEqual(
      new Map([
        ['x', 'vx000000'],
        ['k', 'vk000000'],
      ])
    )
  })
})

describe('applyVariableIds', () => {
  it('sets ids on the named variables only, and returns the same string when nothing changes', () => {
    const math = applyVariableIds(BARE, new Map([['x', 'va']]))
    expect(variableIdsOf(math)).toEqual(new Map([['x', 'va']]))
    expect(applyVariableIds(math, new Map([['x', 'vb']]))).toBe(math)
    expect(applyVariableIds(math, new Map())).toBe(math)
  })

  it('does not reuse an id another element holds', () => {
    const math = applyVariableIds(XML, new Map([['t', 'u1']]))
    expect(variableIdsOf(math).has('t')).toBe(false)
  })
})

describe('ensureVariableIds', () => {
  it('keeps existing ids and adds Annotator ids only to declared variables', () => {
    const { math, ids } = ensureVariableIds(XML, ['x', 't', 'missing'])
    expect(ids.get('x')).toBe('vx000000')
    expect(ids.get('t')).toMatch(/^b4da[0-9a-f]+$/)
    expect(ids.has('missing')).toBe(false)
    expect(variableIdsOf(math).get('t')).toBe(ids.get('t'))
  })

  it('is deterministic and keeps the math as written', () => {
    const first = ensureVariableIds(XML, ['t'])
    expect(ensureVariableIds(XML, ['t'])).toEqual(first)
    expect(stripIds(first.math)).toBe(stripIds(XML))
  })

  it('never uses a component name or another element’s id', () => {
    const math = XML.replace('name="decay"', 'name="b4da55"').replace('id="u1"', 'id="b4da56"').replace(
      '<math xmlns="http://www.w3.org/1998/Math/MathML">',
      '<math xmlns="http://www.w3.org/1998/Math/MathML" id="b4da57">'
    )
    const { ids } = ensureVariableIds(math, ['t'])
    expect(['b4da55', 'b4da56', 'b4da57', 'comp_id', 'model_id']).not.toContain(ids.get('t'))
  })

  it('is unique across the variables it names', () => {
    const { ids } = ensureVariableIds(BARE, ['t', 'x', 'k'])
    expect(new Set(ids.values()).size).toBe(3)
  })
})

describe('carryVariableIds', () => {
  it('puts the stored ids and component id back onto edited math', () => {
    const math = carryVariableIds(XML, BARE)
    expect(variableIdsOf(math)).toEqual(variableIdsOf(XML))
    expect(listElementIds(math).has('comp_id')).toBe(true)
  })

  it('follows renames, and the old name keeps none', () => {
    const edited = BARE.replaceAll('"x"', '"y"').replaceAll('<ci>x</ci>', '<ci>y</ci>')
    expect(variableIdsOf(carryVariableIds(XML, edited, new Map([['x', 'y']])))).toEqual(
      new Map([
        ['y', 'vx000000'],
        ['k', 'vk000000'],
      ])
    )
  })

  it('follows a swap', () => {
    const swapped = BARE.replace('name="x"', 'name="TMP"')
      .replace('name="k"', 'name="x"')
      .replace('name="TMP"', 'name="k"')
    const renames = new Map([
      ['x', 'k'],
      ['k', 'x'],
    ])
    expect(variableIdsOf(carryVariableIds(XML, swapped, renames))).toEqual(
      new Map([
        ['k', 'vx000000'],
        ['x', 'vk000000'],
      ])
    )
  })
})

describe('prepareSavedMath', () => {
  it('writes nothing when nothing changed', () => {
    expect(prepareSavedMath({ storedMath: XML, editedMath: BARE, isMathChanged: false })).toMatchObject({
      math: null,
      idsChanged: false,
    })
  })

  it('writes an id-only change as no math change', () => {
    const saved = prepareSavedMath({ storedMath: XML, editedMath: BARE, isMathChanged: false, idsFor: ['t'] })
    expect(saved.idsChanged).toBe(true)
    expect(saved.ids.get('t')).toMatch(/^b4da[0-9a-f]+$/)
    expect(variableIdsOf(saved.math).get('t')).toBe(saved.ids.get('t'))
    expect(stripIds(saved.math)).toBe(stripIds(XML))
  })

  it('keeps the stored ids on changed math', () => {
    const edited = BARE.replace('<ci>k</ci><ci>x</ci>', '<cn>2</cn><ci>x</ci>')
    const saved = prepareSavedMath({ storedMath: XML, editedMath: edited, isMathChanged: true, renames: new Map() })
    expect(saved.idsChanged).toBe(false)
    expect(variableIdsOf(saved.math)).toEqual(variableIdsOf(XML))
  })
})

describe('stripIds', () => {
  it('removes every id and leaves math without ids as it is', () => {
    expect(listElementIds(stripIds(XML)).size).toBe(0)
    expect(stripIds(BARE)).toBe(BARE)
  })
})
