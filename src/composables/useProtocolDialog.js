/**
 * Opens the Protocol dialog from anywhere, such as the Simulation tab's toolbar. WorkspaceArea shows the dialog.
 */
import { reactive } from 'vue'

const state = reactive({ visible: false })

/**
 * Gives the dialog's shared state, and a way to open it.
 *
 * @returns {{state: {visible: boolean}, open: Function}}
 */
export function useProtocolDialog() {
  /** Opens the dialog. */
  const open = () => (state.visible = true)
  return { state, open }
}
