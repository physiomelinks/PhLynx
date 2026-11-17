import createLibOpenCOR from '@opencor/libopencor'

/**
 * Creates a libOpenCOR instance that runs its pthreads as Node worker threads.
 * libOpenCOR takes any `window` as a browser and starts workers from blob URLs, which Node can't load, so happy-dom's
 * `window` is hidden while the factory reads its environment.
 */
export function createNodeLibOpenCOR() {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'window')
  if (saved) delete globalThis.window
  try {
    return createLibOpenCOR()
  } finally {
    if (saved) Object.defineProperty(globalThis, 'window', saved)
  }
}
