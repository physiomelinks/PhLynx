/**
 * In Selection mode, reruns the simulation once the user has finished choosing instances on the canvas, so
 * highlighting a model doesn't flatten it over and over:
 * - a plain click changes the selection and is done, so it runs;
 * - with Shift held, the user is still adding (clicking more, or dragging a selection box), so it waits for
 *   the pointer to come up, which ends that click or drag.
 *
 * Every view that shows results (the Simulation tab, the floating box) calls this; they share one timer,
 * so a change runs once however many are open.
 */
import { computed, onBeforeUnmount, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { useSimulation } from './useSimulation'
import { libopencor } from '../services/simulation/libopencorLoader'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { FLOW_IDS } from '../utils/constants'

// A short wait, so one click's selection events, and a pointer-up after its last change, run once.
const SETTLE_MS = 120
let timer = null
let isShiftHeld = false
let views = 0

/**
 * Notes whether Shift is held, from any key or pointer event.
 *
 * @param {KeyboardEvent|PointerEvent} event
 */
const trackShift = (event) => (isShiftHeld = event.shiftKey)
/** Forgets Shift when the window loses focus, as its keyup never comes. */
const releaseShift = () => (isShiftHeld = false)

/**
 * Runs the canvas selection once it is chosen; for views showing the results.
 *
 * @param {{isActive?: Function}} [options] - Whether the view is showing now; a view always mounted but not
 *   always shown, such as the floating box, says so.
 */
export function useSelectionAutoRun({ isActive = () => true } = {}) {
  const store = useSimulationResultsStore()
  const { run } = useSimulation()
  const { getSelectedNodes, userSelectionActive } = useVueFlow(FLOW_IDS.MAIN)
  const selectedIds = computed(() => getSelectedNodes.value.map((node) => node.id).sort())

  /** Runs the selection, unless it is mid-change, empty or what was last simulated. */
  function runIfChosen() {
    timer = null
    if (!isActive() || store.scopeMode !== 'selection' || userSelectionActive.value) return
    if (['unavailable', 'error', 'loading'].includes(libopencor.status)) return
    const ids = selectedIds.value
    const shown = store.scopeNodeIds ? [...store.scopeNodeIds].sort() : null
    if (!ids.length || JSON.stringify(ids) === JSON.stringify(shown)) return
    // A sweep of a model with ODEs runs a time course per point, too slow to follow the selection: play runs it.
    if (store.results?.isSweep && !store.results.isSteadyState) return
    run(ids).catch(console.error)
  }

  /** Runs shortly, once the events of this change are over. */
  function schedule() {
    clearTimeout(timer)
    if (isActive() && store.scopeMode === 'selection') timer = setTimeout(runIfChosen, SETTLE_MS)
  }

  // Without Shift, a change of selection is a finished choice.
  watch(
    () => selectedIds.value.join(','),
    () => !isShiftHeld && !userSelectionActive.value && schedule()
  )
  // With Shift, the pointer coming up ends the click or the box being dragged.
  const onPointerUp = (event) => {
    if (event.shiftKey || userSelectionActive.value) schedule()
  }

  if (views++ === 0) {
    window.addEventListener('keydown', trackShift, true)
    window.addEventListener('keyup', trackShift, true)
    window.addEventListener('pointerdown', trackShift, true)
    window.addEventListener('blur', releaseShift)
  }
  window.addEventListener('pointerup', onPointerUp, true)
  onBeforeUnmount(() => {
    window.removeEventListener('pointerup', onPointerUp, true)
    if (--views === 0) {
      window.removeEventListener('keydown', trackShift, true)
      window.removeEventListener('keyup', trackShift, true)
      window.removeEventListener('pointerdown', trackShift, true)
      window.removeEventListener('blur', releaseShift)
      clearTimeout(timer)
    }
  })
}
