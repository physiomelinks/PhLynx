import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

/** Resolves `specifier` as a module inside the package at `entry` would import it. */
const resolveFrom = (entry, specifier) => createRequire(require.resolve(entry)).resolve(specifier)

describe('@primeuix/utils', () => {
  // Two copies give two z-index stacks, so the math editor's command list opens behind PrimeVue dialogs.
  it('resolves to one copy for primevue and vue3-math-editor', () => {
    // vue3-math-editor's main entry is import-only, so anchor on its package.json.
    const fromMathEditor = resolveFrom('vue3-math-editor/package.json', '@primeuix/utils/zindex')
    const fromPrimeVue = resolveFrom('primevue', '@primeuix/utils/zindex')

    expect(fromMathEditor).toBe(fromPrimeVue)
  })
})
