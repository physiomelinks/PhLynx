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
