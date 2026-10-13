/**
 * Shows or hides the floating simulation viewer, a small window of the results that stays over the canvas
 * while the model is edited. WorkspaceArea shows it, and says how to return to the Simulation tab and how to hide the
 * sidebar, which floating the results does to give the canvas room.
 */
import { reactive } from 'vue'

const state = reactive({ visible: false })
let showSimulationTab = () => {}
let collapseSidebar = () => {}

/**
 * Gives the viewer's shared state, and ways to show, hide or leave it.
 *
 * @returns {{state: {visible: boolean}, toggle: Function, returnToTab: Function, setTabOpener: Function,
 *   setSidebarCollapser: Function}}
 */
export function useFloatingViewer() {
  return {
    state,
    /**
     * Shows the viewer, or hides it, leaving the sidebar as it is.
     *
     * @param {{isCollapsingSidebar?: boolean}} [options] - Whether showing it hides the sidebar, as floating the
     *   sidebar's own results does.
     */
    toggle: ({ isCollapsingSidebar = true } = {}) => {
      state.visible = !state.visible
      if (state.visible && isCollapsingSidebar) collapseSidebar()
    },
    /** Closes the viewer and shows the Simulation tab, opening the sidebar if need be. */
    returnToTab: () => {
      state.visible = false
      showSimulationTab()
    },
    /**
     * Says how to show the Simulation tab.
     *
     * @param {Function} opener
     */
    setTabOpener: (opener) => (showSimulationTab = opener),
    /**
     * Says how to hide the sidebar.
     *
     * @param {Function} collapser
     */
    setSidebarCollapser: (collapser) => (collapseSidebar = collapser),
  }
}
