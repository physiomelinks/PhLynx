import ToastEventBus from 'primevue/toasteventbus'

const notifyDuration = (type) => {
  return type === 'info' || type === 'success' ? 1500 : type === 'warning' || type === 'warn' ? 3000 : 4000
}

/**
 * Escapes text for a toast's message, which is shown as HTML.
 *
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Shows a toast. Its message is shown as HTML, so text from a file or a name goes in `items`, which are escaped.
 *
 * @param {Object} [options]
 * @param {string} [options.type] - 'info', 'success', 'warning' or 'error'.
 * @param {string} [options.title]
 * @param {string} [options.message] - HTML.
 * @param {string[]} [options.items] - Plain text lines in place of `message`: escaped, one per line.
 * @param {number} [options.duration] - Milliseconds; by type when not given.
 * @param {boolean} [options.sticky] - Stays until closed, for a message too long to read in `duration`.
 * @returns {{close: Function}}
 */
export const notify = (options = {}) => {
  const { type, title, message, items, duration, sticky, ...rest } = options

  const severity = type === 'warning' ? 'warn' : type

  const toastMessage = {
    severity: severity || 'info',
    summary: title,
    detail: items ? items.map(escapeHtml).join('<br>') : message,
    life: sticky ? undefined : duration ?? notifyDuration(type),
    ...rest,
  }

  ToastEventBus.emit('add', toastMessage)

  return {
    close: () => ToastEventBus.emit('remove', toastMessage),
  }
}

notify.error = (options) => notify({ ...options, type: 'error' })
notify.info = (options) => notify({ ...options, type: 'info' })
notify.success = (options) => notify({ ...options, type: 'success' })
notify.warning = (options) => notify({ ...options, type: 'warning' })
