import { beforeAll, describe, expect, it } from 'vitest'

import { analyzeMathXml } from '../../../src/services/math/analyzeMath.js'
import { isModuleConfig } from '../../../src/services/moduleConfig.js'
import { replacementData, retainedPorts } from '../../../src/services/moduleReplacement.js'
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

const MODULE = {
  moduleRef: 'decay:base',
  mathRef: 'file:decay',
  ports: [{ label: 'p', portType: 'general_ports', variables: ['x'] }],
  variables: [{ name: 'x', value: null, units: 'metre', access: 'access', type: 'variable' }],
}

const OLD_PORTS = [
  { _uid: 'a', label: 'rate', portType: 'general_ports', variables: ['k'] },
  { _uid: 'b', label: 'p', portType: 'entrance_ports', variables: ['k'] },
  { _uid: 'c', label: 'same', portType: 'exit_ports', variables: ['x'] },
  { _uid: 'd', label: 'gone', portType: 'general_ports', variables: ['k', 'v'] },
]

describe('moduleReplacement', () => {
  let analysis

  beforeAll(async () => {
    await ensureLibCellmlReady()
    analysis = analyzeMathXml(XML)
  })

  it('keeps old ports whose variables exist, unless they repeat a new port by label or variables', () => {
    const kept = retainedPorts(OLD_PORTS, MODULE.ports, new Set(['t', 'x', 'x0', 'k']))
    expect(kept.map((port) => port.label)).toEqual(['rate'])
  })

  it('gives the instance the new module ports, matching the module, when nothing is retained', () => {
    const data = replacementData(OLD_PORTS, MODULE, { analysis })
    expect(data.moduleRef).toBe('decay:base')
    expect(data.mathRef).toBe('file:decay')
    expect(data.ports).toEqual(MODULE.ports)
    expect(data.variables.map((row) => row.name)).toEqual(expect.arrayContaining(['x', 'k']))
    expect(isModuleConfig(data, MODULE, analysis)).toBe(true)
  })

  it('adds the retained old ports after the new module ports, without their per-node ids', () => {
    const data = replacementData(OLD_PORTS, MODULE, { retain: true, analysis })
    expect(data.ports).toEqual([...MODULE.ports, { label: 'rate', portType: 'general_ports', variables: ['k'] }])
    expect(data.variables.find((row) => row.name === 'k')).toBeTruthy()
  })

  it('checks retained ports against the module rows when the math is not analysed', () => {
    const data = replacementData(OLD_PORTS, MODULE, { retain: true })
    expect(data.ports).toEqual(MODULE.ports)
    expect(data.variables.map((row) => row.name)).toEqual(['x'])
  })
})
