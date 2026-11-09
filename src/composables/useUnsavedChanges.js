import { computed, shallowRef } from 'vue'
import { useFlowHistoryStore } from '../stores/historyStore'

/**
 * Unsaved workspace changes: whether there are any, a guard that asks before the page unloads with them, and the
 * workspace's save for panels outside the workspace view.
 */

// The workspace view's save, while it is mounted: { save, hasContent }.
const workspaceSaver = shallowRef(null)

/**
 * Lets panels outside the workspace view save it.
 *
 * @param {{ save: Function, hasContent: () => boolean }} saver
 * @returns {Function} Unregisters it.
 */
export function registerWorkspaceSaver(saver) {
  workspaceSaver.value = saver
  return () => {
    if (workspaceSaver.value === saver) workspaceSaver.value = null
  }
}

/** The registered save, when there is a workspace with something in it to save; else null. */
export const workspaceSave = computed(() => (workspaceSaver.value?.hasContent() ? workspaceSaver.value.save : null))

/**
 * Whether an unload would lose work: the workspace holds something, and has changed since it was saved or loaded.
 *
 * @param {{ hasContent: boolean, isAtSaved: boolean }} state
 * @returns {boolean}
 */
export const isUnloadGuarded = ({ hasContent, isAtSaved }) => hasContent && !isAtSaved

/**
 * Asks before the page unloads while a guard holds. The browser shows its own prompt.
 *
 * @param {() => boolean} isGuarded
 * @param {Object} [target=window]
 * @returns {Function} Removes the guard.
 */
export function installUnloadGuard(isGuarded, target = window) {
  const onBeforeUnload = (event) => {
    if (!isGuarded()) return
    event.preventDefault()
    // Older browsers show the prompt only for a returnValue.
    event.returnValue = ''
  }
  target.addEventListener('beforeunload', onBeforeUnload)
  return () => target.removeEventListener('beforeunload', onBeforeUnload)
}

/**
 * Whether the workspace has unsaved changes.
 *
 * @param {() => boolean} hasContent - Whether the workspace holds anything.
 * @returns {import('vue').ComputedRef<boolean>}
 */
export function useUnsavedChanges(hasContent) {
  const history = useFlowHistoryStore()
  return computed(() => isUnloadGuarded({ hasContent: hasContent(), isAtSaved: history.isAtSaved }))
}
