import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import { hoistEncapsulatedComponents } from '../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const CELLML_10 = 'xmlns="http://www.cellml.org/cellml/1.0#" xmlns:cellml="http://www.cellml.org/cellml/1.0#"'
const MATH = '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>y</ci><ci>k</ci></apply></math>'

/**
 * A CellML 2.0 model whose parent encapsulates one child that reads the parent's k.
 *
 * @returns {string}
 */
const encapsulated20 = () => `<?xml version="1.0"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
  <component name="parent"><variable name="k" units="dimensionless" initial_value="2" interface="private"/></component>
  <component name="child">
    <variable name="k" units="dimensionless" interface="public"/>
    <variable name="y" units="dimensionless"/>
    ${MATH}
  </component>
  <encapsulation><component_ref component="parent"><component_ref component="child"/></component_ref></encapsulation>
  <connection component_1="parent" component_2="child"><map_variables variable_1="k" variable_2="k"/></connection>
</model>`

/**
 * A CellML 1.0 model with an encapsulation group; `body` goes in the child, after its variables.
 *
 * @param {string} [body]
 * @returns {string}
 */
const encapsulated10 = (body = '') => `<?xml version="1.0"?>
<model ${CELLML_10} name="m">
  <component name="parent"><variable name="k" units="dimensionless" initial_value="2" private_interface="out"/></component>
  <component name="child">
    <variable name="k" units="dimensionless" public_interface="in"/>
    <variable name="y" units="dimensionless"/>
    ${body}${MATH}
  </component>
  <group><relationship_ref relationship="encapsulation"/>
    <component_ref component="parent"><component_ref component="child"/></component_ref>
  </group>
  <connection><map_components component_1="parent" component_2="child"/><map_variables variable_1="k" variable_2="k"/></connection>
</model>`

describe('hoistEncapsulatedComponents', () => {
  let libcellml

  beforeAll(async () => {
    libcellml = (await ensureLibCellmlReady()).instance
  })

  afterEach(() => vi.restoreAllMocks())

  /**
   * The validator's error count and the top-level component names of a model.
   *
   * @param {string} cellml
   * @returns {{errors: number, components: string[]}}
   */
  function inspect(cellml) {
    const parser = new libcellml.Parser(false)
    const model = parser.parseModel(cellml)
    const validator = new libcellml.Validator()
    validator.validateModel(model)
    const components = Array.from({ length: model.componentCount() }, (_, i) => {
      const component = model.componentByIndex(i)
      const name = component.name()
      component.delete()
      return name
    })
    const result = { errors: parser.errorCount() + validator.errorCount(), components }
    ;[validator, parser, model].forEach((object) => object.delete())
    return result
  }

  it('hoists the children of a CellML 2.0 <encapsulation>', () => {
    const { cellml, hoisted, ignoredContainment, hoistFailed } = hoistEncapsulatedComponents(encapsulated20())

    expect({ hoisted, ignoredContainment, hoistFailed }).toEqual({ hoisted: ['child'], ignoredContainment: false, hoistFailed: false })
    expect(cellml).not.toMatch(/encapsulation/)
    expect(inspect(cellml)).toEqual({ errors: 0, components: ['parent', 'child'] })
  })

  it('hoists the children of a CellML 1.0 encapsulation group', () => {
    const { cellml, hoisted } = hoistEncapsulatedComponents(encapsulated10())

    expect(hoisted).toEqual(['child'])
    expect(inspect(cellml)).toEqual({ errors: 0, components: ['parent', 'child'] })
  })

  it('leaves a model that parses with errors unchanged, flagged and logged', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const xml = encapsulated10('stray text')

    expect(hoistEncapsulatedComponents(xml)).toEqual({ cellml: xml, hoisted: [], ignoredContainment: false, hoistFailed: true })
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('does not flag a model without encapsulation that parses with errors', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const xml = encapsulated10('stray text').replace('relationship="encapsulation"', 'relationship="containment"')

    expect(hoistEncapsulatedComponents(xml)).toEqual({ cellml: xml, hoisted: [], ignoredContainment: true, hoistFailed: false })
    expect(warn).not.toHaveBeenCalled()
  })

  it('returns a model without groups as given, without parsing it', () => {
    const xml = encapsulated10().replace(/<group>[\s\S]*<\/group>/, '')
    const parse = vi.spyOn(libcellml.Parser.prototype, 'parseModel')

    expect(hoistEncapsulatedComponents(xml)).toEqual({ cellml: xml, hoisted: [], ignoredContainment: false, hoistFailed: false })
    expect(parse).not.toHaveBeenCalled()
  })
})
