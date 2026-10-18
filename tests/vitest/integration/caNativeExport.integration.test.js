// @vitest-environment happy-dom
/**
 * The native circulatory_autogen export (Mode B) of the library's super-module models, imported as super instances:
 * it gives back the module array and super-module configs they came from, expands as CA would to the flat export
 * (Mode A), and imported again gives back the same model, its layout and exposed ports included.
 */
import fs from 'node:fs'
import path from 'node:path'

import JSZip from 'jszip'
import Papa from 'papaparse'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { generateExportZip } from '../../../src/services/export/ca.js'
import { caIdentityRequests } from '../../../src/services/export/caNative.js'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { indexExposures } from '../../../src/services/hierarchy/exposure.js'
import { buildCaModel, foldCaModel, PHLYNX_INTERFACE_KEY, PHLYNX_LAYOUT_KEY } from '../../../src/services/import/caFold.js'
import { parameterFileLoader } from '../../../src/services/import/caParameters.js'
import { normaliseModuleRecords } from '../../../src/services/import/caModuleArray.js'
import { compareCanonical } from '../../../src/services/testing/modelCompare.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../src/utils/cellml.js'
import { isSupermoduleInterface } from '../../../src/utils/hierarchy.js'
import { libraryOf, loadCaLibrary, parseCsv, readCa, systemModel } from '../helpers/caLibrary.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// Exporting through libcellml takes seconds per test on CI.
vi.setConfig({ testTimeout: 120000 })

const notified = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn(), info: vi.fn(), success: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify: notified }))

/** @returns {Promise<Object<string, string>>} A zip's text files by name. */
export async function readZip(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await zip.file(name).async('string')])))
}

const csvRows = (text) => Papa.parse(text, { header: true, skipEmptyLines: true }).data
// What the native export leaves out by design: a component's parameterisation, its values being the super-module's own
// or the host file's; and the keys PhLynx passes through.
const withoutParameterisation = ({ parameterisation: _p, ...record }) => record
// A record without lists has empty ones, as CA's dump_vessel_records writes them.
const comparable = (record, isComponent) => {
  const out = { inp_instances: [], out_instances: [], ...(isComponent(record) ? withoutParameterisation(record) : record) }
  for (const key of Object.keys(out)) if (key.startsWith('phlynx_')) delete out[key]
  if (out.submodules) out.submodules = out.submodules.map((sub) => comparable(sub, isComponent))
  return out
}
const byName = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name))

describe.each([
  { name: '3compartment_supermodules', dir: 'system_models/closed_loop_cvs/3compartment_supermodules' },
  { name: 'SN_simple_supermodules', dir: 'system_models/cellular/SN_simple_supermodules' },
])('the native circulatory_autogen export of $name, imported with super instances', ({ name, dir }) => {
  let store
  let load
  let configPaths
  let folded
  let files

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(async () => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    ;({ load, configPaths } = loadCaLibrary(store))
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(console, 'log').mockImplementation(() => {})
    const model = systemModel(dir)
    const library = libraryOf(store)
    const built = buildCaModel(model.rows, library, { load, hostRows: model.hostRows })
    for (const { name: global, value, units, data_reference } of built.globals) store.assignGlobalConstant(global, value, units, data_reference)
    folded = foldCaModel(built, library, { load })
    notified.info.mockClear()
    const expansion = expandHierarchy(folded.nodes, folded.edges)
    files = await readZip(await generateExportZip(name, expansion.nodes, expansion.edges, store, null, { hierarchy: folded }))
  })

  afterEach(() => vi.restoreAllMocks())

  it('gives back the module array it was imported from, writing no super-module flat', () => {
    const isComponent = (record) => !store.availableSupermodules.has(`${record.module_type}:${record.module_subtype}`)
    const source = JSON.parse(readCa(`${dir}/${name}_module_array.json`))
    const records = JSON.parse(files[`${name}_module_array.json`])
    const asSets = (record) => ({
      ...record,
      ...(record.inp_instances && { inp_instances: [...record.inp_instances].sort() }),
      ...(record.out_instances && { out_instances: [...record.out_instances].sort() }),
    })
    expect(byName(records.map((record) => asSets(comparable(record, isComponent))))).toEqual(
      byName(source.map((record) => asSets(comparable(record, isComponent))))
    )
    expect(notified.info.mock.calls.map(([note]) => note.title)).not.toContain('Super-modules Written Flat')
  })

  it("gives back each super-module's config, its own keys and submodules as the library has them", () => {
    const isComponent = (record) => !store.availableSupermodules.has(`${record.module_type}:${record.module_subtype}`)
    const configs = Object.entries(files).filter(([file]) => file.startsWith('supermodules/') && file.endsWith('_modules_config.json'))
    const used = [...new Set(folded.supermodules.map((sm) => sm.moduleRef))]
    expect(configs.map(([file]) => file).sort()).toEqual(
      used.map((ref) => ref.split(':')).map(([type, subtype]) => `supermodules/${type}/versions/${subtype}/${type}_${subtype}_modules_config.json`).sort()
    )
    for (const [file, text] of configs) {
      const [entry] = JSON.parse(text)
      const ref = `${entry.module_type}:${entry.module_subtype}`
      const [source] = JSON.parse(readCa(configPaths.get(ref)))
      const lists = (sub) => ({ ...sub, ...(sub.inp_instances && { inp_instances: [...sub.inp_instances].sort(), out_instances: [...sub.out_instances].sort() }) })
      const shape = (config) => ({ ...comparable(config, isComponent), submodules: comparable(config, isComponent).submodules.map(lists) })
      expect({ file, ...shape(entry) }).toEqual({ file, ...shape(source) })
      expect(entry[PHLYNX_LAYOUT_KEY]).toBeTruthy()
      expect(files[file.replace(/[^/]+$/, 'parameterisations/default/default_parameters.csv')]).toBeTruthy()
    }
  })

  it('expands as CA would to the modules, values and pairs of the flat export', async () => {
    const flatFiles = await readZip(await generateExportZip(name, ...Object.values(expandHierarchy(folded.nodes, folded.edges)).slice(0, 2), store))
    const nativeHost = csvRows(files[`${name}_parameters.csv`])
    expect(nativeHost.length).toBeLessThan(csvRows(flatFiles[`${name}_parameters.csv`]).length)
    for (const file of Object.keys(flatFiles).filter((file) => file.startsWith('modules/'))) expect({ file, text: files[file] }).toEqual({ file, text: flatFiles[file] })
  })

  it('writes a super-module changed from its template flat until it has an identity of its own, and never as the template', async () => {
    // A value of the innermost super-module's first module changes what it holds, and so what holds it.
    const changed = folded.supermodules[0]
    const leaf = folded.nodes.find((node) => node.data.scope === changed.smId && node.data.variables?.some((row) => row.type === 'constant'))
    const row = leaf.data.variables.find((r) => r.type === 'constant')
    row.value = String(Number(row.value || 0) + 1)
    const requests = caIdentityRequests(folded.nodes, folded.edges, store)
    expect(requests.find((request) => request.smId === changed.smId)).toMatchObject({ reason: 'changed', from: changed.moduleRef })
    expect(requests.every((request) => request.reason === 'changed')).toBe(true)

    const expansion = expandHierarchy(folded.nodes, folded.edges)
    notified.info.mockClear()
    const unnamed = await readZip(await generateExportZip(name, expansion.nodes, expansion.edges, store, null, { hierarchy: folded }))
    // What holds it is written flat with it, and so is all it holds.
    expect(Object.keys(unnamed).filter((file) => file.startsWith('supermodules/'))).toEqual([])
    const note = notified.info.mock.calls.map(([n]) => n).find((n) => n.title === 'Super-modules Written Flat')
    expect(note.items[0]).toContain(`was changed from library super-module ${changed.moduleRef}`)

    for (const request of requests) folded.nodes.find((node) => node.id === request.smId).data.supermodule.ca = request.suggestion
    const renamed = await readZip(await generateExportZip(name, expansion.nodes, expansion.edges, store, null, { hierarchy: folded }))
    const written = Object.keys(renamed).filter((file) => file.startsWith('supermodules/') && file.endsWith('_modules_config.json'))
    for (const { suggestion } of requests) {
      expect(written).toContain(`supermodules/${suggestion.module_type}/versions/${suggestion.module_subtype}/${suggestion.module_type}_${suggestion.module_subtype}_modules_config.json`)
    }
    const [type, subtype] = changed.moduleRef.split(':')
    expect(written.some((file) => file.includes(`/${type}/versions/${subtype}/`))).toBe(false)
    const [entry] = JSON.parse(renamed[written.find((file) => file.includes(requests[0].suggestion.module_subtype))])
    expect(entry.licence).toBeUndefined()
  })

  it('gives back the same model when imported again, its layout and exposed ports included', async () => {
    // As a folder of the zip is imported: its configs and parameter files into a library.
    setActivePinia(createPinia())
    const again = useLibraryStore()
    ;({ load } = loadCaLibrary(again))
    const paths = new Map()
    const parameterFiles = new Map()
    for (const [file, text] of Object.entries(files)) {
      if (file.startsWith('supermodules/') && file.endsWith('_modules_config.json')) {
        const entries = JSON.parse(text)
        for (const entry of entries) {
          again.availableSupermodules.delete(`${entry.module_type}:${entry.module_subtype}`)
          paths.set(`${entry.module_type}:${entry.module_subtype}`, file)
        }
        again.addConfigFile(file.split('/').at(-1), entries)
      } else if (file.endsWith('_parameters.csv') && file.startsWith('supermodules/')) parameterFiles.set(file, parseCsv(text))
    }
    const reload = parameterFileLoader(parameterFiles, paths)
    const records = normaliseModuleRecords(JSON.parse(files[`${name}_module_array.json`]), name)
    const library = libraryOf(again)
    for (const [global] of store.globalVariables) again.assignGlobalConstant(global, store.globalVariables.get(global).value, store.globalVariables.get(global).units, 'phlynx')
    const built = buildCaModel(records, library, { load: reload, hostRows: parseCsv(files[`${name}_parameters.csv`]) })
    const refolded = foldCaModel(built, library, { load: reload })

    const exposedOf = ({ nodes, edges }) => {
      const exposures = indexExposures(nodes, edges)
      return nodes.filter(isSupermoduleInterface).map((node) => [
        node.data.supermodule.ca,
        (exposures.get(node.id) ?? []).map(({ alias, label }) => ({ alias, label })),
      ])
    }
    const named = (graph) => {
      const childNames = new Map(graph.nodes.map((node) => [node.id, node.data.name]))
      return exposedOf(graph).map(([ca, ports]) => [ca, ports.map((port) => ({ ...port, alias: { ...port.alias, child: port.alias.child && [...childNames].find(([id]) => id.endsWith(`~${port.alias.child}`))?.[1] } }))])
    }
    expect(named(refolded)).toEqual(named(folded))
    expect(refolded.positioned.size).toBe(folded.supermodules.length)
    const positionsOf = (graph) => graph.nodes.filter((node) => node.data.scope).map((node) => [node.data.scope && graph.nodes.find((n) => n.id === node.data.scope)?.data.supermodule.ca.module_subtype, node.data.name ?? 'interface', node.position])
    expect(positionsOf(refolded).sort()).toEqual(positionsOf(folded).sort())

    const [first, second] = [expandHierarchy(folded.nodes, folded.edges), expandHierarchy(refolded.nodes, refolded.edges)]
    const values = (expansion) => Object.fromEntries(expansion.nodes.flatMap((node) => node.data.variables.map((row) => [`${node.data.name}.${row.name}`, row.value ?? null])))
    expect(values(second)).toEqual(values(first))
    const exportOf = async ({ nodes, edges }, library) => (await generateFlattenedModel(nodes, edges, library, [], { check: false, allowBcOnly: true })).text()
    expect(compareCanonical(await exportOf(second, again), await exportOf(first, store)).differences).toEqual([])
  })
})
