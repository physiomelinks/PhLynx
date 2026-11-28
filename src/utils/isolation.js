/**
 * Cross-origin isolation, which the simulator needs for SharedArrayBuffer. public/coi-serviceworker.js
 * provides it; where it can't, these say why.
 */

/**
 * Gets whether the page is cross-origin isolated, and if not, why.
 *
 * @param {Object} [scope=globalThis] - The window to check.
 * @returns {{isIsolated: boolean, reason: string|null, needsReload?: boolean}} needsReload when a reload fixes it.
 */
export function getIsolationStatus(scope = globalThis) {
  if (scope.crossOriginIsolated === true) return { isIsolated: true, reason: null }
  if (!scope.isSecureContext) {
    return { isIsolated: false, reason: 'The simulator needs a secure (https) connection.' }
  }
  if (!scope.navigator?.serviceWorker) {
    return {
      isIsolated: false,
      reason: 'This browser window doesn’t allow service workers (a private window, for example), which the simulator needs.',
    }
  }
  // The worker is skipped here (public/coi-config.js), so no reload would bring it.
  if (scope.coi?.shouldRegister?.() === false) {
    return {
      isIsolated: false,
      reason: 'The simulator is turned off in this browser window (an automated browser, for example).',
    }
  }
  // The worker loaded this page and it still isn't isolated: the browser doesn't apply the worker's headers, so
  // another reload would end up here again.
  if (scope.coi?.wasControlledAtLoad) {
    return {
      isIsolated: false,
      reason: 'This browser can’t set the simulator up, and a reload won’t help. Try another browser, such as Chrome.',
    }
  }
  return {
    isIsolated: false,
    reason: 'The simulator needs a reload to finish setting up. Save your work first.',
    needsReload: true,
  }
}

/**
 * Checks whether coi-serviceworker is about to reload the page to make it isolated: the page isn't
 * isolated, no worker controls it yet, and one may register.
 *
 * @param {Object} [scope=globalThis] - The window to check.
 * @returns {boolean}
 */
export function isIsolationReloadPending(scope = globalThis) {
  return (
    scope.crossOriginIsolated === false &&
    !!scope.isSecureContext &&
    !!scope.navigator?.serviceWorker &&
    !scope.navigator.serviceWorker.controller &&
    scope.coi?.shouldRegister?.() !== false
  )
}

/**
 * Waits while coi-serviceworker may be about to reload the page, so the app starts once. Resolves at
 * once when no reload is pending, or after `timeoutMs` if none comes (registration failed, say).
 *
 * @param {Object} [scope=globalThis] - The window to check.
 * @param {number} [timeoutMs=3000]
 * @returns {Promise<void>}
 */
export function waitForIsolationReload(scope = globalThis, timeoutMs = 3000) {
  if (!isIsolationReloadPending(scope)) return Promise.resolve()
  return new Promise((resolve) => scope.setTimeout(resolve, timeoutMs))
}
