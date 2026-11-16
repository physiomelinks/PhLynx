/**
 * A synthetic workspace at format 1.0.0, in the `info` envelope the production site saved. Math keeps its
 * numeric initial values, and a blank row falls back to them.
 */
import { component, decay, instanceNode, libraryModule, mathEntry, row, units } from './builders.js'

export const version = '1.0.0'

/**
 * Builds the workspace around the cases.
 *
 * @returns {Object}
 */
export const base = () => ({
  info: { format_version: '1.0.0', project: 'Phlynx-Project' },
  flow: { nodes: [], edges: [], position: [0, 0], zoom: 1, viewport: { x: 0, y: 0, zoom: 1 } },
  store: {
    availableCollections: [],
    availableMath: [],
    availableModules: [],
    availableUnits: [units()],
    globalConstants: [],
    lastExportName: '',
    lastSaveName: 'synthetic',
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
})

/**
 * Builds a decay node, its math and its module.
 *
 * @param {string} name - Also its component and node id.
 * @param {Array<Object>} rows
 * @param {string} [xml] - Its component, a decay with x = 1.5 and k = 0.5 when not given.
 * @returns {Object} A part.
 */
const decayNode = (name, rows, xml = decay(name)) => {
  const mathRef = `decay_modules.cellml:${name}`
  const moduleRef = `${name}:decay`
  return {
    flow: { nodes: [instanceNode(name, name, { mathRef, moduleRef, variables: rows })], edges: [] },
    store: { availableMath: [mathEntry(mathRef, xml)], ...libraryModule(moduleRef, mathRef).store },
  }
}

export const cases = {
  /**
   * Node `decay_valued`'s math has initial values x = 1.5 and k = 0.5, and its rows values of their own:
   * k = 3, and x = 2 referenced Jones1999, which is the state's initial value.
   */
  mathInitialValues: () =>
    decayNode('decay_valued', [
      row('t', 'second', 'variable'),
      row('x', 'metre', 'variable', '2', { data_reference: 'Jones1999' }),
      row('k', 'per_second', 'constant', '3', { data_reference: 'Smith2001' }),
    ]),

  /** Node `decay_blank`'s rows are blank, so they fall back to its math's x = 1.5 and k = 0.5. */
  blankRows: () =>
    decayNode('decay_blank', [
      row('t', 'second', 'variable'),
      row('x', 'metre', 'variable'),
      row('k', 'per_second', 'constant', '  '),
    ]),

  /**
   * Node `decay_global`'s k is a global constant whose stored value is blank, so it falls back to the math's
   * 0.5. Its math sets `g` too, which the store's globalConstants values as 9.81.
   */
  blankGlobalConstant: () => {
    const xml = component(
      'decay_global',
      [
        ['t', 'second'],
        ['x', 'metre', '1.5'],
        ['k', 'per_second', '0.5'],
        ['g', 'per_second', '1'],
      ],
      `    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><times/><apply><minus/><apply><plus/><ci>k</ci><ci>g</ci></apply></apply><ci>x</ci></apply></apply>
    </math>`
    )
    const part = decayNode(
      'decay_global',
      [
        row('t', 'second', 'variable'),
        row('x', 'metre', 'variable'),
        row('k', 'per_second', 'global_constant', null),
        row('g', 'per_second', 'global_constant', null),
      ],
      xml
    )
    part.store.globalConstants = [
      ['k', { value: '', units: 'per_second', data_reference: 'Smith2001' }],
      ['g', { value: '9.81', units: 'per_second', data_reference: 'known' }],
    ]
    return part
  },
}
