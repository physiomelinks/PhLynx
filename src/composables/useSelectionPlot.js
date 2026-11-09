/**
 * The physiological view's selection plot: what the selected instances' annotations say to plot (see
 * services/bioView/autoPlot.js), as a plot config of its own. Never saved: the workspace's plots are untouched.
 */
import { computed, unref } from 'vue'

import { useAppSettings } from './useAppSettings'
import { SELECTION_PLOT_LIMIT, buildSelectionPlot } from '../services/bioView/autoPlot'
import { resolveBioRole } from '../services/bioView/roles'
import { locationSource } from '../services/annotations/locationSources'
import { useLibraryStore } from '../stores/libraryStore'
import { useViewModeStore } from '../stores/viewModeStore'

/** A plot config with nothing on it, so the charts never fall back to the workspace's plots. */
const EMPTY_CONFIG = Object.freeze({ groups: [], selections: [] })

/**
 * Follows the canvas selection while the physiological view is shown and auto-plot is on.
 *
 * @param {import('vue').Ref<Array<Object>>} nodes - The diagram's nodes, whose `selected` the physiological view sets.
 * @returns {{ isShown: import('vue').ComputedRef<boolean>, isOn: import('vue').ComputedRef<boolean>,
 *   setOn: (value: boolean) => void, plotConfig: import('vue').ComputedRef<Object>,
 *   hint: import('vue').ComputedRef<string|null>, note: import('vue').ComputedRef<string|null>}}
 *   `isShown` while the physiological view is; `hint` says why nothing is plotted, `note` that some is left out.
 */
export function useSelectionPlot(nodes) {
  const viewMode = useViewModeStore()
  const libraryStore = useLibraryStore()
  const { settings, saveAppSettings } = useAppSettings()

  const isShown = computed(() => viewMode.isBio)
  const isOn = computed(() => isShown.value && settings.autoPlotSelection)
  const selected = computed(() => (isOn.value ? unref(nodes).filter((node) => node.selected) : []))

  const sidecarOf = (node) => (node.data?.mathRef ? libraryStore.getParsedModuleAnnotations(node.data.mathRef) : null)
  const plot = computed(() => {
    if (!selected.value.length) return null
    return buildSelectionPlot(selected.value, {
      roleOf: (node) => {
        const sidecar = sidecarOf(node)
        return resolveBioRole(node.data, { sidecar, worked: locationSource().workedRole(node, { sidecar }) }).role
      },
      sidecarOf,
    })
  })

  const plotConfig = computed(() => plot.value?.plotConfig ?? EMPTY_CONFIG)

  const hint = computed(() => {
    if (!isOn.value) return null
    if (!plot.value) return 'Select a protein, compartment or membrane to plot it.'
    if (!plot.value.total) {
      const names = plot.value.unannotated
      const what = names.length === 1 ? names[0] : 'The selection'
      return `${what} has no annotated flows, concentrations, amounts or potential to plot.`
    }
    return null
  })

  const note = computed(() => {
    const total = plot.value?.total ?? 0
    return total > SELECTION_PLOT_LIMIT ? `Showing the first ${SELECTION_PLOT_LIMIT} of ${total} variables.` : null
  })

  /** Turns auto-plot on or off, remembered with the app's settings. */
  const setOn = (value) => saveAppSettings({ autoPlotSelection: !!value })

  return { isShown, isOn, setOn, plotConfig, hint, note }
}
