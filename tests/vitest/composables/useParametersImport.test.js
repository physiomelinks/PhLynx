import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useParametersImport } from '../../../src/composables/useParametersImport.js'
import { useDefaultParametersStore } from '../../../src/stores/defaultParametersStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { buildParametersReport } from '../../../src/utils/parameters/apply.js'
import { csvToParameterFile, parseParametersJson } from '../../../src/utils/parameters/parse.js'

const resourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../resources/parameters')
const readResource = (name) => readFileSync(path.join(resourceDir, name), 'utf8')
const addConfig = (name) => useLibraryStore().addConfigFile(name, JSON.parse(readResource(name)))
const readFile = (name) => parseParametersJson(readResource(name), name)
/** The NKA file with one value no test node has changed, so it differs from the one loaded. */
async function changedNka() {
  const file = await readFile('NKA_parameters.json')
  file.values.get('K_K_o').value = '9'
  return file
}

const NKA = 'NKA.cellml:NKA'
const row = (name, value, type = 'constant', units = 'per_fmol') => ({ name, value, type, units, data_reference: '' })
const nkaNode = (id, name, parameterisation) => ({
  id,
  data: { name, mathRef: NKA, parameterisation, variables: [row('K_6', '1'), row('F', '1', 'global_constant', 'C_per_mol')] },
})

describe('useParametersImport', () => {
  let nodes
  let deps
  let defaults
  let library

  beforeEach(() => {
    setActivePinia(createPinia())
    nodes = ref([])
    deps = {
      nodes,
      recordEdit: vi.fn(async ({ apply }) => apply()),
      confirm: vi.fn(async () => true),
      choose: vi.fn(async () => 'accept'),
    }
    defaults = useDefaultParametersStore()
    library = useLibraryStore()
    addConfig('NKA_NKA_modules_config.json')
  })

  it('stores a module set as one recorded edit and seeds the globals the workspace uses', async () => {
    nodes.value = [nkaNode('1', 'NKA_x', 'other')]
    const { importParameterFile } = useParametersImport(deps)

    const result = await importParameterFile(await readFile('NKA_parameters.json'), 'NKA_parameters.json')

    expect(result).toMatchObject({ ok: true, count: 0, stored: [{ mathRef: NKA, ref: 'NKA', replaced: false }] })
    expect(defaults.getSet(NKA, 'NKA').values.get('K_6').value).toBe('30250.0')
    expect(library.getGlobalConstant('F').value).toBe('96485.3321')
    expect(library.getGlobalConstant('RT')).toBeUndefined()
    expect(nodes.value[0].data.variables[0].value).toBe('1')
    expect(deps.recordEdit).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'import-parameters', keys: ['variables', 'parameterisation'] })
    )
    expect(result.defaultOnly).toEqual(['NKA'])
  })

  it('asks before replacing a loaded set, and re-applies it to the nodes seeded with it', async () => {
    const { importParameterFile } = useParametersImport(deps)
    await importParameterFile(await readFile('NKA_parameters.json'), 'NKA_parameters.json')
    nodes.value = [nkaNode('1', 'NKA', 'NKA'), nkaNode('2', 'NKA_1', 'NKA_2')]
    library.assignGlobalConstant('F', '1', 'C_per_mol', '', true)

    deps.choose.mockResolvedValueOnce('extra')
    const replaced = await importParameterFile(await changedNka(), 'NKA_parameters.json')

    expect(deps.choose).toHaveBeenCalledTimes(2)
    expect(deps.choose).toHaveBeenLastCalledWith(
      expect.objectContaining({
        issues: [{ key: '1', label: 'NKA', message: 'K_6: 1 → 30250.0' }],
        acceptLabel: 'Change values',
        extraLabel: 'Keep instance values',
        rejectLabel: 'Cancel',
      })
    )
    expect(deps.recordEdit).toHaveBeenLastCalledWith(expect.objectContaining({ nodeIds: ['1'] }))
    expect(replaced.stored).toEqual([expect.objectContaining({ ref: 'NKA', replaced: true })])
    expect(replaced.count).toBe(1)
    expect(nodes.value.map((node) => node.data.variables[0].value)).toEqual(['30250.0', '1'])
    // A set's globals never overwrite a constant already set.
    expect(library.getGlobalConstant('F').value).toBe('1')
  })

  it('lists the changed values by instance, skipping unchanged ones, and replaces nothing when cancelled', async () => {
    const { importParameterFile } = useParametersImport(deps)
    await importParameterFile(await readFile('NKA_parameters.json'), 'NKA_parameters.json')
    const nka = nkaNode('1', 'NKA', 'NKA')
    nka.data.variables.push(row('K_K_o', '0.0239'), row('K_Nai', '1'))
    const unchanged = nkaNode('3', 'NKA_2', 'NKA')
    unchanged.data.variables[0].value = '7'
    nodes.value = [nka, nkaNode('2', 'NKA_1', 'NKA'), unchanged]
    const edited = await readFile('NKA_parameters.json')
    edited.values.get('K_6').value = '7'
    const stored = defaults.getSet(NKA, 'NKA')

    deps.choose.mockResolvedValueOnce('extra').mockResolvedValueOnce('reject')
    const cancelled = await importParameterFile(edited, 'NKA_parameters.json')

    const [{ issues, message }] = deps.choose.mock.calls[1]
    expect(message).toMatch(/^Applying NKA changes 3 values on 2 instances, those named after a set or seeded with it\./)
    expect(issues).toEqual([
      { key: '1', label: 'NKA', message: 'K_6: 1 → 7, K_Nai: 1 → 0.0159' },
      { key: '2', label: 'NKA_1', message: 'K_6: 1 → 7' },
    ])
    expect(cancelled).toMatchObject({ ok: false, count: 0, stored: [] })
    expect(buildParametersReport([cancelled])).toMatchObject({ type: 'warning', title: 'Parameters Not Loaded' })
    expect(defaults.getSet(NKA, 'NKA')).toBe(stored)
    expect(nodes.value.map((node) => node.data.variables[0].value)).toEqual(['1', '1', '7'])
    expect(deps.recordEdit).toHaveBeenCalledOnce()

    deps.choose.mockResolvedValueOnce('extra')
    const replaced = await importParameterFile(edited, 'NKA_parameters.json')
    expect(replaced.count).toBe(3)
    expect(deps.recordEdit).toHaveBeenCalledTimes(2)
    expect(defaults.getSet(NKA, 'NKA').values.get('K_6').value).toBe('7')
    expect(nodes.value.map((node) => node.data.variables[0].value)).toEqual(['7', '7', '7'])
  })

  it('applies a set to the untagged instance of its math named after it, tagging it, as one undo step', async () => {
    const lumen = { id: '9', data: { name: 'lumen', mathRef: 'compartment.cellml:compartment', variables: [row('pH', '1')] } }
    nodes.value = [nkaNode('1', 'NKA'), nkaNode('2', 'NKA_b'), lumen]
    const { importParameterFile } = useParametersImport(deps)

    const result = await importParameterFile(await readFile('NKA_parameters.json'), 'NKA_parameters.json')

    expect(deps.choose).toHaveBeenCalledWith(expect.objectContaining({ issues: [{ key: '1', label: 'NKA', message: 'K_6: 1 → 30250.0' }] }))
    expect(deps.recordEdit).toHaveBeenCalledOnce()
    expect(deps.recordEdit).toHaveBeenCalledWith(expect.objectContaining({ nodeIds: ['1'] }))
    expect(nodes.value.map((node) => [node.data.variables[0].value, node.data.parameterisation])).toEqual([
      ['30250.0', 'NKA'],
      ['1', undefined],
      ['1', undefined],
    ])
    expect(result).toMatchObject({ count: 1, uses: [{ ref: 'NKA', nodeName: 'NKA', count: 1 }], defaultOnly: [] })
  })

  it('stores the set but keeps the instance values when chosen', async () => {
    nodes.value = [nkaNode('1', 'NKA')]
    deps.choose.mockResolvedValueOnce('extra')
    const { importParameterFile } = useParametersImport(deps)

    const result = await importParameterFile(await readFile('NKA_parameters.json'), 'NKA_parameters.json')

    expect(defaults.getSet(NKA, 'NKA')).not.toBeNull()
    expect(nodes.value[0].data).toMatchObject({ parameterisation: undefined, variables: [{ value: '1' }, { value: '1' }] })
    expect(result).toMatchObject({ ok: true, count: 0, kept: ['NKA'], defaultOnly: [] })
    expect(buildParametersReport([result]).message).toContain('Instance values kept, as chosen; library defaults only: NKA.')
  })

  it('confirms several files once, as one undo step, leaving sets no instance is named after as defaults', async () => {
    addConfig('compartment_lumen_modules_config.json')
    nodes.value = [nkaNode('1', 'NKA')]
    const { importParameterFiles } = useParametersImport(deps)

    const results = await importParameterFiles([
      { file: await readFile('NKA_parameters.json'), fileName: 'NKA_parameters.json' },
      { file: await readFile('lumen_parameters.json'), fileName: 'lumen_parameters.json' },
    ])

    expect(deps.choose).toHaveBeenCalledOnce()
    expect(deps.recordEdit).toHaveBeenCalledOnce()
    expect(results.map((result) => [result.fileName, result.count, result.defaultOnly])).toEqual([
      ['NKA_parameters.json', 1, []],
      ['lumen_parameters.json', 0, ['lumen']],
    ])
    expect(buildParametersReport(results).message).toContain(
      'Library defaults only, as no instance of their math is named after them: lumen.'
    )
  })

  it('applies no set waiting for its config, saying it waits', async () => {
    nodes.value = [{ id: '9', data: { name: 'lumen', mathRef: 'compartment.cellml:compartment', variables: [row('pH', '1')] } }]
    const { importParameterFile } = useParametersImport(deps)

    const result = await importParameterFile(await readFile('lumen_parameters.json'), 'lumen_parameters.json')

    expect(deps.choose).not.toHaveBeenCalled()
    expect(nodes.value[0].data.variables[0].value).toBe('1')
    expect(result).toMatchObject({ stored: [{ mathRef: null, ref: 'lumen' }], count: 0, defaultOnly: [] })
    expect(buildParametersReport([result])).toMatchObject({ title: 'Parameter Sets Waiting for Configs' })
  })

  describe('applyLinkedSets', () => {
    const COMPARTMENT = 'compartment.cellml:compartment'
    const lumenNode = (id, name, parameterisation) => ({
      id,
      data: { name, mathRef: COMPARTMENT, parameterisation, variables: [row('pH', '1', 'constant', 'dim'), row('area', '1', 'constant', 'mm2')] },
    })

    beforeEach(async () => {
      const { importParameterFile } = useParametersImport(deps)
      await importParameterFile(await readFile('lumen_parameters.json'), 'lumen_parameters.json')
      deps.recordEdit.mockClear()
    })

    it('offers a set its config just linked to the instance named after it, as one undo step', async () => {
      nodes.value = [lumenNode('1', 'lumen'), lumenNode('2', 'gut'), nkaNode('3', 'lumen')]
      addConfig('compartment_lumen_modules_config.json')
      const { applyLinkedSets } = useParametersImport(deps)

      const applied = await applyLinkedSets(defaults.takeRecentLinks())

      expect(deps.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ issues: [{ key: '1', label: 'lumen', message: 'pH: 1 → 7.4, area: 1 → 0.001' }], rejectLabel: 'Keep instance values' })
      )
      expect(deps.recordEdit).toHaveBeenCalledOnce()
      expect(deps.recordEdit).toHaveBeenCalledWith(expect.objectContaining({ nodeIds: ['1'], keys: ['variables', 'parameterisation'] }))
      expect(nodes.value[0].data).toMatchObject({ parameterisation: 'lumen', variables: [{ value: '7.4' }, { value: '0.001' }] })
      expect(nodes.value[1].data.variables[0].value).toBe('1')
      expect(applied).toMatchObject({ count: 2, uses: [{ ref: 'lumen', nodeName: 'lumen', count: 2 }], kept: [] })
    })

    it('keeps the instance values when declined, and leaves a set no instance takes as a default', async () => {
      nodes.value = [lumenNode('1', 'lumen')]
      addConfig('compartment_lumen_modules_config.json')
      deps.confirm.mockResolvedValueOnce(false)
      const { applyLinkedSets } = useParametersImport(deps)

      expect(await applyLinkedSets(defaults.takeRecentLinks())).toMatchObject({ count: 0, kept: ['lumen'] })
      expect(nodes.value[0].data).toMatchObject({ parameterisation: undefined, variables: [{ value: '1' }, { value: '1' }] })
      expect(deps.recordEdit).not.toHaveBeenCalled()

      nodes.value = [lumenNode('1', 'gut')]
      expect(await applyLinkedSets([{ mathRef: COMPARTMENT, ref: 'lumen' }])).toMatchObject({ count: 0, defaultOnly: ['lumen'] })
      expect(deps.confirm).toHaveBeenCalledOnce()
    })
  })

  it('replaces a set loaded again with the same values without asking, re-applying it by name', async () => {
    const { importParameterFile } = useParametersImport(deps)
    await importParameterFile(await readFile('NKA_parameters.json'), 'NKA_parameters.json')
    nodes.value = [nkaNode('1', 'NKA')]

    const again = await importParameterFile(await readFile('NKA_parameters.json'), 'NKA_parameters.json')

    expect(deps.choose).toHaveBeenCalledOnce()
    expect(deps.choose).toHaveBeenCalledWith(expect.objectContaining({ header: 'Change Instance Values?' }))
    expect(again).toMatchObject({ stored: [{ ref: 'NKA', replaced: true }], count: 1 })
    expect(defaults.setsFor(NKA).map((set) => set.ref)).toEqual(['NKA'])
    expect(nodes.value[0].data).toMatchObject({ parameterisation: 'NKA', variables: [{ value: '30250.0' }, { value: '1' }] })
  })

  it('keeps both, or skips, as chosen', async () => {
    const { importParameterFile } = useParametersImport(deps)
    await importParameterFile(await readFile('NKA_parameters.json'), 'NKA_parameters.json')

    // A kept copy never reaches an instance that happens to share its new name.
    nodes.value = [nkaNode('5', 'NKA_2')]
    const kept = await importParameterFile(await changedNka(), 'NKA_parameters.json')
    expect(kept.stored).toEqual([expect.objectContaining({ ref: 'NKA_2', fileRef: 'NKA', replaced: false })])
    expect(nodes.value[0].data).toMatchObject({ parameterisation: undefined, variables: [{ value: '1' }, { value: '1' }] })
    nodes.value = []

    deps.choose.mockResolvedValueOnce('reject')
    const skipped = await importParameterFile(await changedNka(), 'NKA_parameters.json')
    expect(skipped.ok).toBe(false)
    expect(defaults.setsFor(NKA).map((set) => set.ref)).toEqual(['NKA', 'NKA_2'])
  })

  it('applies a model file by instance, overwriting globals only once confirmed', async () => {
    nodes.value = [nkaNode('1', 'NKA_a'), nkaNode('2', 'NKA_b')]
    library.assignGlobalConstant('F', '1', 'C_per_mol', '')
    const { importParameterFile } = useParametersImport(deps)
    const text = JSON.stringify({
      schema_version: 1,
      global: { F: { value: '2', units: 'C_per_mol', data_reference: '' } },
      NKA_b: { K_6: { value: '9', units: 'per_fmol', data_reference: '' } },
      missing: { K_6: { value: '9', units: 'per_fmol', data_reference: '' } },
    })

    deps.confirm.mockResolvedValueOnce(false)
    const kept = await importParameterFile(await parseParametersJson(text, 'model.json'), 'model.json')
    expect(deps.confirm).toHaveBeenCalledWith(expect.objectContaining({ issues: [{ key: 'F', message: 'F: 1 → 2' }] }))
    expect(library.getGlobalConstant('F').value).toBe('1')
    expect(nodes.value.map((node) => node.data.variables[0].value)).toEqual(['1', '9'])
    expect(kept.warnings).toContain('no instance named missing in the workspace')

    await importParameterFile(await parseParametersJson(text, 'model.json'), 'model.json')
    expect(library.getGlobalConstant('F').value).toBe('2')
  })

  it('reads a <variable>_<instance> CSV naming a default set as that set when it matches no instance', () => {
    nodes.value = [nkaNode('1', 'NKA_a')]
    const { retryCsvAsModule } = useParametersImport(deps)
    const rows = [{ variable_name: 'K_6', units: 'per_fmol', value: '3', data_reference: '' }]

    expect(retryCsvAsModule(csvToParameterFile(rows, 'NKA_parameters.csv'))).toMatchObject({ kind: 'module', ref: 'NKA' })
    expect(retryCsvAsModule(csvToParameterFile(rows, 'model_parameters.csv')).rows).toBe(rows)
    const instanceRows = [{ ...rows[0], variable_name: 'K_6_NKA_a' }]
    expect(retryCsvAsModule(csvToParameterFile(instanceRows, 'NKA_parameters.csv')).rows).toBe(instanceRows)
  })

  it('records nothing when told not to', async () => {
    const { importParameterFile } = useParametersImport(deps)
    await importParameterFile(await readFile('NKA_parameters.json'), 'NKA_parameters.json', { record: false })
    expect(deps.recordEdit).not.toHaveBeenCalled()
    expect(defaults.getSet(NKA, 'NKA')).not.toBeNull()
  })

  describe('applySetToNode', () => {
    /** Loads the NKA set and a changed copy of it as NKA_2, then gives the composable. */
    async function withTwoSets() {
      const composable = useParametersImport(deps)
      await composable.importParameterFile(await readFile('NKA_parameters.json'), 'NKA_parameters.json', { record: false })
      deps.choose.mockResolvedValueOnce('accept')
      await composable.importParameterFile(await changedNka(), 'NKA_parameters.json', { record: false })
      deps.recordEdit.mockClear()
      deps.confirm.mockClear()
      return composable
    }

    it('lists the values a set changes, then applies it and records it on the node as one undo step', async () => {
      const { applySetToNode } = await withTwoSets()
      nodes.value = [nkaNode('1', 'NKA_x', 'NKA_2'), nkaNode('2', 'other', 'NKA_2')]

      expect(await applySetToNode('1', 'NKA')).toBe(true)

      expect(deps.confirm).toHaveBeenCalledWith(
        expect.objectContaining({
          header: 'Apply Parameter Set?',
          message: 'Applying NKA changes 1 value:',
          issues: [{ key: 'K_6', message: 'K_6: 1 → 30250.0' }],
        })
      )
      expect(deps.recordEdit).toHaveBeenCalledOnce()
      expect(deps.recordEdit).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'apply-parameter-set', nodeIds: ['1'], keys: ['variables', 'parameterisation'] })
      )
      expect(nodes.value[0].data).toMatchObject({ parameterisation: 'NKA', variables: [{ value: '30250.0' }, { value: '1' }] })
      expect(nodes.value[1].data).toMatchObject({ parameterisation: 'NKA_2', variables: [{ value: '1' }, { value: '1' }] })
    })

    it('changes nothing when cancelled', async () => {
      const { applySetToNode } = await withTwoSets()
      nodes.value = [nkaNode('1', 'NKA_x', 'NKA_2')]
      deps.confirm.mockResolvedValueOnce(false)

      expect(await applySetToNode('1', 'NKA')).toBe(false)

      expect(deps.recordEdit).not.toHaveBeenCalled()
      expect(nodes.value[0].data).toMatchObject({ parameterisation: 'NKA_2', variables: [{ value: '1' }, { value: '1' }] })
    })

    it('records the set without asking when it changes no value', async () => {
      const { applySetToNode } = await withTwoSets()
      const node = nkaNode('1', 'NKA_x')
      node.data.variables[0].value = '30250.0'
      nodes.value = [node]

      await applySetToNode('1', 'NKA')

      expect(deps.confirm).not.toHaveBeenCalled()
      expect(deps.recordEdit).toHaveBeenCalledOnce()
      expect(nodes.value[0].data.parameterisation).toBe('NKA')
    })

    it('does nothing for a set the math does not have', async () => {
      const { applySetToNode } = useParametersImport(deps)
      nodes.value = [nkaNode('1', 'NKA_x')]

      expect(await applySetToNode('1', 'missing')).toBe(false)
      expect(await applySetToNode('gone', 'NKA')).toBe(false)
      expect(deps.recordEdit).not.toHaveBeenCalled()
    })
  })
})
