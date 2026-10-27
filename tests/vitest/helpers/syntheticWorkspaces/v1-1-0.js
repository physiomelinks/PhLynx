/**
 * A synthetic workspace at format 1.1.0. Math holds no numeric initial values: the rows initialise the model,
 * and store.mathDefaults keeps the values taken out of each math. The solver settings are saved but not applied.
 */
import { instanceNode, libraryModule, mathEntry, row, separatedDecay, units } from './builders.js'

export const version = '1.1.0'

/**
 * Builds the workspace around the cases, as of `version`.
 *
 * @param {string} [fileVersion]
 * @returns {Object}
 */
export const base = (fileVersion = version) => ({
  id: 'phlynx-project',
  version: fileVersion,
  flow: { nodes: [], edges: [], position: [0, 0], zoom: 1, viewport: { x: 0, y: 0, zoom: 1 } },
  store: {
    availableCollections: [],
    availableMath: [],
    availableModules: [],
    availableUnits: [units()],
    globalConstants: [],
    mathDefaults: [],
  },
  simulation: {
    simulationSettings: {
      pointInterval: 0.01,
      startingPoint: 0,
      endingPoint: 10,
      initialPoint: 0,
      solver: 'CVODE',
      timeStep: 0,
      tolerance: 1e-6,
      maxSteps: 10000,
    },
    plotConfig: {},
    parameterScanConfig: {},
  },
  inspectionModules: [],
  workspace: { archiveHash: 0, archiveName: '', archiveType: 'omex', cellmlFileName: 'model.cellml', manifestXml: '', preservedExtras: [] },
})

/**
 * Builds a node of separated decay math, its math, defaults and module.
 *
 * @param {string} name - Also its component and node id.
 * @returns {Object} A part.
 */
export const separatedDecayNode = (name) => {
  const mathRef = `decay_modules.cellml:${name}`
  const moduleRef = `${name}:decay`
  const rows = [
    row('t', 'second', 'variable'),
    row('x', 'metre', 'variable', '', { stateRole: 'state', initialiser: 'x_init' }),
    row('x_init', 'metre', 'constant', '2', { data_reference: 'Jones1999' }),
    row('k', 'per_second', 'constant', '0.5', { data_reference: 'Smith2001' }),
  ]
  return {
    flow: { nodes: [instanceNode(name, name, { mathRef, moduleRef, variables: rows })], edges: [] },
    store: {
      availableMath: [mathEntry(mathRef, separatedDecay(name))],
      mathDefaults: [
        [
          mathRef,
          [
            ['x_init', '1.5'],
            ['k', '0.5'],
          ],
        ],
      ],
      ...libraryModule(moduleRef, mathRef).store,
    },
  }
}

export const cases = {
  /** Node `decay_separated`'s math is already separated, with x from x_init = 2 and k = 0.5 in its rows. */
  separatedMath: () => separatedDecayNode('decay_separated'),

  /**
   * The solver settings a run never used: RungeKutta4 with a 0.2 step, 1e-6 tolerance and 10000 steps, saved
   * with a 0.25 point interval and an ending point of 3.
   */
  unappliedSolverSettings: () => ({
    simulation: {
      simulationSettings: { pointInterval: 0.25, endingPoint: 3, solver: 'RungeKutta4', timeStep: 0.2, tolerance: 1e-6, maxSteps: 10000 },
    },
  }),
}
