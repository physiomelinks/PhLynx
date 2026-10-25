import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createPinia, setActivePinia } from 'pinia'
import { computed } from 'vue'
import { beforeEach, describe, expect, it } from 'vitest'

import { useLibraryStore } from '../../../src/stores/libraryStore.js'

const TOY = resolve(__dirname, '../fixtures/annotations/toy')
const read = (name) => readFileSync(resolve(TOY, name), 'utf8')
const MATH_REF = 'pool.cellml:pool'
const SIDECAR = read('pool.ttl')
const MATH = read('pool.cellml')

describe('libraryStore module annotations', () => {
  let library

  beforeEach(() => {
    setActivePinia(createPinia())
    library = useLibraryStore()
    library.addMath(MATH_REF, MATH)
  })

  it('keeps the sidecar text as written and removes it on empty text', () => {
    library.setModuleAnnotations(MATH_REF, SIDECAR)
    expect(library.getModuleAnnotations(MATH_REF)).toBe(SIDECAR)

    library.setModuleAnnotations(MATH_REF, '  ')
    expect(library.getModuleAnnotations(MATH_REF)).toBeNull()
  })

  it('round trips the raw text through getState and loadState, next to mathLayouts', () => {
    library.setModuleAnnotations(MATH_REF, SIDECAR)
    const state = JSON.parse(JSON.stringify(library.getState()))
    expect(state.moduleAnnotations).toEqual([[MATH_REF, SIDECAR]])

    setActivePinia(createPinia())
    const fresh = useLibraryStore()
    fresh.loadState(state)
    expect(fresh.getModuleAnnotations(MATH_REF)).toBe(SIDECAR)
    expect(fresh.getState()).toEqual(state)
  })

  it('saves no moduleAnnotations field without sidecars, and loads a library without one', () => {
    expect(library.getState()).not.toHaveProperty('moduleAnnotations')

    library.loadState({ availableMath: [[MATH_REF, MATH]] })
    expect(library.moduleAnnotations.size).toBe(0)
  })

  it('skips saved entries that are not text', () => {
    library.loadState({
      moduleAnnotations: [
        ['a:b', { bogus: true }],
        [MATH_REF, SIDECAR],
      ],
    })
    expect([...library.moduleAnnotations.keys()]).toEqual([MATH_REF])
  })

  it('loads the rest of a library whose moduleAnnotations field is malformed', () => {
    library.loadState({ availableMath: [[MATH_REF, MATH]], moduleAnnotations: { [MATH_REF]: SIDECAR } })
    expect(library.availableMath.has(MATH_REF)).toBe(true)
    expect(library.moduleAnnotations.size).toBe(0)

    library.loadState({ moduleAnnotations: [null, 'text', [MATH_REF, SIDECAR]] })
    expect([...library.moduleAnnotations.keys()]).toEqual([MATH_REF])
  })

  it('parses on ensure, caches the parse, and serves it from the sync accessor', async () => {
    library.setModuleAnnotations(MATH_REF, SIDECAR)
    const parsed = computed(() => library.getParsedModuleAnnotations(MATH_REF))
    expect(parsed.value).toBeNull()

    const sidecar = await library.ensureModuleAnnotations(MATH_REF)
    expect(sidecar.warnings).toEqual([])
    expect(sidecar.variables.map((entry) => entry.variable).sort()).toEqual(['area', 'c_A', 'v_A', 'volume'])
    expect(parsed.value).toBe(sidecar)
    expect(await library.ensureModuleAnnotations(MATH_REF)).toBe(sidecar)
  })

  it('shares one parse between concurrent callers', async () => {
    library.setModuleAnnotations(MATH_REF, SIDECAR)
    const [a, b] = await Promise.all([
      library.ensureModuleAnnotations(MATH_REF),
      library.ensureModuleAnnotations(MATH_REF),
    ])
    expect(a).toBe(b)
  })

  it('returns null for math without a sidecar', async () => {
    expect(await library.ensureModuleAnnotations(MATH_REF)).toBeNull()
    expect(library.getParsedModuleAnnotations(MATH_REF)).toBeNull()
  })

  it('does not cache a parse the text changed under', async () => {
    library.setModuleAnnotations(MATH_REF, SIDECAR)
    const pending = library.ensureModuleAnnotations(MATH_REF)
    library.setModuleAnnotations(MATH_REF, `${SIDECAR}\n# edited\n`)
    await pending
    expect(library.getParsedModuleAnnotations(MATH_REF)).toBeNull()

    const reparsed = await library.ensureModuleAnnotations(MATH_REF)
    expect(library.getParsedModuleAnnotations(MATH_REF)).toBe(reparsed)
  })

  it('drops the cached parse when the math changes', async () => {
    library.setModuleAnnotations(MATH_REF, SIDECAR)
    await library.ensureModuleAnnotations(MATH_REF)
    library.addMath(
      MATH_REF,
      MATH.replace('</component>', '<variable name="extra" units="dimensionless"/></component>')
    )
    expect(library.getParsedModuleAnnotations(MATH_REF)).toBeNull()
  })

  it('removes the sidecar with its math, and getMathEntry/restoreMathEntry carry it', () => {
    library.setModuleAnnotations(MATH_REF, SIDECAR)
    const entry = library.getMathEntry(MATH_REF)
    expect(entry.annotations).toBe(SIDECAR)

    library.removeMath(MATH_REF)
    expect(library.getModuleAnnotations(MATH_REF)).toBeNull()

    library.restoreMathEntry(MATH_REF, entry)
    expect(library.getModuleAnnotations(MATH_REF)).toBe(SIDECAR)
  })

  it('clears sidecars on resetState via loadState', () => {
    library.setModuleAnnotations(MATH_REF, SIDECAR)
    library.loadState({})
    expect(library.getModuleAnnotations(MATH_REF)).toBeNull()
  })
})
