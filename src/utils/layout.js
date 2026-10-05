/**
 * Resolves once an element's bounding rect holds still for 3 frames, e.g. after a dialog's opening
 * transition. PrimeVue reports a dialog shown before its layout settles, so measure after this.
 *
 * @param {HTMLElement|null} el - The element to watch; resolves at once if missing.
 * @param {number} [maxTimeout=500] - Resolves after this many ms regardless.
 * @returns {Promise<void>}
 */
export function waitUntilStable(el, maxTimeout = 500) {
  return new Promise((resolve) => {
    if (!el) return resolve()

    let lastRect = ''
    let stableFrames = 0
    let rafId = null
    let timerId = null

    const cleanup = () => {
      if (rafId) cancelAnimationFrame(rafId)
      if (timerId) clearTimeout(timerId)
    }

    const check = () => {
      const rect = el.getBoundingClientRect()
      const currentRect = `${rect.width},${rect.height},${rect.top},${rect.left}`

      if (rect.width > 0 && rect.height > 0 && currentRect === lastRect) {
        stableFrames++
        if (stableFrames >= 3) {
          cleanup()
          return resolve()
        }
      } else {
        stableFrames = 0
        lastRect = currentRect
      }

      rafId = requestAnimationFrame(check)
    }

    timerId = setTimeout(() => {
      cleanup()
      resolve()
    }, maxTimeout)

    rafId = requestAnimationFrame(check)
  })
}
