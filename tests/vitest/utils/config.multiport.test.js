import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import {
  getVariableMultiportTypes,
  normaliseConfig,
  parseMultiport,
  restorePorts,
} from '../../../src/utils/config.js'
import { buildUsedPortKeys, checkAndClaimCouplings, resolvePortCouplings } from '../../../src/utils/edges.js'

// Module library (circulatory-autogen-modules) cardiac configs, renamed to PhLynx's config keys.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const cardiacConfigs = JSON.parse(
  readFileSync(path.resolve(__dirname, '../../resources/module_library/cardiac_modules_config.json'), 'utf8')
)
const configFor = (moduleType) => cardiacConfigs.find((c) => c.module_type === moduleType)

describe('parseMultiport', () => {
  it('is case-insensitive for whole-port values', () => {
    expect(parseMultiport('sum')).toBe('Sum')
    expect(parseMultiport('Sum')).toBe('Sum')
    expect(parseMultiport('SUM')).toBe('Sum')
    expect(parseMultiport('true')).toBe('True')
    expect(parseMultiport('True')).toBe('True')
    expect(parseMultiport(true)).toBe('True')
    expect(parseMultiport('multiply')).toBe('Multiply')
    expect(parseMultiport('False')).toBe('None')
    expect(parseMultiport(undefined)).toBe('None')
  })

  it('keeps a per-variable list as written, and normalises its entries on use', () => {
    const list = ['sum', 'True']
    const parsed = parseMultiport(list)
    expect(parsed).toEqual(['sum', 'True'])
    expect(parsed).not.toBe(list)
    expect(getVariableMultiportTypes({ label: 'p', variables: ['a', 'b'], multiportType: parsed })).toEqual([
      'Sum',
      'True',
    ])
  })

  it('rejects a malformed per-variable list', () => {
    expect(() => getVariableMultiportTypes({ label: 'p', variables: ['a'], multiportType: ['sum', 'True'] })).toThrow(
      /one entry per variable/
    )
    expect(() => getVariableMultiportTypes({ label: 'p', variables: ['a'], multiportType: ['Multiply'] })).toThrow(
      /must be "sum" or "True"/
    )
  })
})

describe('module configs with a per-variable multi_port', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('loads flow_merge and flow_split with their per-variable multiport ports', () => {
    const store = useLibraryStore()
    expect(store.addConfigFile('cardiac_modules_config.json', cardiacConfigs)).toBe(cardiacConfigs.length)

    const merge = store.availableModules.get('flow_merge:vp')
    expect(merge.mathRef).toBe('cardiac_modules.cellml:flow_merge_type')
    expect(merge.ports).toEqual([
      { portType: 'entrance_ports', label: 'vessel_port', variables: ['v_in', 'u'], multiportType: ['sum', 'True'] },
      { portType: 'exit_ports', label: 'vessel_port', variables: ['v_out', 'u_d'], multiportType: 'None' },
    ])

    const split = store.availableModules.get('flow_split:pv')
    expect(split.ports.find((p) => p.portType === 'exit_ports').multiportType).toEqual(['sum', 'True'])
  })

  it('writes the list form back unchanged', () => {
    for (const moduleType of ['flow_merge', 'flow_split', 'resistor']) {
      const config = configFor(moduleType)
      const restored = restorePorts(normaliseConfig(config).ports)
      expect(restored).toEqual({
        general_ports: config.general_ports,
        entrance_ports: config.entrance_ports,
        exit_ports: config.exit_ports,
      })
    }
  })

  it('keeps whole-port multiports as before', () => {
    const config = {
      module_type: 'm',
      module_subtype: 's',
      component_file: 'f.cellml',
      component_type: 'c',
      entrance_ports: [{ port_type: 'vessel_port', variables: ['q'], multi_port: 'Sum' }],
      exit_ports: [{ port_type: 'vessel_port', variables: ['v'] }],
      general_ports: [{ port_type: 'clock_port', variables: ['t'], multi_port: 'True' }],
      variables_and_units: [],
    }
    const module = normaliseConfig(config)
    expect(module.moduleRef).toBe('m:s')
    expect(module.mathRef).toBe('f.cellml:c')
    expect(module.ports.map((p) => p.multiportType)).toEqual(['True', 'Sum', 'None'])
    expect(restorePorts(module.ports)).toEqual({
      general_ports: config.general_ports,
      entrance_ports: config.entrance_ports,
      exit_ports: config.exit_ports,
    })
  })

  it('lets a per-variable multiport port take many connections', () => {
    const resistorPorts = normaliseConfig(configFor('resistor')).ports
    const mergePorts = normaliseConfig(configFor('flow_merge')).ports

    const used = new Set()
    const first = resolvePortCouplings(resistorPorts, mergePorts, 0, 0)
    const second = resolvePortCouplings(resistorPorts, mergePorts, 0, 1)
    expect(first).toHaveLength(1)
    expect(checkAndClaimCouplings('R1', 'merge', first, used).valid).toBe(true)
    expect(checkAndClaimCouplings('R2', 'merge', second, used).valid).toBe(true)
    expect(buildUsedPortKeys([{ source: 'R1', target: 'merge', data: { couplings: first } }]).size).toBe(1)

    // Control: a plain port still takes only one connection.
    const toR3 = resolvePortCouplings(mergePorts, resistorPorts, 0, 0)
    expect(checkAndClaimCouplings('merge', 'R3', toR3, used).valid).toBe(true)
    expect(checkAndClaimCouplings('R2', 'R3', resolvePortCouplings(resistorPorts, resistorPorts), used).valid).toBe(false)
  })
})
