/**
 * Opens the Simulation Settings dialog from anywhere, such as the Simulation tab's cog or the instance
 * editor, without passing events up through the components between. WorkspaceArea shows the dialog.
 */
import { reactive } from 'vue'

const state = reactive({ visible: false, section: null })

/**
 * Gives the dialog's shared state, and a way to open it.
 *
 * @returns {{state: {visible: boolean, section: string|null}, open: Function}}
 */
export function useSimSettingsDialog() {
  /**
   * Opens the dialog, scrolled to a section when given one: 'time', 'parameters' (the solver), 'plots' or
   * 'sliders'.
   *
   * @param {string} [section]
   */
  function open(section = null) {
    state.section = section
    state.visible = true
  }

  return { state, open }
}
