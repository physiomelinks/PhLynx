import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { analyseSteadyState } from '../../../../src/services/steadyState/steadyState'
import { inferSteadyStateUnits } from '../../../../src/services/steadyState/steadyStateUnits'
import { extractUnitDefinitions } from '../../../../src/utils/units'

const xml = readFileSync(resolve(__dirname, '../../fixtures/steadyState/glut2.cellml'), 'utf8')
const variableUnits = new Map([...xml.matchAll(/<variable\b[^>]*\bname="([^"]+)"[^>]*\bunits="([^"]+)"/g)].map(([, name, units]) => [name, units]))

describe('inferSteadyStateUnits', () => {
  it('gives the flux and lumped parameters units the module already uses', () => {
    const { reduced, spec } = analyseSteadyState({ xml, check: false })
    const known = new Map(variableUnits)
    known.set('q_tot', known.get(spec.cycleStates[0]))
    const { units, unresolved } = inferSteadyStateUnits({ mathml: reduced.mathml, known, unitDefinitions: extractUnitDefinitions(xml) })
    expect(unresolved).toEqual([])
    expect(units.get(reduced.flux)).toBe(known.get(spec.flux))
    expect(units.get('kappa_m')).toBe(known.get(spec.flux))
    expect(units.get('Phi')).toBe('dimensionless')
    expect([...units.keys()].filter((name) => name.startsWith('qbar_')).every((name) => units.get(name) === 'dimensionless')).toBe(true)
  })

  it('reports what it can’t find', () => {
    const mathml = '<math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>x</ci><apply><times/><ci>y</ci><ci>z</ci></apply></apply></math>'
    expect(inferSteadyStateUnits({ mathml, known: new Map([['y', 'second']]), unitDefinitions: new Map() }).unresolved).toEqual(['x'])
  })
})
