import { describe, expect, it } from 'vitest'

import { generateSedmlData } from '../../../../src/services/export/sedml.js'
import { extractSimData } from '../../../../src/services/import/sedml.js'
import { readSolverSettings } from '../../../../src/services/simulation/sedParameters.js'

const TIME_COURSE = { initialPoint: 0, startingPoint: 0, endingPoint: 2, pointInterval: 0.5 }

describe('extractSimData', () => {
  it.each([
    ['the default CVODE settings', { solver: 'CVODE', timeStep: 0, tolerance: 1e-7, maxSteps: 500 }],
    ['changed CVODE settings', { solver: 'CVODE', timeStep: 0.01, tolerance: 1e-9, maxSteps: 5000 }],
    ['a fixed-step solver', { solver: 'RungeKutta4', timeStep: 0.0001 }],
  ])('reads back %s as the export writes them', (_, solver) => {
    const settings = { ...TIME_COURSE, ...solver }
    expect(extractSimData(generateSedmlData(settings), 'simulation.sedml')).toEqual(settings)
  })
})

describe('readSolverSettings', () => {
  it('gives no settings for a solver PhLynx doesn’t offer', () => {
    expect(readSolverSettings('KISAO:0000088', new Map([['KISAO:0000209', '1e-6']]))).toEqual({})
  })

  it('leaves out parameters the algorithm doesn’t give, or gives as something other than a number', () => {
    const parameters = new Map([['KISAO:0000209', '1e-05'], ['KISAO:0000415', 'many']])
    expect(readSolverSettings('KISAO:0000019', parameters)).toEqual({ solver: 'CVODE', tolerance: 1e-5 })
  })
})
