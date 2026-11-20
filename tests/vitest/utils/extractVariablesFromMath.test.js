import { beforeAll, describe, expect, it } from 'vitest'

import { extractComponentsFromCellmlString, extractVariablesFromMath } from '../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const NS = 'http://www.cellml.org/cellml/2.0#'
const model = (body, name = 'm') => `<?xml version="1.0"?><model xmlns="${NS}" name="${name}">${body}</model>`
const variable = (name, initialValue) =>
  `<variable name="${name}" units="dimensionless"${initialValue === undefined ? '' : ` initial_value="${initialValue}"`}/>`

const ENCAPSULATED = model(
  `<component name="parent">${variable('a', 1)}</component>
   <component name="child">${variable('b', 'a')}</component>
   <encapsulation><component_ref component="parent"><component_ref component="child"/></component_ref></encapsulation>`
)

beforeAll(() => ensureLibCellmlReady(), 120000)

describe('extractVariablesFromMath', () => {
  it('reads a parent component that encapsulates others, as libCellML counts top-level components', () => {
    expect(extractVariablesFromMath(ENCAPSULATED).map(({ name, value }) => ({ name, value }))).toEqual([{ name: 'a', value: '1' }])
  })

  it('splits an encapsulating model into its top-level components without throwing', () => {
    const { xml, errors } = extractComponentsFromCellmlString(ENCAPSULATED)
    expect(errors).toEqual([])
    expect(xml.map(({ name, variables }) => [name, variables.map((row) => row.name)])).toEqual([['parent', ['a']]])
  })

  it('reads 1.1 encapsulation groups, but not containment ones', () => {
    const v11 = (relationship) =>
      `<model xmlns="http://www.cellml.org/cellml/1.1#" name="old">
        <component name="p">${variable('a', 1)}</component><component name="c">${variable('b', 2)}</component>
        <group><relationship_ref relationship="${relationship}"/>
          <component_ref component="p"><component_ref component="c"/></component_ref></group></model>`
    expect(extractVariablesFromMath(v11('encapsulation')).map((row) => row.name)).toEqual(['a'])
    expect(() => extractVariablesFromMath(v11('containment'))).toThrow('More than one component detected in old.')
  })

  it('ignores commented-out components and counts imported ones', () => {
    const commented = model(`<!-- <component name="old"/> --><component name="x">${variable('p', 2)}</component>`)
    expect(extractVariablesFromMath(commented).map((row) => row.name)).toEqual(['p'])
    const imported = model(
      `<import xmlns:xlink="http://www.w3.org/1999/xlink" xlink:href="o.cellml"><component name="i" component_ref="o"/></import>
       <component name="x">${variable('p', 2)}</component>`,
      'm3'
    )
    expect(() => extractVariablesFromMath(imported)).toThrow('More than one component detected in m3.')
  })

  it('keeps an initial value that names a variable out of the value', () => {
    const rows = extractVariablesFromMath(model(`<component name="x">${variable('p', 2)}${variable('q', 'p')}</component>`))
    expect(rows.map(({ name, value }) => ({ name, value }))).toEqual([
      { name: 'p', value: '2' },
      { name: 'q', value: '' },
    ])
  })
})
