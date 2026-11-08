import { beforeAll, describe, expect, it } from 'vitest'

import { buildInstance } from '../../../src/services/import/buildWorkflow.js'
import { analyzeMathXml } from '../../../src/services/math/analyzeMath.js'
import { isModuleConfig, librarySignatures, moduleConfigEntry, configSignature, portEditConfig } from '../../../src/services/moduleConfig.js'
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

  describe('portEditConfig', () => {
    const library = () => ({ availableModules: new Map([[MODULE.moduleRef, MODULE]]), getMathAnalysis: () => analysis })
    const node = (id) => ({ id, data: { ...structuredClone(dropped), name: id } })
    let nodes
    const relabelled = [{ ...MODULE.ports[0], label: 'q', _uid: 'a_1' }]

    beforeAll(() => {
      nodes = [node('a'), node('b')]
    })

    it('asks when the ports no longer match a module others use', () => {
      expect(portEditConfig(nodes[0], relabelled, nodes, library())).toEqual({
        prompt: { moduleRef: MODULE.moduleRef, otherCount: 1, canUpdate: true },
      })
    })

    it('asks about a library module even when no other instance uses it', () => {
      expect(portEditConfig(nodes[0], relabelled, [nodes[0]], library())).toEqual({
        prompt: { moduleRef: MODULE.moduleRef, otherCount: 0, canUpdate: true },
      })
    })

    it('updates a config the instance made, and alone uses, without asking', () => {
      const owned = { ...MODULE, source: { kind: 'instance', nodeId: 'a' } }
      expect(portEditConfig(nodes[0], relabelled, [nodes[0]], library(), owned)).toEqual({ action: 'update' })
    })

    it('asks about a config the instance made once another instance uses it', () => {
      const owned = { ...MODULE, source: { kind: 'instance', nodeId: 'a' } }
      expect(portEditConfig(nodes[0], relabelled, nodes, library(), owned)).toEqual({
        prompt: { moduleRef: MODULE.moduleRef, otherCount: 1, canUpdate: true },
      })
    })

    it('asks about a config another instance made', () => {
      const theirs = { ...MODULE, source: { kind: 'instance', nodeId: 'b' } }
      expect(portEditConfig(nodes[0], relabelled, [nodes[0]], library(), theirs)).toHaveProperty('prompt')
    })

    it('leaves the module alone when only the ports’ ids change', () => {
      const ports = dropped.ports.map((port, index) => ({ ...port, _uid: `a_${index}` }))
      expect(portEditConfig(nodes[0], ports, nodes, library())).toBeNull()
    })

    it('leaves the module alone when the edit makes the instance its module’s again', () => {
      const drifted = { id: 'a', data: { ...structuredClone(dropped), ports: relabelled } }
      expect(portEditConfig(drifted, MODULE.ports, nodes, library())).toBeNull()
    })

    it('checks a deleted port against the module as an earlier choice left it', () => {
      const updated = { ...MODULE, ports: [] }
      expect(portEditConfig(nodes[0], [], nodes, library())).not.toBeNull()
      expect(portEditConfig(nodes[0], [], nodes, library(), updated)).toBeNull()
    })

    it('needs a module', () => {
      expect(portEditConfig({ id: 'a', data: { ...dropped, moduleRef: 'none:x' } }, [], nodes, library())).toBeNull()
    })
  })

  it("names the library module's default parameter set, which the signature leaves out", () => {
    const library = { availableModules: new Map([[MODULE.moduleRef, { ...MODULE, defaultParameterisation: 'slow' }]]) }
    const entry = moduleConfigEntry(dropped, library)
    expect(entry.default_parameterisation).toBe('slow')
    expect(moduleConfigEntry({ ...dropped, defaultParameterisation: 'fast' }, library).default_parameterisation).toBe('fast')
    expect(configSignature(entry)).toBe(configSignature(moduleConfigEntry(dropped)))
    expect(isModuleConfig(dropped, { ...MODULE, defaultParameterisation: 'slow' }, analysis)).toBe(true)
  })
})
