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
   * @param {Object} options - As confirm's, with extraLabel naming the extra action.
   * @returns {Promise<'accept'|'extra'|'reject'>} The action chosen; closing the dialog rejects.
   */
  function choose(options) {
    return new Promise((resolve) => {
      confirm.require({
        group: 'app-confirm',
        header: options.header,
        message: options.message,
        severity: options.severity,
        acceptLabel: options.acceptLabel ?? 'OK',
        rejectLabel: options.rejectLabel ?? 'Cancel',
        extraLabel: options.extraLabel,
        closeOnEscape: true,
        accept: () => resolve('accept'),
        extra: () => resolve('extra'),
        reject: () => resolve('reject'),
        onHide: () => resolve('reject'),
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
  }
}