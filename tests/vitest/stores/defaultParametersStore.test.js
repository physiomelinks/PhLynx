import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { keyOf, splitKey, toParamSet, useDefaultParametersStore } from '../../../src/stores/defaultParametersStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { parseParametersJson } from '../../../src/utils/parameters/parse.js'

const resourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../resources/parameters')
const readResource = (name) => readFileSync(path.join(resourceDir, name), 'utf8')
const addConfig = (name) => useLibraryStore().addConfigFile(name, JSON.parse(readResource(name)))
const readSet = async (name) => toParamSet(await parseParametersJson(readResource(name), name), name, '2026-11-08T00:00:00.000Z')

const NKA = 'NKA.cellml:NKA'
const COMPARTMENT = 'compartment.cellml:compartment'
const param = (value) => ({ value, units: 'mM', data_reference: '', extra: {} })
const smallSet = (ref, value = '1') => ({
  ref,
  source: { file: `${ref}_parameters.json`, importedAt: 'now' },
  globals: new Map(),
  values: new Map([['K', param(value)]]),
})

describe('store keys', () => {
  it('splits on the last colon, as a math ref holds one', () => {
    expect(keyOf(NKA, 'NKA')).toBe('NKA.cellml:NKA:NKA')
    expect(splitKey('NKA.cellml:NKA:NKA')).toEqual({ mathRef: NKA, paramRef: 'NKA' })
    expect(splitKey(keyOf('a:b:c', 'lumen_calibrated'))).toEqual({ mathRef: 'a:b:c', paramRef: 'lumen_calibrated' })
  })

  it('keeps colons out of refs', () => {
    expect(toParamSet({ ref: 'a:b', globals: new Map(), values: new Map() }, 'f.json').ref).toBe('a_b')
  })
})

describe('useDefaultParametersStore', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDefaultParametersStore()
  })

  it('links a set to the math whose config names it, when the config came first', async () => {
    addConfig('NKA_NKA_modules_config.json')
    const [placed] = store.addSet(await readSet('NKA_parameters.json'))

    expect(placed).toMatchObject({ mathRef: NKA, ref: 'NKA', replaced: false })
    const set = store.getSet(NKA, 'NKA')
    expect(set.values.get('K_6').value).toBe('30250.0')
    expect(set.source).toEqual({ file: 'NKA_parameters.json', importedAt: '2026-11-08T00:00:00.000Z' })
    expect(store.unlinked.size).toBe(0)
  })

  it('holds a set unlinked until a config names it, then links it', async () => {
    const [placed] = store.addSet(await readSet('lumen_parameters.json'))
    expect(placed.mathRef).toBeNull()
    expect(store.getSet(null, 'lumen')).not.toBeNull()

    addConfig('compartment_lumen_modules_config.json')

    expect(store.unlinked.size).toBe(0)
    expect(store.getSet(COMPARTMENT, 'lumen').values.get('c_Na_init').value).toBe('140')
    expect(store.takeRecentLinks()).toEqual([expect.objectContaining({ mathRef: COMPARTMENT, ref: 'lumen' })])
    expect(store.takeRecentLinks()).toEqual([])
  })

  it('links in either order to the same set', async () => {
    addConfig('NKA_NKA_modules_config.json')
    store.addSet(await readSet('NKA_parameters.json'))
    const configFirst = store.getState()

    setActivePinia(createPinia())
    const other = useDefaultParametersStore()
    other.addSet(await readSet('NKA_parameters.json'))
    addConfig('NKA_NKA_modules_config.json')

    expect(other.getState()).toEqual(configFirst)
  })

  it('sorts a linked set by its config types, warning of an entry listed otherwise', () => {
    addConfig('NKA_NKA_modules_config.json')
    const set = { ...smallSet('NKA'), globals: new Map([['F', param('96485')], ['K_6', param('2')]]), values: new Map() }
    const [placed] = store.addSet(set)

    const linked = store.getSet(NKA, 'NKA')
    expect([...linked.globals.keys()]).toEqual(['F'])
    expect([...linked.values.keys()]).toEqual(['K_6'])
    expect(placed.warnings).toContainEqual(expect.stringContaining('`K_6` is listed under global'))
  })

  it('keeps a set added for a given math there, with no linking', () => {
    store.addSet(smallSet('fast'), { mathRef: COMPARTMENT })
    store.addSet(smallSet('fast'), { mathRef: NKA })

    expect(store.setsFor(COMPARTMENT).map((set) => set.ref)).toEqual(['fast'])
    expect(store.setsFor(NKA).map((set) => set.ref)).toEqual(['fast'])
  })

  it('names the clashes a set would have, and settles them by Replace or Keep both', () => {
    store.addSet(smallSet('fast', '1'), { mathRef: NKA })
    expect(store.collisionsFor('fast', NKA)).toEqual([`${NKA}:fast`])
    expect(store.collisionsFor('slow', NKA)).toEqual([])

    expect(store.addSet(smallSet('fast', '2'), { mathRef: NKA, onCollision: 'keep-both' })[0]).toMatchObject({
      ref: 'fast_2',
      replaced: false,
    })
    expect(store.addSet(smallSet('fast', '3'), { mathRef: NKA, onCollision: 'keep-both' })[0].ref).toBe('fast_3')
    expect(store.addSet(smallSet('fast', '4'), { mathRef: NKA, onCollision: 'replace' })[0]).toMatchObject({
      ref: 'fast',
      replaced: true,
    })

    expect(store.setsFor(NKA).map((set) => [set.ref, set.values.get('K').value])).toEqual([
      ['fast', '4'],
      ['fast_2', '2'],
      ['fast_3', '3'],
    ])
  })

  it('plans a replace without storing it until committed', () => {
    store.addSet(smallSet('fast', '1'), { mathRef: NKA })

    const placements = store.planSet(smallSet('fast', '2'), { mathRef: NKA, onCollision: 'replace' })
    expect(placements).toMatchObject([{ mathRef: NKA, ref: 'fast', replaced: true, warnings: [] }])
    expect(placements[0].set.values.get('K').value).toBe('2')
    expect(store.getSet(NKA, 'fast').values.get('K').value).toBe('1')

    expect(store.commitSet(placements)).toEqual([{ mathRef: NKA, ref: 'fast', fileRef: 'fast', replaced: true, warnings: [] }])
    expect(store.getSet(NKA, 'fast').values.get('K').value).toBe('2')
  })

  it('keeps the ref a set was read as when both are kept, and when it links under a new one', () => {
    store.addSet(smallSet('lumen'), { mathRef: COMPARTMENT })
    expect(store.addSet(smallSet('lumen'), { mathRef: COMPARTMENT })).toEqual([
      expect.objectContaining({ ref: 'lumen_2', fileRef: 'lumen' }),
    ])

    store.addSet(smallSet('lumen'))
    addConfig('compartment_lumen_modules_config.json')
    expect(store.takeRecentLinks()).toEqual([expect.objectContaining({ mathRef: COMPARTMENT, ref: 'lumen_3', fileRef: 'lumen' })])
  })

  it('names clashes in the unlinked bucket and under the maths a config links to', () => {
    store.addSet(smallSet('lumen'))
    expect(store.collisionsFor('lumen')).toEqual([':lumen'])

    addConfig('compartment_lumen_modules_config.json')
    expect(store.collisionsFor('lumen')).toEqual([`${COMPARTMENT}:lumen`])
  })

  it('removes a set, dropping an emptied math', () => {
    store.addSet(smallSet('fast'), { mathRef: NKA })
    store.removeSet(NKA, 'fast')
    expect(store.sets.has(NKA)).toBe(false)
  })

  it('saves and restores its sets, splitting keys on the last colon', async () => {
    addConfig('NKA_NKA_modules_config.json')
    store.addSet(await readSet('NKA_parameters.json'))
    store.addSet(await readSet('Membrane_parameters.json'))
    const state = JSON.parse(JSON.stringify(store.getState()))
    expect(state.sets.map(([key]) => key)).toEqual(['NKA.cellml:NKA:NKA'])
    expect(state.unlinked.map(([ref]) => ref)).toEqual(['Membrane'])

    setActivePinia(createPinia())
    const restored = useDefaultParametersStore()
    restored.loadState(state)
    expect(restored.getState()).toEqual(state)
    expect(restored.getSet(NKA, 'NKA').values).toEqual(store.getSet(NKA, 'NKA').values)
  })

  it('loads nothing from an older file, and skips malformed entries', () => {
    store.addSet(smallSet('fast'), { mathRef: NKA })
    store.loadState(undefined)
    expect(store.getState()).toEqual({ sets: [], unlinked: [] })

    store.loadState({ sets: [['no-colon', {}], [`${NKA}:ok`, null], [`${NKA}:fine`, { values: [['K', param('2')]] }]] })
    expect(store.getState().sets.map(([key]) => key)).toEqual([`${NKA}:fine`])
  })
})

describe('instance sets', () => {
  let store
  const rows = () => [
    { name: 'pH', type: 'constant', value: '7.4', units: 'dim', data_reference: 'phlynx' },
    { name: 'area', type: 'constant', value: '', units: 'mm2' },
    { name: 'F', type: 'global_constant', value: '96485', units: 'C_per_mol' },
    { name: 'u', type: 'boundary_condition', value: '1', units: 'mM' },
    { name: 'c', type: 'variable', value: '', units: 'mM' },
  ]

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useDefaultParametersStore()
  })

  it("makes a set of an instance's values, named as the instance, blank values needing one", () => {
    const set = store.addInstanceSet(COMPARTMENT, 'n1', 'compartment', rows(), 'then')
    expect(set).toMatchObject({ ref: 'compartment', source: { file: '', importedAt: 'then', kind: 'instance', nodeId: 'n1' } })
    expect(store.getSet(COMPARTMENT, 'compartment')).toBe(set)
    expect([...set.values]).toEqual([
      ['pH', { value: '7.4', units: 'dim', data_reference: 'phlynx', extra: {} }],
      ['area', { value: null, units: 'mm2', data_reference: '', extra: {} }],
      ['u', { value: '1', units: 'mM', data_reference: '', extra: {} }],
    ])
    expect([...set.globals.keys()]).toEqual(['F'])
  })

  it('takes the next free ref on a clash, and keeps colons out', () => {
    store.addSet(smallSet('compartment'), { mathRef: COMPARTMENT })
    expect(store.addInstanceSet(COMPARTMENT, 'n1', 'compartment', rows()).ref).toBe('compartment_2')
    expect(store.addInstanceSet(COMPARTMENT, 'n2', 'compartment', rows()).ref).toBe('compartment_3')
    expect(store.addInstanceSet(COMPARTMENT, 'n3', 'a:b', rows()).ref).toBe('a_b')
    expect(store.setsFor(COMPARTMENT).map((set) => set.ref)).toEqual(['compartment', 'compartment_2', 'compartment_3', 'a_b'])
  })

  it('writes back only the edits of the node that made the set, never to an imported one', () => {
    store.addSet(smallSet('enterocyte'), { mathRef: COMPARTMENT })
    store.addInstanceSet(COMPARTMENT, 'n1', 'compartment', rows())
    const edited = rows().map((row) => (row.name === 'pH' ? { ...row, value: '6.8' } : row))

    expect(store.updateInstanceSet(COMPARTMENT, 'compartment', 'n2', edited)).toBe(false)
    expect(store.getSet(COMPARTMENT, 'compartment').values.get('pH').value).toBe('7.4')
    expect(store.updateInstanceSet(COMPARTMENT, 'compartment', 'n1', edited)).toBe(true)
    expect(store.getSet(COMPARTMENT, 'compartment').values.get('pH').value).toBe('6.8')

    const imported = store.getSet(COMPARTMENT, 'enterocyte')
    expect(store.updateInstanceSet(COMPARTMENT, 'enterocyte', 'n1', edited)).toBe(false)
    expect(store.getSet(COMPARTMENT, 'enterocyte')).toBe(imported)
  })

  it('restores a set, or removes one that was not there', () => {
    const set = store.addInstanceSet(COMPARTMENT, 'n1', 'compartment', rows())
    store.restoreSet(COMPARTMENT, 'compartment', null)
    expect(store.getSet(COMPARTMENT, 'compartment')).toBeNull()
    store.restoreSet(COMPARTMENT, 'compartment', set)
    expect(store.getSet(COMPARTMENT, 'compartment')).toBe(set)
  })

  it('saves and restores an instance set as one, and an imported set without a kind', () => {
    store.addInstanceSet(COMPARTMENT, 'n1', 'compartment', rows(), 'then')
    store.addSet(smallSet('enterocyte'), { mathRef: COMPARTMENT })
    const state = JSON.parse(JSON.stringify(store.getState()))
    expect(state.sets.map(([, saved]) => saved.source)).toEqual([
      { file: '', importedAt: 'then', kind: 'instance', nodeId: 'n1' },
      { file: 'enterocyte_parameters.json', importedAt: 'now' },
    ])

    store.loadState(state)
    expect(store.getSet(COMPARTMENT, 'compartment').source.kind).toBe('instance')
    expect(store.updateInstanceSet(COMPARTMENT, 'compartment', 'n1', rows())).toBe(true)
  })

  it('gives the ref a new instance set would take, without adding it', () => {
    expect(store.instanceSetRef(COMPARTMENT, 'compartment')).toBe('compartment')
    store.addSet(smallSet('compartment'), { mathRef: COMPARTMENT })
    expect(store.instanceSetRef(COMPARTMENT, 'compartment')).toBe('compartment_2')
    expect(store.instanceSetRef(COMPARTMENT, 'a:b')).toBe('a_b')
    expect(store.setsFor(COMPARTMENT)).toHaveLength(1)
  })

  it('writes values into a shared set where it lists them, keeping their units, and adds the ones it lacks', () => {
    store.addSet(
      { ...smallSet('enterocyte'), globals: new Map([['F', param('96485')]]) },
      { mathRef: COMPARTMENT }
    )
    const before = store.getSet(COMPARTMENT, 'enterocyte')
    const entry = (value) => ({ value, units: 'other', data_reference: '', extra: {} })
    const written = store.updateSetEntries(COMPARTMENT, 'enterocyte', {
      globals: new Map([['K', entry('2')]]),
      values: new Map([['F', entry('1')], ['pH', entry('6.8')]]),
    })
    expect(written).toBe(store.getSet(COMPARTMENT, 'enterocyte'))
    expect(written).not.toBe(before)
    expect(written.source).toEqual(before.source)
    expect(written.values.get('K')).toEqual({ ...param('1'), value: '2' })
    expect(written.globals.get('F')).toEqual({ ...param('96485'), value: '1' })
    expect(written.values.get('pH')).toEqual(entry('6.8'))
    expect(before.values.get('K').value).toBe('1')
    expect(store.updateSetEntries(COMPARTMENT, 'missing', { globals: new Map(), values: new Map() })).toBeNull()
  })
})
