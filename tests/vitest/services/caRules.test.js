import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const notified = vi.hoisted(() => ({ warning: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify: notified }))

import {
  caHeartInputs,
  checkHearts,
  heartEntranceSlot,
  isDeprecatedJunction,
  legacyFlowPortModules,
  newConfigEntries,
  warnLegacyConfigs,
  withoutZeroedIvcRows,
} from '../../../src/services/caRules.js'
import { applyParametersToNodes } from '../../../src/utils/parameters.js'

const readConfig = (name) => JSON.parse(readFileSync(`src/assets/module_configs/${name}`, 'utf8'))

/**
 * Makes a config entry with one entrance port.
 *
 * @param {string} type - `module_type:module_subtype`.
 * @param {Object} port
 * @returns {Object}
 */
function entry(type, port) {
  const [module_type, module_subtype] = type.split(':')
  return { module_type, module_subtype, entrance_ports: [port], exit_ports: [], general_ports: [] }
}

// The venous entrance as CA's own BG_modules_config.json ships it.
const LEGACY_VENOUS = entry('venous:vp', { port_type: 'vessel_port', variables: ['v_in', 'u'], multi_port: 'True' })

describe('isDeprecatedJunction', () => {
  it.each(['Min_junction', 'Nout_junction', 'MinNout_junction', 'Min_custom', 'my_Nout_junction'])('is true for %s', (type) => {
    expect(isDeprecatedJunction(type)).toBe(true)
  })

  it.each(['split_junction', 'merge_junction', 'venous_merge_junction', '2in2out_junction', 'artery_Min', 'vein_Noutlet'])(
    'is false for %s',
    (type) => {
      expect(isDeprecatedJunction(type)).toBe(false)
    }
  )
})

describe('legacyFlowPortModules', () => {
  it("lists a terminal, junction or venous type's flow port linked by a whole-port True", () => {
    const configs = [
      LEGACY_VENOUS,
      entry('my_terminal:pp', { port_type: 'flow_port', variables: ['v'], multi_port: true }),
      entry('arterial:vp', { port_type: 'vessel_port', variables: ['v_in', 'u'], multi_port: 'True' }),
      entry('venous:pp', { port_type: 'pressure_port', variables: ['u'], multi_port: 'True' }),
    ]
    expect(legacyFlowPortModules(configs)).toEqual(['venous:vp', 'my_terminal:pp'])
  })

  it('leaves the bundled venous configs out, as they sum their inflow', () => {
    const venous = readConfig('BG.json').filter((config) => config.module_type.startsWith('venous'))
    expect(legacyFlowPortModules(venous)).toEqual([])
  })

  it('leaves deprecated junctions to their own warning', () => {
    const junctions = readConfig('BG.json').filter((config) => isDeprecatedJunction(config.module_type))
    expect(junctions.length).toBeGreaterThan(0)
    expect(legacyFlowPortModules(junctions)).toEqual([])
  })
})

describe('warnLegacyConfigs', () => {
  beforeEach(() => vi.clearAllMocks())

  it('warns once about the junction types, and once about the legacy flow ports', () => {
    const junction = entry('Min_junction:vp', { port_type: 'vessel_port', variables: ['v_in_sum', 'u'], multi_port: 'True' })
    warnLegacyConfigs([junction, { ...junction, module_subtype: 'vv' }, LEGACY_VENOUS])

    expect(notified.warning).toHaveBeenCalledTimes(2)
    expect(notified.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Deprecated Junction Types', items: [expect.stringMatching(/^Min_junction is a /)] })
    )
    expect(notified.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Legacy Flow Ports', items: [expect.stringMatching(/^venous:vp links flow/)] })
    )
  })

  it('leaves the junction types out when asked', () => {
    warnLegacyConfigs([entry('Nout_junction:pv', { port_type: 'vessel_port', variables: ['v_out_sum', 'u'] })], { junctions: false })
    expect(notified.warning).not.toHaveBeenCalled()
  })

  it('warns about nothing for the bundled venous and heart configs', () => {
    warnLegacyConfigs([...readConfig('BG.json').filter((config) => config.module_type.startsWith('venous')), ...readConfig('heart.json')])
    expect(notified.warning).not.toHaveBeenCalled()
  })
})

describe('newConfigEntries', () => {
  const withFile = (config) => ({ ...config, component_file: 'BG.cellml' })

  it('lists the first entry of each ref the library lacks, as addConfigFile keeps a module it has', () => {
    const fresh = withFile(LEGACY_VENOUS)
    const files = [
      { payload: [withFile(entry('venous:bundled', {})), fresh, { ...LEGACY_VENOUS }] },
      { payload: [withFile({ ...LEGACY_VENOUS, entrance_ports: [] })] },
      { payload: null },
    ]
    const taken = new Set(['venous:bundled'])

    expect(newConfigEntries(files, (ref) => taken.has(ref))).toEqual([fresh])
  })

  it("lists a CA export's base entry once, before its variants, which add nothing more", () => {
    const base = withFile(entry('venous:vp', {}))
    const variant = (hash) => ({ ...withFile(entry(`venous:vp__${hash}`, {})), phlynx_base_subtype: 'vp' })
    const files = [{ payload: [variant('aaaaaaaa'), base, variant('bbbbbbbb')] }]

    expect(newConfigEntries(files, () => false)).toEqual([base])
  })

  it('lists a lone variant for the base ref it stands in for, unless the library holds that', () => {
    const variant = { ...withFile(entry('venous:vp__aaaaaaaa', {})), phlynx_base_subtype: 'vp' }

    expect(newConfigEntries([{ payload: [variant] }], () => false)).toEqual([variant])
    expect(newConfigEntries([{ payload: [variant] }], (ref) => ref === 'venous:vp')).toEqual([])
  })

  it('warns, through warnLegacyConfigs, about a config import of a Min_ junction and a terminal\'s True flow port', () => {
    vi.clearAllMocks()
    const imported = new Map([
      [
        'config.json',
        {
          payload: [
            withFile(entry('Min_junction:vp', { port_type: 'vessel_port', variables: ['v_in_sum', 'u'], multi_port: 'True' })),
            withFile(entry('terminal:pp', { port_type: 'vessel_port', variables: ['v_T', 'u'], multi_port: 'True' })),
          ],
        },
      ],
    ])

    warnLegacyConfigs(newConfigEntries(imported.values(), () => false))

    expect(notified.warning).toHaveBeenCalledTimes(2)
    expect(notified.warning).toHaveBeenCalledWith(expect.objectContaining({ title: 'Deprecated Junction Types' }))
    expect(notified.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Legacy Flow Ports', items: [expect.stringMatching(/^terminal:pp links flow/)] })
    )
  })
})

describe('withoutZeroedIvcRows', () => {
  it("keeps a two-input heart's ivc flow 0 against a parameters row, as CA deletes that parameter", () => {
    const heart = { id: '1', data: { name: 'heart', variables: [{ name: 'v_ivc', units: 'm3_per_s', type: 'boundary_condition', value: '0' }] } }
    const rows = [
      { variable_name: 'v_ivc_heart', units: 'm3_per_s', value: '5', data_reference: '' },
      { variable_name: 'v_ivc_other', units: 'm3_per_s', value: '5', data_reference: '' },
    ]

    const kept = withoutZeroedIvcRows(rows, ['heart'])

    expect(kept.map((row) => row.variable_name)).toEqual(['v_ivc_other'])
    expect(applyParametersToNodes([heart], kept).updated).toBe(0)
    expect(applyParametersToNodes([heart], withoutZeroedIvcRows(rows, [])).variablesById.get('1')[0].value).toBe('5')
  })
})

describe('heart slots', () => {
  it('gives the ivc, svc and pulmonary slots by place, two inputs being svc and pulmonary', () => {
    expect(['ivc', 'svc', 'pvn'].map((name) => heartEntranceSlot(['ivc', 'svc', 'pvn'], name))).toEqual([0, 1, 2])
    expect(['svc', 'pvn'].map((name) => heartEntranceSlot(['svc', 'pvn'], name))).toEqual([1, 2])
    expect(heartEntranceSlot(['svc', 'pvn'], 'other')).toBe(-1)
  })

  it('adds the pulmonary vein CA adds to a heart with fewer than two outputs', () => {
    expect(caHeartInputs(['svc'], 1)).toEqual(['svc', 'pvn'])
    expect(caHeartInputs(['svc'], 2)).toEqual(['svc'])
  })
})

describe('checkHearts', () => {
  const heart = (name, inputs) => ({ name, module_type: 'heart', inp_instances: inputs })

  it('accepts one heart with venous_ivc or venous_svc among its inputs', () => {
    expect(() => checkHearts([heart('heart', 'venous_svc pvn'), { name: 'v', module_type: 'venous' }])).not.toThrow()
    expect(() => checkHearts([])).not.toThrow()
  })

  it('fails on more than one heart', () => {
    expect(() => checkHearts([heart('a', 'venous_ivc'), heart('b', 'venous_ivc')])).toThrow('CA allows one heart module, but a, b are hearts.')
  })

  it('fails on a heart with neither venous input, by name as CA checks', () => {
    expect(() => checkHearts([heart('heart', 'ivc pvn')])).toThrow(/venous_ivc, venous_svc or both/)
  })

  it("ignores heart_effector modules, which aren't hearts", () => {
    expect(() => checkHearts([{ name: 'e', module_type: 'heart_effector', inp_instances: '' }])).not.toThrow()
  })
})
