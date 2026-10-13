/**
 * Document event listeners that listen only while their kept-alive view is shown, so another page's keys and pointer
 * never reach a hidden view.
 */
import { onActivated, onDeactivated, onMounted, onUnmounted } from 'vue'

/**
 * Listens on the document while the calling view is mounted and shown.
 *
 * @param {Object<string, Function>} listeners - Each handler, by event name.
 */
export function useActiveDocumentListeners(listeners) {
  let isListening = false

  /** Starts listening, unless already. */
  const attach = () => {
    if (isListening) return
    for (const [event, handler] of Object.entries(listeners)) document.addEventListener(event, handler)
    isListening = true
  }

  /** Stops listening, unless already stopped. */
  const detach = () => {
    if (!isListening) return
    for (const [event, handler] of Object.entries(listeners)) document.removeEventListener(event, handler)
    isListening = false
  }

  // A kept-alive view is activated as it mounts too; the flag keeps that from listening twice.
  onMounted(attach)
  onActivated(attach)
  onDeactivated(detach)
  onUnmounted(detach)
}
