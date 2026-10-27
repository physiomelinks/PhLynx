/**
 * A synthetic workspace at format 1.2.0. The solver settings are applied; a plot may show an inspection
 * module's output, a slider may have a label, and the settings may hold a sweep with a family of curves.
 * Written out literally rather than built with the app's helpers, so a change to those shows as a format change.
 */
import { edge, gain, instanceNode, libraryModule, mathEntry, port, row } from './builders.js'
import { base as base1_1_0, separatedDecayNode } from './v1-1-0.js'

export const version = '1.2.0'

/**
 * Builds the workspace around the cases.
 *
 * @returns {Object}
 */
export const base = () => {
  const doc = base1_1_0(version)
  doc.store.mathLayouts = []
  doc.simulation.simulationSettings = { ...doc.simulation.simulationSettings, tolerance: 1e-7, maxSteps: 500 }
  return doc
}

const INSPECTION_ID = 'inspection-total'

export const cases = {
  /**
   * A plot shows inspection module `total`'s output, as a selection whose nodeId is `inspection:<module id>`
   * and variableName the module's name. The module sums node `decay_inspected`'s x.
   */
  inspectionPlotSelection: () => ({
    ...separatedDecayNode('decay_inspected'),
    inspectionModules: [
      {
        id: INSPECTION_ID,
        name: 'total',
        units: 'metre',
        variables: [
          { key: 'decay_inspected::x', nodeId: 'decay_inspected', nodeName: 'decay_inspected', variableName: 'x', units: 'metre', sign: 1 },
        ],
        advanced: false,
        formula: null,
      },
    ],
    simulation: {
      plotConfig: (() => {
        const selection = {
          key: `inspection:${INSPECTION_ID}::total`,
          nodeId: `inspection:${INSPECTION_ID}`,
          nodeName: 'inspection_modules',
          variableName: 'total',
          units: 'metre',
          type: 'variable',
          plot: true,
          groupId: 'plot-1',
        }
        return {
          groups: [{ id: 'plot-1', name: 'Plot 1' }],
          groupedSelections: [{ id: 'plot-1', name: 'Plot 1', selections: [selection] }],
          selections: [selection],
        }
      })(),
    },
  }),

  /** Node `decay_scanned`'s k has a slider labelled `decay rate`, a CUFLynx params_for_id name_for_plotting. */
  parameterScanLabel: () => ({
    ...separatedDecayNode('decay_scanned'),
    simulation: {
      parameterScanConfig: {
        selections: [
          {
            key: 'decay_scanned::k',
            nodeId: 'decay_scanned',
            nodeName: 'decay_scanned',
            parameterName: 'k',
            selected: true,
            units: 'per_second',
            type: 'constant',
            min: 0.05,
            default: 0.5,
            max: 5,
            step: null,
            label: 'decay rate',
          },
        ],
      },
    },
  }),

  /** A sweep of node `decay_swept`'s k from 0.1 to 1 at 10 points, read at each curve's minimum, with a family of x_init curves. */
  sweepWithFamily: () => ({
    ...separatedDecayNode('decay_swept'),
    simulation: {
      simulationSettings: {
        sweep: {
          key: 'decay_swept::k',
          nodeId: 'decay_swept',
          nodeName: 'decay_swept',
          parameterName: 'k',
          units: 'per_second',
          type: 'constant',
          from: 0.1,
          to: 1,
          points: 10,
          readout: 'min',
          family: {
            key: 'decay_swept::x_init',
            nodeId: 'decay_swept',
            nodeName: 'decay_swept',
            parameterName: 'x_init',
            units: 'metre',
            type: 'constant',
            values: [1, 2],
          },
        },
      },
    },
  }),

  /**
   * Node `amplifier`'s out feeds node `follower`'s in through their `signal` ports, and the library holds a stub
   * of `amplifier:stub`, a module whose math isn't loaded.
   */
  coupledNodes: () => {
    const mathRef = (name) => `gain_modules.cellml:${name}`
    const signalOut = port('exit_ports', 'signal', ['out'])
    const signalIn = port('entrance_ports', 'signal', ['in'])
    const node = (name, ports, gainValue) =>
      instanceNode(name, name, {
        mathRef: mathRef(name),
        moduleRef: `${name}:gain`,
        ports,
        variables: [
          row('in', 'mM', name === 'follower' ? 'boundary_condition' : 'constant', '1'),
          row('out', 'mM', 'variable'),
          row('a', 'dimensionless', 'constant', gainValue),
        ],
      })
    const moduleVariables = [{ name: 'out', value: null, units: 'mM', access: 'access', type: 'variable', data_reference: null }]
    return {
      flow: {
        nodes: [node('amplifier', [signalOut], '2'), node('follower', [signalIn], '1')],
        edges: [edge('amplifier', 'follower', [{ sourcePort: signalOut, targetPort: signalIn }])],
      },
      store: {
        availableMath: [mathEntry(mathRef('amplifier'), gain('amplifier', 'a')), mathEntry(mathRef('follower'), gain('follower', 'a'))],
        availableModules: [
          ...libraryModule('amplifier:gain', mathRef('amplifier'), { ports: [signalOut], variables: moduleVariables }).store.availableModules,
          ...libraryModule('follower:gain', mathRef('follower'), { ports: [signalIn] }).store.availableModules,
          ...libraryModule('amplifier:stub', 'unloaded_modules.cellml:amplifier', { isStub: true }).store.availableModules,
        ],
        availableCollections: [
          [mathRef('amplifier'), ['amplifier:gain']],
          [mathRef('follower'), ['follower:gain']],
          ['unloaded_modules.cellml:amplifier', ['amplifier:stub']],
        ],
      },
    }
  },
}
