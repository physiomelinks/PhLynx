// @vitest-environment happy-dom
import { readFileSync } from 'fs'
import { resolve } from 'path'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it } from 'vitest'

import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import { editSidecar } from '../../../../src/services/annotations/sidecarEdit.js'
import { buildModularModel } from '../../../../src/services/export/modularCellml.js'
import { listElementIds, prepareSavedMath, stripIds, variableIdsOf } from '../../../../src/services/math/variableIds.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { extractComponentsFromCellmlString, prefixIdAttributes } from '../../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'
import { unitsFor } from '../export/toyWorkspace.js'

const FIXTURE = resolve(__dirname, '../../fixtures/annotations/mixed-ids')
const read = (name) => readFileSync(resolve(FIXTURE, name), 'utf8')
const CELLML = read('tank.cellml')
const TTL = read('tank.ttl')
const MATH_REF = 'tank.cellml:tank'
const IDS = new Map([
  ['c_A', 'v4rjndoly'],
  ['v_A', 'b4da56'],
  ['volume', 'b4da57'],
])

beforeAll(() => ensureLibCellmlReady(), 120000)

describe('mixed v… and b4da… variable ids', () => {
  it('keeps the ids on import', () => {
    const { xml, errors } = extractComponentsFromCellmlString(CELLML)
    expect(errors).toEqual([])
    expect(variableIdsOf(xml[0].math)).toEqual(IDS)
  })

  it('resolves every sidecar subject', async () => {
    const sidecar = await parseSidecar(TTL, { mathRef: MATH_REF, cellml: CELLML })
    expect(sidecar.unresolved).toEqual([])
    expect(sidecar.warnings).toEqual([])
    expect(sidecar.variables.map(({ variable, id }) => [variable, id])).toEqual([
      ['c_A', 'v4rjndoly'],
      ['volume', 'b4da57'],
    ])
  })

  it('keeps the ids through a math-editor save', () => {
    const edited = stripIds(CELLML).replace('<ci>k</ci><ci>c_A</ci>', '<cn>2</cn><ci>c_A</ci>')
    const saved = prepareSavedMath({ storedMath: CELLML, editedMath: edited, isMathChanged: true, renames: new Map() })
    expect(variableIdsOf(saved.math)).toEqual(IDS)
  })

  it('gives a newly annotated variable a fresh id that clashes with none', async () => {
    const saved = prepareSavedMath({ storedMath: CELLML, editedMath: stripIds(CELLML), isMathChanged: false, idsFor: ['k'] })
    const id = saved.ids.get('k')
    expect(id).toMatch(/^b4da[0-9a-f]+$/)
    expect([...listElementIds(CELLML), 'tank']).not.toContain(id)
    const text = await editSidecar(TTL, MATH_REF, {
      variables: new Map([['k', { property: 'OPB:00592', species: ['CHEBI:29101'], location: 'self' }]]),
      cellml: saved.math,
    })
    const sidecar = await parseSidecar(text, { mathRef: MATH_REF, cellml: saved.math })
    expect(sidecar.unresolved).toEqual([])
    expect(sidecar.variables.find(({ variable }) => variable === 'k')?.id).toBe(id)
  })

  it('prefixes each instance’s ids apart', () => {
    const a = prefixIdAttributes(CELLML, 'tank_a', ['t'])
    const b = prefixIdAttributes(CELLML, 'tank_b', ['t'])
    const idsA = listElementIds(a.xml)
    const idsB = listElementIds(b.xml)
    expect([...idsA].filter((id) => idsB.has(id))).toEqual([])
    expect(a.variableIds.get('volume')).toBe(a.idMap.get('b4da57'))
    expect(a.variableIds.get('c_A')).toBe(a.idMap.get('v4rjndoly'))
  })

  it('resolves the annotations of two instances against their shared module file', async () => {
    setActivePinia(createPinia())
    const library = useLibraryStore()
    library.addUnitsFile({ componentFile: 'units.cellml', model: unitsFor([CELLML]) })
    library.addMathFile('tank.cellml', [{ name: 'tank', math: CELLML }])
    library.setModuleAnnotations(MATH_REF, TTL)
    const nodes = ['tank_a', 'tank_b'].map((name, i) => ({
      id: `n${i}`,
      type: 'instanceNode',
      position: { x: 0, y: 0 },
      data: { name, mathRef: MATH_REF, variables: [], ports: [] },
    }))
    const { main, files, sidecars, warnings } = await buildModularModel(nodes, [], library, [], { check: false })
    expect(warnings).toEqual([])
    expect(main.match(/component_ref="tank"/g)).toHaveLength(2)
    expect(files.map(({ location }) => location)).toEqual(['tank.cellml'])
    expect(sidecars).toEqual([{ location: 'annotations/tank.cellml/tank.ttl', format: 'text/turtle', text: TTL }])
    const sidecar = await parseSidecar(sidecars[0].text, { mathRef: MATH_REF, cellml: files[0].text })
    expect(sidecar.unresolved).toEqual([])
    expect(sidecar.variables.map(({ id }) => id)).toEqual(['v4rjndoly', 'b4da57'])
  })
})
