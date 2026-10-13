// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { RUN_SEDML_MODEL, buildRunSedml } from '../../../../src/services/export/runSedml.js'
import { SERIES_COLOURS } from '../../../../src/services/simulation/seriesSlots.js'

const SETTINGS = { solver: 'CVODE', tolerance: 1e-7, maxSteps: 500, timeStep: 0.01, initialPoint: 0, startingPoint: 0, endingPoint: 2, pointInterval: 0.5 }
const VOI = { name: 'm/t', unit: 'second' }
const GROUPS = [
  { id: 'g1', name: 'Voltage', xAxis: null },
  { id: 'g2', name: 'Phase', xAxis: { name: 'a/x', label: 'a/x', unit: 'mV' } },
  { id: 'g3', name: 'Empty', xAxis: null },
]
const TRACES = [
  { name: 'a/x', label: 'a/x', unit: 'mV', groupId: 'g1' },
  { name: 'b/x', label: 'b/x', unit: 'mV', groupId: 'g1' },
  { name: 'a/y', label: 'a/y', unit: 'mA', groupId: 'g2' },
]

/** Parses the SED-ML written. */
const parse = (text) => new DOMParser().parseFromString(text, 'application/xml')
/** Gives an element's attributes. */
const attributesOf = (element) => Object.fromEntries([...element.attributes].map(({ name, value }) => [name, value]))

describe('buildRunSedml', () => {
  it('runs the model’s time course with its solver, on the model it runs', () => {
    const document = parse(buildRunSedml({ settings: SETTINGS, isSteadyState: false, voi: VOI, groups: GROUPS, traces: TRACES }))
    expect(attributesOf(document.querySelector('model'))).toMatchObject({ id: 'model', source: RUN_SEDML_MODEL, language: 'urn:sedml:language:cellml.2_0' })
    expect(attributesOf(document.querySelector('uniformTimeCourse'))).toMatchObject({ initialTime: '0', outputStartTime: '0', outputEndTime: '2', numberOfSteps: '4' })
    expect(document.querySelector('uniformTimeCourse algorithm').getAttribute('kisaoID')).toBe('KISAO:0000019')
    expect(attributesOf(document.querySelector('task'))).toEqual({ id: 'task', modelReference: 'model', simulationReference: 'sim' })
  })

  it('plots each plot with lines, against the variable of integration or its own variable, in the results view’s colours', () => {
    const document = parse(buildRunSedml({ settings: SETTINGS, isSteadyState: false, voi: VOI, groups: GROUPS, traces: TRACES }))
    const plots = [...document.querySelectorAll('plot2D')]
    // A plot without lines is left out.
    expect(plots.map((plot) => plot.getAttribute('name'))).toEqual(['Voltage', 'Phase'])
    expect(plots.map((plot) => plot.querySelector('xAxis').getAttribute('name'))).toEqual(['m/t (second)', 'a/x (mV)'])
    // Lines of one unit name the plot with it; one line names its axis itself.
    expect(plots.map((plot) => plot.querySelector('yAxis').getAttribute('name'))).toEqual(['Voltage (mV)', 'a/y (mA)'])

    // One data generator a variable, however many plots show it.
    const generators = new Map([...document.querySelectorAll('dataGenerator')].map((generator) => [generator.querySelector('variable').getAttribute('target'), generator.id]))
    const target = (name) => `/cellml:model/cellml:component[@name='${name.split('/')[0]}']/cellml:variable[@name='${name.split('/')[1]}']`
    expect([...generators.keys()]).toEqual([target('m/t'), target('a/x'), target('b/x'), target('a/y')])
    const curves = [...document.querySelectorAll('curve')].map(attributesOf)
    expect(curves.map(({ xDataReference, yDataReference, style }) => [xDataReference, yDataReference, style])).toEqual([
      [generators.get(target('m/t')), generators.get(target('a/x')), 'style0'],
      [generators.get(target('m/t')), generators.get(target('b/x')), 'style1'],
      [generators.get(target('a/x')), generators.get(target('a/y')), 'style0'],
    ])
    const colours = [...document.querySelectorAll('style')].map((style) => [style.id, style.querySelector('line').getAttribute('color')])
    expect(colours).toEqual([
      ['style0', SERIES_COLOURS.light[0].slice(1).toUpperCase()],
      ['style1', SERIES_COLOURS.light[1].slice(1).toUpperCase()],
    ])
    expect([...document.querySelectorAll('report dataSet')].map((dataSet) => dataSet.getAttribute('label'))).toEqual(['m/t', 'a/x', 'b/x', 'a/y'])
  })

  it('gives a time course KINSOL for its algebraic loops, where libOpenCOR reads it, only when it has some', () => {
    const run = (needsNlaSolver) => parse(buildRunSedml({ settings: SETTINGS, isSteadyState: false, needsNlaSolver, voi: VOI, groups: GROUPS, traces: TRACES }))
    const nla = run(true).querySelector('uniformTimeCourse > nlaAlgorithm')
    expect(nla.namespaceURI).toBe('https://opencor.ws/libopencor')
    expect(nla.getAttribute('kisaoID')).toBe('KISAO:0000282')
    expect(run(false).querySelector('uniformTimeCourse > nlaAlgorithm')).toBeNull()
  })

  it('solves a steady state once, reporting its values with nothing to plot them over', () => {
    const document = parse(buildRunSedml({ settings: SETTINGS, isSteadyState: true, voi: { name: '', unit: '' }, groups: GROUPS, traces: TRACES }))
    expect(document.querySelector('steadyState').id).toBe('sim')
    // KINSOL, which solves any algebraic loops, as SED-ML gives every simulation an algorithm.
    expect(document.querySelector('steadyState > algorithm').getAttribute('kisaoID')).toBe('KISAO:0000282')
    expect(document.querySelector('uniformTimeCourse')).toBeNull()
    expect(document.querySelectorAll('plot2D')).toHaveLength(0)
    expect([...document.querySelectorAll('report dataSet')].map((dataSet) => dataSet.getAttribute('label'))).toEqual(['a/x', 'b/x', 'a/y'])
  })
})
