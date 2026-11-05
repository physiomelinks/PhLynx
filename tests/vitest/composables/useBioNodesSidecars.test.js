import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBioNodes } from '../../../src/composables/useBioNodes.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'

const TOY = resolve(__dirname, '../fixtures/annotations/toy')
const read = (name) => readFileSync(resolve(TOY, name), 'utf8')
const MATH_REF = 'pool.cellml:pool'


describe('useBioNodes sidecars', () => {
  let library

  beforeEach(() => {
    setActivePinia(createPinia())
    library = useLibraryStore()
    library.addMath(MATH_REF, read('pool.cellml'))
  })

  it('parses a sidecar set after mount, so species mode appears without a remount', async () => {
    const nodes = ref([{ id: 'lumen', data: { name: 'lumen', mathRef: MATH_REF, bioView: { role: 'region' } } }])
    const { hasSpecies } = useBioNodes(nodes)
    expect(hasSpecies.value).toBe(false)

    library.setModuleAnnotations(MATH_REF, read('pool.ttl'))
    await vi.waitFor(() => expect(hasSpecies.value).toBe(true))

    library.setModuleAnnotations(MATH_REF, null)
    await nextTick()
    expect(hasSpecies.value).toBe(false)
  })
})
