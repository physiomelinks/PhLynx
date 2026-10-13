/**
 * Writes a run of the model as SED-ML (Level 1 Version 4), as a record of PhLynx's own run: the time course over its
 * variable of integration, or a steady state's single solve, with the results view's plots and a report of what they
 * show.
 */
import { buildUniformTimeCourse, formatSedNumber } from '../simulation/sedParameters'
import { SERIES_COLOURS, SLOT_COUNT } from '../simulation/seriesSlots'
import {
  CELLML_NAMESPACE,
  SEDML_NAMESPACE,
  algorithmElement,
  ci,
  element,
  kinsolElement,
  math,
  style,
  variable,
  withUnit,
  writeColour,
  writeDocument,
} from './sedmlXml'

/** The model the SED-ML runs: the scope as it ran, with the sliders' values. */
export const RUN_SEDML_MODEL = 'model.cellml'

const MODEL_ID = 'model'
const TASK_ID = 'task'

/**
 * Names a plot's y axis by what it shows: its one variable, or the plot with the unit its variables share.
 *
 * @param {string} name - The plot's.
 * @param {Array<{label: string, unit: string}>} items
 * @returns {string}
 */
function yAxisName(name, items) {
  if (items.length === 1) return withUnit(items[0].label, items[0].unit)
  const units = [...new Set(items.map(({ unit }) => unit ?? ''))]
  return units.length === 1 ? withUnit(name, units[0]) : name
}

/**
 * Builds the SED-ML of a run, with its plots and a report of them.
 *
 * @param {Object} options
 * @param {Object} options.settings - The run's simulation settings.
 * @param {boolean} options.isSteadyState - The model has no ODEs, so it is solved once, with nothing to plot over.
 * @param {boolean} [options.needsNlaSolver] - The model has algebraic loops, which KINSOL solves alongside its ODEs.
 * @param {{name: string, unit: string}} options.voi - The variable of integration, by reported name.
 * @param {Array<{id: string, name: string, xAxis?: {name: string, label: string, unit: string}|null}>} options.groups -
 *   The plots, in order, with the variable a plot is against in place of the variable of integration.
 * @param {Array<{name: string, label: string, unit: string, groupId: string}>} options.traces - Reported names.
 * @returns {string} The SED-ML document.
 */
export function buildRunSedml({ settings, isSteadyState, needsNlaSolver = false, voi, groups, traces }) {
  let simulation
  if (isSteadyState) {
    // A single solve, with no course to set. KINSOL solves any algebraic loops; SED-ML asks for an algorithm anyway.
    simulation = element('steadyState', { id: 'sim' }, [kinsolElement()])
  } else {
    const timeCourse = buildUniformTimeCourse(settings)
    simulation = element(
      'uniformTimeCourse',
      {
        id: 'sim',
        initialTime: formatSedNumber(timeCourse.initialTime),
        outputStartTime: formatSedNumber(timeCourse.outputStartTime),
        outputEndTime: formatSedNumber(timeCourse.outputEndTime),
        numberOfSteps: String(timeCourse.numberOfSteps),
      },
      [algorithmElement(settings), needsNlaSolver && kinsolElement('nlaAlgorithm')]
    )
  }

  // A data generator for each variable shown, however many plots show it.
  const dataGenerators = new Map()
  /** Gives the data generator of a variable, adding it the first time. */
  const dataGeneratorOf = (name, label) => {
    if (!dataGenerators.has(name)) {
      const id = `dg${dataGenerators.size}`
      dataGenerators.set(name, { id, name: label, element: element('dataGenerator', { id, name: label }, [math(ci('v')), element('listOfVariables', {}, [variable('v', name, TASK_ID)])]) })
    }
    return dataGenerators.get(name).id
  }

  // A steady state's values aren't over anything, so they're only reported.
  const outputs = []
  const usedSlots = new Set()
  if (!isSteadyState) {
    groups.forEach((group, g) => {
      const items = traces.filter((trace) => trace.groupId === group.id)
      if (!items.length) return
      const x = group.xAxis ?? { name: voi.name, label: voi.name, unit: voi.unit }
      const xReference = dataGeneratorOf(x.name, x.label)
      outputs.push(
        element('plot2D', { id: `plot${g}`, name: group.name, legend: 'true' }, [
          element('xAxis', { type: 'linear', name: withUnit(x.label, x.unit) }),
          element('yAxis', { type: 'linear', name: yAxisName(group.name, items) }),
          element(
            'listOfCurves',
            {},
            items.map((item, position) => {
              // In the colours the results view gives a plot's lines, in order.
              const slot = position % SLOT_COUNT
              usedSlots.add(slot)
              return element('curve', {
                id: `c${g}_${position}`,
                name: item.label,
                style: `style${slot}`,
                xDataReference: xReference,
                yDataReference: dataGeneratorOf(item.name, item.label),
              })
            })
          ),
        ])
      )
    })
  }
  traces.forEach((trace) => dataGeneratorOf(trace.name, trace.label))
  const reported = [...dataGenerators.values()]
  outputs.push(
    element('report', { id: 'report' }, [
      element(
        'listOfDataSets',
        {},
        reported.map(({ id, name }) => element('dataSet', { id: `ds_${id}`, label: name, dataReference: id }))
      ),
    ])
  )

  const styles = [...usedSlots]
    .sort((a, b) => a - b)
    .map((slot) => style(`style${slot}`, { line: { type: 'solid', color: writeColour(SERIES_COLOURS.light[slot]) } }))

  const document = element('sedML', { xmlns: SEDML_NAMESPACE, 'xmlns:cellml': CELLML_NAMESPACE, level: '1', version: '4' }, [
    element('listOfModels', {}, [element('model', { id: MODEL_ID, language: 'urn:sedml:language:cellml.2_0', source: RUN_SEDML_MODEL })]),
    element('listOfSimulations', {}, [simulation]),
    element('listOfTasks', {}, [element('task', { id: TASK_ID, modelReference: MODEL_ID, simulationReference: 'sim' })]),
    element('listOfDataGenerators', {}, reported.map(({ element: generator }) => generator)),
    element('listOfOutputs', {}, outputs),
    element('listOfStyles', {}, styles),
  ])
  return writeDocument(document)
}
