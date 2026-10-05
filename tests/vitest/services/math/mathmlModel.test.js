// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'
import { CellMLTextParser, analyzeModelXml } from 'cellml-text-editor'

import { buildModelFromEquations, extractEquationsMathML } from '../../../../src/services/math/mathmlModel'
import { areModelsEquivalent, extractComponentsFromCellmlString } from '../../../../src/utils/cellml'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

const MODULES_DIR = path.resolve(__dirname, '../../../../src/assets/modules')

/** Every component in the bundled module libraries, as the app stores it: CellML 2.0, one per model. */
function libraryComponents() {
  const out = []
  for (const file of fs.readdirSync(MODULES_DIR).filter((f) => f.endsWith('.cellml'))) {
    const { xml: components } = extractComponentsFromCellmlString(fs.readFileSync(path.join(MODULES_DIR, file), 'utf8'))
    for (const { name, math } of components ?? []) out.push({ id: `${file}:${name}`, xml: math })
  }
  return out
}

/** Re-serializes a model the way the builder does, since libcellml compares math text exactly. */
function canonical(xml) {
  const doc = new DOMParser().parseFromString(xml.replace(/^<\?xml[^>]*\?>/, ''), 'application/xml')
  return new CellMLTextParser().serialize(doc.documentElement)
}

/** The model's equations, one serialized `<apply>` (or other top-level node) each, whatever `<math>` holds them. */
function equationsOf(xml) {
  return extractEquationsMathML(xml).flatMap((math) => {
    const root = new DOMParser().parseFromString(math, 'application/xml').documentElement
    return Array.from(root.children).map((node) => new CellMLTextParser().serialize(node))
  })
}

const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" xmlns:cellml="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" initial_value="1"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci><cn cellml:units="dimensionless">2</cn></apply>
      </apply>
    </math>
  </component>
</model>`

describe('mathmlModel', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  it('extracts the first component math, with its namespaces', () => {
    const [mathml, ...rest] = extractEquationsMathML(XML)
    expect(rest).toEqual([])
    expect(mathml).toMatch(/^<math xmlns="http:\/\/www.w3.org\/1998\/Math\/MathML"/)
    expect(mathml).toContain('xmlns:cellml="http://www.cellml.org/cellml/2.0#"')
    expect(mathml).toContain('<ci>k</ci>')
    expect(extractEquationsMathML('')).toEqual([])
  })

  it('builds the model from equations and the declarations', () => {
    const { xml, errors } = buildModelFromEquations({
      baseXml: XML,
      mathml: extractEquationsMathML(XML),
      definitions: analyzeModelXml(XML).declared,
    })
    expect(errors).toEqual([])
    expect(areModelsEquivalent(xml, canonical(XML))).toBe(true)
  })

  it('uses the given component name and keeps each equation', () => {
    const one = '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>a</ci><ci>b</ci></apply></math>'
    const two = '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>c</ci><ci>a</ci></apply></math>'
    const { xml } = buildModelFromEquations({
      baseXml: XML,
      componentName: 'renamed',
      mathml: [one, two],
      definitions: [{ name: 'a', units: 'metre' }],
    })
    const doc = new DOMParser().parseFromString(xml.replace(/^<\?xml[^>]*\?>/, ''), 'application/xml')
    expect(doc.documentElement.getAttribute('name')).toBe('decay')
    expect(doc.getElementsByTagName('component')[0].getAttribute('name')).toBe('renamed')
    expect(doc.getElementsByTagName('math')).toHaveLength(1)
    expect(doc.getElementsByTagName('apply')).toHaveLength(2)
    expect(Array.from(doc.getElementsByTagName('variable')).map((v) => v.getAttribute('name'))).toEqual(['a'])
  })

  it('reports a line that is not an equation, counting blank lines', () => {
    const expression = '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><plus/><ci>a</ci><ci>b</ci></apply></math>'
    const { xml, errors } = buildModelFromEquations({ baseXml: XML, mathml: ['', expression] })
    expect(xml).toBeNull()
    expect(errors).toEqual([{ line: 2, message: 'This is not an equation. Use = to give it a left and right side.' }])
  })

  it('reports an equation that is not valid MathML', () => {
    const { xml, errors } = buildModelFromEquations({ baseXml: XML, mathml: ['<math><apply>'] })
    expect(xml).toBeNull()
    expect(errors).toEqual([{ line: 1, message: 'The equation is not valid MathML.' }])
  })

  it('keeps the math and declarations of every bundled library component', () => {
    const components = libraryComponents()
    expect(components.length).toBeGreaterThan(0)

    const failures = components.filter(({ xml }) => {
      const original = analyzeModelXml(xml)
      const built = buildModelFromEquations({
        baseXml: xml,
        mathml: extractEquationsMathML(xml),
        definitions: original.declared,
      })
      const rebuilt = analyzeModelXml(built.xml)
      const declaredByName = new Map(original.declared.map((v) => [v.name, v]))

      return (
        equationsOf(built.xml).join() !== equationsOf(xml).join() ||
        rebuilt.referenced.join() !== original.referenced.join() ||
        rebuilt.declared.some((v) => {
          const declared = declaredByName.get(v.name)
          return !declared || declared.units !== v.units || (declared.initialValue || '') !== (v.initialValue || '')
        })
      )
    })
    expect(failures.map(({ id }) => id)).toEqual([])
  }, 30000)
})
