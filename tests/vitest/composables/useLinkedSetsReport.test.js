import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { effectScope, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useLinkedSetsReport } from '../../../src/composables/useLinkedSetsReport.js'
import { toParamSet, useDefaultParametersStore } from '../../../src/stores/defaultParametersStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { buildParametersReport } from '../../../src/utils/parameters/apply.js'
import { parseParametersJson } from '../../../src/utils/parameters/parse.js'

const resourceDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../resources/parameters')
const readResource = (name) => readFileSync(path.join(resourceDir, name), 'utf8')
const addConfig = () => useLibraryStore().addConfigFile('NKA_NKA_modules_config.json', JSON.parse(readResource('NKA_NKA_modules_config.json')))

/** Stores the NKA set unlinked, with a value no NKA variable takes and a `Scale_*`-like global the config types constant. */
async function addUnlinkedNka() {
  const file = await parseParametersJson(readResource('NKA_parameters.json'), 'NKA_parameters.json')
  file.values.set('K_99', { value: '1', units: '', data_reference: '', extra: {} })
  file.globals.set('K_6', file.values.get('K_6'))
  file.values.delete('K_6')
  useDefaultParametersStore().addSet(toParamSet(file, 'NKA_parameters.json'))
}

describe('useLinkedSetsReport', () => {
  let scope
  let show
  let report

  beforeEach(async () => {
    setActivePinia(createPinia())
    show = vi.fn()
    scope = effectScope()
    report = scope.run(() => useLinkedSetsReport(show))
    await addUnlinkedNka()
  })

  afterEach(() => scope.stop())

  it('reports the sets a config links, with their warnings, as it arrives', async () => {
    addConfig()
    await nextTick()

    expect(show).toHaveBeenCalledOnce()
    const [shown] = show.mock.calls[0]
    expect(shown).toMatchObject({ type: 'warning', title: 'Parameter Sets Linked with Warnings' })
    expect(shown.message).toContain('NKA (NKA.cellml:NKA)')
    expect(shown.message).toContain('`K_99` is not a variable of NKA.cellml:NKA')
    expect(shown.message).toContain('`K_6` is listed under global but NKA.cellml:NKA types it constant')
    expect(useDefaultParametersStore().recentLinks).toEqual([])
  })

  it('offers the linked sets to their instances first, reporting what that did', async () => {
    scope.stop()
    scope = effectScope()
    const applyLinks = vi.fn(async () => ({
      count: 2,
      uses: [{ ref: 'NKA', mathRef: 'NKA.cellml:NKA', nodeId: '1', nodeName: 'NKA', count: 2 }],
      defaultOnly: [],
      kept: [],
    }))
    report = scope.run(() => useLinkedSetsReport(show, applyLinks))

    await report.holdLinkReports(async () => addConfig())

    expect(applyLinks).toHaveBeenCalledWith([expect.objectContaining({ mathRef: 'NKA.cellml:NKA', ref: 'NKA', fileRef: 'NKA' })])
    expect(show).toHaveBeenCalledOnce()
    expect(show.mock.calls[0][0].message).toContain('Applied 2 values to NKA (2 values).')
  })

  it('holds the report until a flow ends, and leaves none for a later report', async () => {
    await report.holdLinkReports(async () => {
      addConfig()
      await nextTick()
      expect(show).not.toHaveBeenCalled()
    })

    expect(show).toHaveBeenCalledOnce()
    expect(buildParametersReport([{ fileName: 'other.json', ok: true, count: 1 }], useDefaultParametersStore().takeRecentLinks()).message)
      .not.toContain('NKA')
  })

  it('reports nothing once a flow\'s own parameters report took the links', async () => {
    await report.holdLinkReports(async () => {
      addConfig()
      useDefaultParametersStore().takeRecentLinks()
    })
    await nextTick()

    expect(show).not.toHaveBeenCalled()
  })
})
