import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { generateSedmlData } from '../../../../src/services/export/sedml.js'

const golden = (name) => fs.readFileSync(path.resolve(process.cwd(), 'tests/resources/sedml', name), 'utf8')

describe('generateSedmlData', () => {
  // Written by the export before its settings moved to sedParameters.js; web OpenCOR reads these.
  it.each([
    ['baseline.sedml', { pointInterval: 0.01, startingPoint: 0, endingPoint: 10, initialPoint: 0 }, 'model.cellml'],
    ['custom.sedml', { pointInterval: 0.25, startingPoint: 2, endingPoint: 7.1, initialPoint: 1 }, 'circulation.cellml'],
    // A time field cleared in Simulation Settings is null.
    ['cleared.sedml', { pointInterval: 0.5, startingPoint: null, endingPoint: 4, initialPoint: null }, 'model.cellml'],
  ])('writes %s as it always has', (file, settings, cellmlFileName) => {
    expect(generateSedmlData(settings, cellmlFileName)).toBe(golden(file))
  })

  it('writes the default solver settings as it always has', () => {
    const settings = { pointInterval: 0.01, startingPoint: 0, endingPoint: 10, initialPoint: 0 }
    const defaults = { solver: 'CVODE', timeStep: 0, tolerance: 1e-7, maxSteps: 500 }
    expect(generateSedmlData({ ...settings, ...defaults })).toBe(golden('baseline.sedml'))
  })

  it('writes a model without ODEs as a steady state, as libOpenCOR does, with no time course or solver', () => {
    const settings = { pointInterval: 0.01, startingPoint: 0, endingPoint: 10, initialPoint: 0 }
    const sedml = generateSedmlData(settings, 'model.cellml', { isSteadyState: true })
    expect(sedml).toContain('<steadyState id="simulation1"/>')
    expect(sedml).not.toContain('uniformTimeCourse')
    expect(sedml).not.toContain('<algorithm')
    expect(sedml).toContain('<task id="task1" modelReference="model1" simulationReference="simulation1"/>')
  })

  it('writes the CVODE settings it is given', () => {
    const sedml = generateSedmlData({ pointInterval: 0.01, startingPoint: 0, endingPoint: 1, initialPoint: 0, tolerance: 1e-9, maxSteps: 5000, timeStep: 0.5 })
    expect(sedml).toContain('<algorithmParameter kisaoID="KISAO:0000209" value="1e-09"/>')
    expect(sedml).toContain('<algorithmParameter kisaoID="KISAO:0000211" value="1e-09"/>')
    expect(sedml).toContain('<algorithmParameter kisaoID="KISAO:0000415" value="5000"/>')
    expect(sedml).toContain('<algorithmParameter kisaoID="KISAO:0000467" value="0.5"/>')
  })

  it('writes a fixed-step solver with only its step', () => {
    const sedml = generateSedmlData({ pointInterval: 0.01, startingPoint: 0, endingPoint: 1, initialPoint: 0, solver: 'RungeKutta4', timeStep: 1e-4, tolerance: 1e-9 })
    expect(sedml).toContain('<algorithm kisaoID="KISAO:0000032">')
    expect(sedml.match(/<algorithmParameter /g)).toHaveLength(1)
    expect(sedml).toContain('<algorithmParameter kisaoID="KISAO:0000483" value="0.0001"/>')
  })
})
