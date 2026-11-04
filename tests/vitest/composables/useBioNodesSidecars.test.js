import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useBioNodes } from '../../../src/composables/useBioNodes.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'

const TOY = resolve(__dirname, '../fixtures/annotations/toy')
const read = (name) => readFileSync(resolve(TOY, name), 'utf8')
const MATH_REF = 'porter.cellml:porter'

describe('useBioNodes sidecars', () => {
  let library

  beforeEach(() => {
    setActivePinia(createPinia())
    library = useLibraryStore()
    library.addMath(MATH_REF, read('porter.cellml'))
  })

  it('parses a sidecar set after mount, so its role appears without a remount', async () => {
    const nodes = ref([{ id: 'porter', data: { name: 'porter', mathRef: MATH_REF } }])
    const { roles } = useBioNodes(nodes)
    expect(roles.value.get('porter').role).toBe('none')

    library.setModuleAnnotations(MATH_REF, read('porter.ttl'))
    await vi.waitFor(() => expect(roles.value.get('porter').role).toBe('membraneProtein'))

    library.setModuleAnnotations(MATH_REF, null)
    await nextTick()
    expect(roles.value.get('porter').role).toBe('none')
  })
})
