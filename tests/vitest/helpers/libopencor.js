import createLibOpenCOR from '@opencor/libopencor'

/**
 * Creates libOpenCOR as Node runs it, also under happy-dom. libOpenCOR takes a `window` to mean a browser and starts
 * its threads from a blob: URL, which Node's Worker can't load. It reads `window` once, as the module starts.
 *
 * @returns {Promise<Object>} The libOpenCOR module.
 */
export function createNodeLibOpenCOR() {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')
  if (!descriptor) return createLibOpenCOR()
  Object.defineProperty(globalThis, 'window', { value: undefined, configurable: true, writable: true })
  try {
    return createLibOpenCOR()
  } finally {
    Object.defineProperty(globalThis, 'window', descriptor)
  }
}
