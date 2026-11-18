import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { analyseSteadyState, readEquations } from '../../../../src/services/steadyState/steadyState'
import { analyseSteadyStateInBackground } from '../../../../src/services/steadyState/steadyStateClient'

const fixture = (name) => readFileSync(resolve(__dirname, `../../fixtures/steadyState/${name}.cellml`), 'utf8')

/** Each variable's initial value, as the Parameters tab has them. */
const initialValues = (xml) =>
  Object.fromEntries(
    [...xml.matchAll(/<variable\b[^>]*\bname="([^"]+)"[^>]*\binitial_value="([^"]+)"/g)]
      .filter(([, , value]) => !Number.isNaN(Number(value)))
      .map(([, name, value]) => [name, Number(value)])
  )

describe('analyseSteadyState', () => {
  it('reads the equations bg2cellml writes', () => {
    const equations = readEquations(fixture('glut2'))
    expect(equations.some((e) => e.left.type === 'Derivative')).toBe(true)
  })

  it('finds GLUT2’s cycle and reduces the module, checked numerically', () => {
    const result = analyseSteadyState({ xml: fixture('glut2') })
    expect(result.issues).toEqual([])
    expect(result.suggestions).toHaveLength(1)
    expect(result.spec.cycleStates).toHaveLength(4)
    expect(result.spec.fast).toHaveLength(2)
    expect(result.common.bracket).toBe('difference')
    expect(result.reduced.parameters).toEqual(['q_tot'])
    expect(result.reduced.sections[0].title).toBe('Steady-state flux')
    expect(result.reduced.mathml).toContain('<math')
    expect(result.reduced.mathml).not.toContain('$exp')
    expect(result.verifyError).toBeLessThan(1e-5)
  })

  it('finds an electrogenic uniporter’s charge from its transformer values', () => {
    const xml = fixture('uniporter')
    const values = initialValues(xml)
    const result = analyseSteadyState({ xml, values, ratios: ['TF_f', 'TF_r'] })
    expect(result.issues).toEqual([])
    expect(['1', '-1']).toContain(result.common.z)
  })

  it('reports a module without a cycle', () => {
    const xml = fixture('glut2').replace(/<math[\s\S]*<\/math>/, '<math xmlns="http://www.w3.org/1998/Math/MathML"/>')
    expect(analyseSteadyState({ xml }).issues.map((i) => i.code)).toEqual(['no-cycle'])
  })

  it('runs inline where there are no Workers', async () => {
    const result = await analyseSteadyStateInBackground({ xml: fixture('glut2'), check: false })
    expect(result.common.kappa).toBe('kappa_m')
    expect(result.verifyError).toBeNull()
  })
})
