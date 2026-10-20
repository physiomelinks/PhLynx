import { beforeAll, describe, expect, it } from 'vitest'

import { buildInstance } from '../../../src/services/import/buildWorkflow.js'
import { analyzeMathXml } from '../../../src/services/math/analyzeMath.js'
import { isModuleConfig, librarySignatures, moduleConfigEntry, configSignature } from '../../../src/services/moduleConfig.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" initial_value="x0"/>
    <variable name="x0" units="metre" initial_value="1"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`

// Only the rows a CA config lists: the drop adds the rest.
const MODULE = {
  moduleRef: 'decay:base',
  mathRef: 'file:decay',
  ports: [{ label: 'p', portType: 'general_ports', variables: ['x', 'k'] }],
  variables: [
    { name: 'x', value: null, units: 'metre', access: 'access', type: 'variable' },
    { name: 'k', value: '0.5', units: 'per_second', access: 'access', type: 'boundary_condition' },
  ],
}

describe('moduleConfig', () => {
  let analysis
  let dropped

  beforeAll(async () => {
    await ensureLibCellmlReady()
    analysis = analyzeMathXml(XML)
    dropped = buildInstance('a', 'a', null, MODULE, [], null, analysis).data
  })

  const edit = (patch) => ({ ...structuredClone(dropped), ...patch })
  const editRow = (name, patch) =>
    edit({ variables: dropped.variables.map((row) => (row.name === name ? { ...row, ...patch } : row)) })

  it('matches an untouched drop and the module itself', () => {
    expect(dropped.variables.length).toBeGreaterThan(MODULE.variables.length)
    expect(isModuleConfig(dropped, MODULE, analysis)).toBe(true)
    expect(isModuleConfig(MODULE, MODULE, analysis)).toBe(true)
  })

  it('matches whatever the rows’ order and values', () => {
    const variables = [...dropped.variables].reverse().map((row) => ({ ...row, value: '9', data_reference: 'ref' }))
    expect(isModuleConfig(edit({ variables }), MODULE, analysis)).toBe(true)
  })

  it.each([
    ['a port label', () => edit({ ports: [{ ...MODULE.ports[0], label: 'q' }] })],
    ['a port’s variables', () => edit({ ports: [{ ...MODULE.ports[0], variables: ['x'] }] })],
    ['a multiport', () => edit({ ports: [{ ...MODULE.ports[0], multiportType: 'True' }] })],
    ['a row’s units', () => editRow('k', { units: 'per_minute' })],
    ['a row’s type', () => editRow('k', { type: 'constant' })],
    ['a row’s access', () => editRow('k', { access: 'no_access' })],
    ['the math', () => edit({ mathRef: 'file:other' })],
  ])('tells %s apart', (_, config) => {
    expect(isModuleConfig(config(), MODULE, analysis)).toBe(false)
  })

  it('needs a module', () => {
    expect(isModuleConfig(dropped, undefined, analysis)).toBe(false)
  })

  it('gives the library signatures of the drop and the module', () => {
    const library = { getMathAnalysis: () => analysis, getMathDefaults: () => new Map() }
    const signatures = librarySignatures(MODULE, library)
    expect(signatures).toContain(configSignature(moduleConfigEntry(dropped)))
    expect(signatures).toContain(configSignature(moduleConfigEntry(MODULE)))
  })
})
