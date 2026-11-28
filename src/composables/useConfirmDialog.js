import { reactive } from 'vue'
import { useConfirm } from 'primevue/useconfirm'

// export interface AppConfirmOptions {
//   message: string
//   header?: string
//   severity?: 'info' | 'success' | 'warning' | 'error'
//   acceptLabel?: string
//   rejectLabel?: string
//   isRejectDefault?: boolean // the reject button is the primary one, and focused
//   issues?: { key: string, message: string, elementId?: string, label?: string }[] // listed below the message
//   onIssue?: (issue) => void // following an issue's element link, which then closes the dialog
// }

export function useConfirmDialog() {
  const confirm = useConfirm()

  function showConfirm(options) {
    return new Promise((resolve) => {
      confirm.require({
        group: 'app-confirm',

        header: options.header,
        message: options.message,
        severity: options.severity,

        acceptLabel: options.acceptLabel ?? 'OK',
        rejectLabel: options.rejectLabel,
        isRejectDefault: !!options.isRejectDefault && !!options.rejectLabel,
        issues: options.issues,
        onIssue: options.onIssue,

        // Escape closes only this dialog, as its reject button would.
        closeOnEscape: true,
        accept: () => resolve(true),
        reject: () => resolve(false),
        onHide: () => resolve(false),
      })
    })
  }

  /**
   * Asks a question with a third, extra action between rejecting and accepting, which is the default: focused, so
   * Enter takes it, while Escape rejects.
   *
   * @param {Object} options - As confirm's, with extraLabel naming the extra action, and remember, where given, the
   *   label of a checkbox below the message, such as 'Remember this choice'.
   * @returns {Promise<'accept'|'extra'|'reject'>} The action chosen; closing the dialog rejects. With remember, it is
   *   `{ action, remember }` instead, remember whether the box was ticked.
   */
  function choose(options) {
    const remember = options.remember ? reactive({ label: options.remember, checked: false }) : null
    const answer = (action) => (remember ? { action, remember: remember.checked } : action)
    return new Promise((resolve) => {
      confirm.require({
        group: 'app-confirm',
        header: options.header,
        message: options.message,
        severity: options.severity,
        acceptLabel: options.acceptLabel ?? 'OK',
        rejectLabel: options.rejectLabel ?? 'Cancel',
        extraLabel: options.extraLabel,
        issues: options.issues,
        remember,
        closeOnEscape: true,
        accept: () => resolve(answer('accept')),
        extra: () => resolve(answer('extra')),
        reject: () => resolve(answer('reject')),
        onHide: () => resolve(answer('reject')),
      })
    })
  }

  /**
   * Asks for a value: typed, with suggestions, or picked from choices. Enter accepts, Escape cancels.
   *
   * @param {Object} options - As confirm's, with:
   * @param {string} [options.value] - The value it starts with.
   * @param {string[]} [options.suggestions] - Offered as the user types.
   * @param {Array<{label: string, value: string}>} [options.choices] - A list to pick from instead of typing.
   * @param {(value: string) => string} [options.hint] - A note shown under the field as the value changes.
   * @returns {Promise<string|null>} The value, or null when cancelled.
   */
  function prompt(options) {
    const input = reactive({
      value: options.value ?? '',
      suggestions: options.suggestions ?? [],
      choices: options.choices ?? null,
      hint: options.hint ?? null,
    })
    return new Promise((resolve) => {
      confirm.require({
        group: 'app-confirm',
        header: options.header,
        message: options.message,
        severity: options.severity,
        acceptLabel: options.acceptLabel ?? 'OK',
        rejectLabel: options.rejectLabel ?? 'Cancel',
        input,
        closeOnEscape: true,
        accept: () => resolve(input.value ?? ''),
        reject: () => resolve(null),
        onHide: () => resolve(null),
      })
    })
  }

  async function confirmDialog(options) {
    return await showConfirm(options)
  }

  async function alertDialog(options) {
    return await showConfirm({
      ...options,
      acceptLabel: options.acceptLabel ?? 'OK',
      rejectLabel: undefined,
    })
  }

  return {
    confirm: confirmDialog,
    alert: alertDialog,
    choose,
    prompt,
  }
}
