/**
 * Asks for super-modules' circulatory_autogen identities, all at once, before a native CA export writes them (see
 * services/export/caNative.js). CaIdentityDialog shows the question: its answer names them, exports them flat, or
 * cancels the export.
 */
import { shallowRef } from 'vue'

// One prompt for the app, shared by every caller.
const question = shallowRef(null)
let respond = null

/**
 * Gives the identity prompt.
 *
 * @returns {{question: import('vue').ShallowRef<Object|null>, ask: Function, answer: Function}}
 */
export function useCaIdentityPrompt() {
  /**
   * Asks for the identities of some super-modules.
   *
   * @param {Array<Object>} requests - From caIdentityRequests: `{smId, name, reason, from?, suggestion}` each.
   * @param {(identities: Map<string, Object>) => Map<string, string|null>} problemsOf - Why each identity, by smId,
   *   can't be its super-module's, or null.
   * @returns {Promise<Map<string, {module_type: string, module_subtype: string}>|null>} The identities by smId, empty
   *   to export them flat; null when the export is cancelled.
   */
  function ask(requests, problemsOf) {
    respond?.(null)
    return new Promise((resolve) => {
      respond = resolve
      question.value = { requests, problemsOf }
    })
  }

  /**
   * Answers the question asked.
   *
   * @param {Map<string, {module_type: string, module_subtype: string}>|null} identities - Empty to export flat, null to
   *   cancel.
   */
  function answer(identities) {
    const resolve = respond
    respond = null
    question.value = null
    resolve?.(identities)
  }

  return { question, ask, answer }
}
