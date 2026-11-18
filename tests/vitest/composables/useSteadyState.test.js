import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { computed, effectScope, nextTick, ref } from 'vue'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSteadyState } from '../../../src/composables/useSteadyState'
import { extractUnitDefinitions } from '../../../src/utils/units'

const xml = readFileSync(resolve(__dirname, '../fixtures/steadyState/glut2.cellml'), 'utf8')

describe('useSteadyState', () => {
  let scope
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => {
    scope?.stop()
    vi.useRealTimers()
  })

  function setUp(isActive) {
    scope = effectScope()
    return scope.run(() =>
      useSteadyState({ xml: ref(xml), rows: ref([]), unitDefinitions: computed(() => extractUnitDefinitions(xml)), isActive })
    )
  }

  it('waits until something shows the preview', async () => {
    const state = setUp(ref(false))
    await vi.advanceTimersByTimeAsync(400)
    expect(state.analysis.value).toBeNull()
  })

  it('derives the reduced math, with its sections and units', async () => {
    const state = setUp(ref(true))
    const reduced = await state.ready()
    expect(reduced.unresolved).toEqual([])
    expect(reduced.xml).toContain('name="v_ss"')
    expect(reduced.xml).toContain('name="q_tot"')
    expect(reduced.layout).not.toBeNull()
  })

  it('follows the setup, and goes back to the suggested one', async () => {
    const state = setUp(ref(true))
    await state.ready()
    state.spec.value = { ...state.analysis.value.spec, label: 'GLUT2' }
    await vi.advanceTimersByTimeAsync(400)
    await nextTick()
    await state.ready()
    expect(state.reduced.value.xml).toContain('name="v_GLUT2"')
    state.resetSpec()
    expect(state.spec.value).toBeNull()
  })
})

describe('useSteadyState buildModule', () => {
  it('builds a valid module with the values given', async () => {
    const { ensureLibCellmlReady } = await import('../helpers/libcellml-bootstrap.js')
    const { instance: libcellml } = await ensureLibCellmlReady()
    const scope = effectScope()
    const state = scope.run(() =>
      useSteadyState({ xml: ref(xml), rows: ref([]), unitDefinitions: computed(() => extractUnitDefinitions(xml)), isActive: ref(true) })
    )
    await state.ready()
    const built = state.buildModule('glut2_ss', { q_tot: 0.004, kappa_R1: 0.36, K_E1_E1: 33.2 })
    scope.stop()
    expect(built.error).toBeUndefined()
    expect(built.xml).toContain('<component name="glut2_ss"')
    expect(built.xml).toMatch(/name="q_tot"[^>]*initial_value="0.004"/)
    expect(built.xml).toMatch(/name="kappa_R1"[^>]*initial_value="0.36"/)

    // With the module's units, which its grouping keeps in the app, it is valid CellML
    const units = xml.match(/<units\b[\s\S]*?<\/units>/g).join('\n')
    const validator = new libcellml.Validator()
    validator.validateModel(new libcellml.Parser(false).parseModel(built.xml.replace(/(<model\b[^>]*>)/, `$1\n${units}`)))
    expect(Array.from({ length: validator.issueCount() }, (_, i) => validator.issue(i).description())).toEqual([])
  }, 60000)
})
