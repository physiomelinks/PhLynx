// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzeModel } from 'cellml-text-editor'
import { analyzeMathBatch, analyzeMathXml } from '../../../../src/services/math/analyzeMath'

const MODULES_DIR = path.resolve(__dirname, '../../../../src/assets/modules')

/** Every component in the bundled module libraries, each wrapped as its own single-component model. */
function libraryComponents() {
  const out = []
  for (const file of fs.readdirSync(MODULES_DIR).filter((f) => f.endsWith('.cellml'))) {
    const doc = new DOMParser().parseFromString(
      // happy-dom rejects single-quoted XML declarations; the declaration carries nothing we need.
      fs.readFileSync(path.join(MODULES_DIR, file), 'utf8').replace(/^<\?xml[^>]*\?>/, ''),
      'application/xml'
    )
    const model = doc.documentElement
    for (const component of Array.from(doc.getElementsByTagName('component'))) {
      const xml = `<model xmlns="${model.namespaceURI}" name="m">${new XMLSerializer().serializeToString(component)}</model>`
      out.push({ id: `${file}:${component.getAttribute('name')}`, xml })
    }
  }
  return out
}

const sorted = (a) => [...a].sort()

const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'

/** Every `<ci>` name in the first component's math, in document order, as cellml-text-editor's referenceSequence gives them. */
function referenceSequence(doc) {
  const component = doc.getElementsByTagName('component')[0]
  if (!component) return []
  return Array.from(component.getElementsByTagNameNS(MATHML_NS, 'ci'))
    .map((ci) => ci.textContent.trim())
    .filter(Boolean)
}

describe('analyzeMathXml', () => {
  const SAMPLE = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
    <component name="c">
      <variable name="t" units="second" interface="public"/>
      <variable name="V" units="volt" initial_value="V_init"/>
      <variable name="V_init" units="volt" initial_value="-0.08"/>
      <variable name="k" units=""/>
      <math xmlns="http://www.w3.org/1998/Math/MathML">
        <apply><eq/>
          <apply><diff/><bvar><ci>t</ci></bvar><ci>V</ci></apply>
          <apply><times/><ci>k</ci><ci>I</ci></apply>
        </apply>
        <apply><eq/><ci>I</ci><apply><minus/><ci>V</ci></apply></apply>
      </math>
    </component>
  </model>`

  it('reads declarations, references, states and roles in one pass', () => {
    const analysis = analyzeMathXml(SAMPLE)
    expect(analysis.componentName).toBe('c')
    expect(analysis.declared.map((v) => v.name)).toEqual(['t', 'V', 'V_init', 'k'])
    expect(analysis.referenced).toEqual(['t', 'V', 'k', 'I'])
    expect(analysis.references).toEqual(['t', 'V', 'k', 'I', 'I', 'V'])
    expect(analysis.stateVariables).toEqual(['V'])
    // A state on the LHS of its derivative counts as assigned, as in the previous roles logic.
    expect(sorted(analysis.assigned)).toEqual(['I', 'V'])
    expect(analysis.voi).toEqual(['t'])
    expect(sorted(analysis.unresolved)).toEqual(['I', 'k'])
  })

  it('records what each equation defines and uses', () => {
    // An ODE has no target, and its bvar makes it depend on the VOI.
    expect(analyzeMathXml(SAMPLE).dependencies).toEqual([
      { target: null, uses: ['t', 'V', 'k', 'I'] },
      { target: 'I', uses: ['V'] },
    ])
  })

  it('records dependencies of piecewise and implicit equations, and only for the first component', () => {
    const xml = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">
      <component name="c">
        <math xmlns="http://www.w3.org/1998/Math/MathML">
          <apply><eq/><ci>x</ci>
            <piecewise><piece><ci>a</ci><apply><gt/><ci>b</ci><cn>0</cn></apply></piece><otherwise><ci>x</ci></otherwise></piecewise>
          </apply>
          <apply><eq/><apply><plus/><ci>y</ci><ci>z</ci></apply><ci>a</ci></apply>
        </math>
      </component>
      <component name="other">
        <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>q</ci><ci>r</ci></apply></math>
      </component>
    </model>`

    expect(analyzeMathXml(xml).dependencies).toEqual([
      { target: 'x', uses: ['a', 'b', 'x'] },
      { target: null, uses: ['y', 'z', 'a'] },
    ])
  })

  it('returns null for empty input', () => {
    expect(analyzeMathXml('')).toBeNull()
    expect(analyzeMathXml(undefined)).toBeNull()
  })

  it("matches cellml-text-editor's analyzeModel for every bundled library component", () => {
    const components = libraryComponents()
    expect(components.length).toBeGreaterThan(10)
    for (const { id, xml } of components) {
      const doc = new DOMParser().parseFromString(xml, 'application/xml')
      const { references, ...analysis } = analyzeMathXml(xml)
      expect({ id, ...analysis }, id).toEqual({ id, ...analyzeModel(doc) })
      expect({ id, references }, id).toEqual({ id, references: referenceSequence(doc) })
    }
  })

  it('analyzes a batch in order', () => {
    const results = analyzeMathBatch([{ key: 'a', xml: SAMPLE }, { key: 'b', xml: '' }])
    expect(results.map((r) => r.key)).toEqual(['a', 'b'])
    expect(results[0].analysis.componentName).toBe('c')
    expect(results[1].analysis).toBeNull()
  })
})
