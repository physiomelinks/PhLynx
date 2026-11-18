import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computed, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { analyseSteadyState } from '../../../../src/services/steadyState/steadyState'
import { annotatedVariables, createSteadyStateLibrary } from '../../../../src/services/steadyState/steadyStateLibrary'
import { analyzeMathXml } from '../../../../src/services/math/analyzeMath'
import { extractUnitDefinitions } from '../../../../src/utils/units'

const xml = readFileSync(resolve(__dirname, '../../fixtures/steadyState/glut2.cellml'), 'utf8')
const MATH_REF = 'glut2.cellml:glut2'

function library({ sidecarText = null, sidecar = null } = {}) {
  const annotations = ref(sidecarText)
  return {
    annotations,
    lib: createSteadyStateLibrary({
      availableMath: ref(new Map([[MATH_REF, xml]])),
      getMathDefaults: () => new Map([['q_E1_E1', '0.25'], ['q_E2_E2', '0.25'], ['q_E3_E3', '0.25'], ['q_E4_E4', '0.25']]),
      getMathAnalysis: () => analyzeMathXml(xml),
      unitDefinitions: computed(() => extractUnitDefinitions(xml)),
      getModuleAnnotations: () => annotations.value,
      ensureModuleAnnotations: async () => sidecar,
      analyse: async (options) => analyseSteadyState(options),
    }),
  }
}

describe('the steady-state library', () => {
  it('lists the variables a side-car names', () => {
    expect(annotatedVariables({ variables: [{ variable: 'v_R3' }, { variable: 'q_Ao_Ao' }, { variable: 'v_R3' }] })).toEqual(['v_R3', 'q_Ao_Ao'])
    expect(annotatedVariables(null)).toEqual([])
  })

  it('keeps the fluxes the module’s annotations name, at their steady state', async () => {
    const { lib } = library({ sidecarText: '# annotated', sidecar: { variables: [{ variable: 'v_R3' }, { variable: 'q_Ao_Ao' }] } })
    const entry = await lib.ensureSteadyState(MATH_REF)
    expect(entry.status).toBe('ready')
    expect(entry.xml).toContain('name="v_R3"')
    expect(entry.xml).not.toContain('name="v_R1"')
    // The held glucose's rate uses the kept flux
    expect(entry.analysis.stateVariables).toBeDefined()
  })

  it('derives again when the annotations change', async () => {
    const { lib, annotations } = library({ sidecarText: 'a', sidecar: { variables: [] } })
    const first = await lib.ensureSteadyState(MATH_REF)
    expect(lib.getSteadyState(MATH_REF)).toBe(first)
    annotations.value = 'b'
    expect(lib.getSteadyState(MATH_REF)).toBeNull()
  })

  it('names the instances whose steady state can’t be derived', async () => {
    const { lib } = library()
    const node = { id: 'n', data: { name: 'other', mathRef: 'missing.cellml:x', kinetics: 'steady' } }
    await expect(lib.ensureInstanceMath([node])).rejects.toThrow(/"other"/)
  })
})
