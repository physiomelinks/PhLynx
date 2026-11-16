// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { collectSnapshotMath, getSnapshotMathSource } from '../../../src/services/flowSnapshotMath.js'
import { getModuleFormat } from '../../../src/services/moduleFormats.js'

const xml = (name) => `<model xmlns="http://www.cellml.org/cellml/2.0#" name="${name}">
  <component name="${name}">
    <variable name="t" units="second"/>
    <variable name="x" units="metre" initial_value="1.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><cn cellml:units="metre" xmlns:cellml="http://www.cellml.org/cellml/2.0#">0</cn></apply>
    </math>
  </component>
</model>`

const SOURCE = {
  format: 'celldl',
  document: '<svg xmlns="http://www.w3.org/2000/svg"><metadata id="celldl-rdf-metadata"/></svg>',
  documentUri: 'https://example.org/rc.celldl',
  elements: {
    'ID-1': {
      iri: 'https://example.org/rc.celldl#ID-1',
      kind: 'element',
      variables: [],
    },
  },
  generator: '@physiomelinks/bg2cellml',
}

const node = (id, mathRef) => ({ id, data: { name: id, mathRef } })

/** Snapshots the nodes' math as JSON and loads it into a fresh store, as the OMEX loader does. */
function roundTrip(nodes, store) {
  const { mathLibrary, mathSources } = collectSnapshotMath(nodes, store)
  const snapshot = JSON.parse(
    JSON.stringify({
      nodeData: nodes,
      mathLibrary,
      ...(Object.keys(mathSources).length ? { mathSources } : {}),
    })
  )

  setActivePinia(createPinia())
  const restored = useLibraryStore()
  for (const { data } of snapshot.nodeData) {
    restored.setMathSource(data.mathRef, getSnapshotMathSource(snapshot, data.mathHash))
    restored.addMath(data.mathRef, snapshot.mathLibrary[data.mathHash])
  }
  return { snapshot, restored }
}

describe('flow snapshot math', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
  })

  it('keeps a CellDL module’s diagram and format through the snapshot, so it stays locked', () => {
    store.setMathSource('file:rc', SOURCE)
    store.addMath('file:rc', xml('rc'))
    store.addMath('file:decay', xml('decay'))

    const { restored } = roundTrip([node('a', 'file:rc'), node('b', 'file:decay')], store)

    expect(restored.getMathSource('file:rc')).toEqual(SOURCE)
    expect(restored.getMathFormat('file:rc')).toBe('celldl')
    expect(getModuleFormat(restored.getMathFormat('file:rc')).isMathLocked).toBe(true)
    expect(restored.availableMath.get('file:rc')).toBe(store.availableMath.get('file:rc'))
    expect(restored.getMathFormat('file:decay')).toBe('cellml')
  })

  it('leaves a CellML-only snapshot as it was', () => {
    store.addMath('file:decay', xml('decay'))
    const { mathLibrary, mathSources } = collectSnapshotMath([node('a', 'file:decay'), node('b', 'file:decay')], store)

    expect(Object.keys(mathLibrary)).toEqual([store.getMathHashByRef('file:decay')])
    expect(mathSources).toEqual({})
  })

  it('gives the same math different hashes when only one has a source', () => {
    store.setMathSource('file:rc', SOURCE)
    store.addMath('file:rc', xml('same'))
    store.addMath('file:plain', xml('same'))

    const nodes = [node('a', 'file:rc'), node('b', 'file:plain')]
    const { snapshot, restored } = roundTrip(nodes, store)

    expect(snapshot.nodeData[0].data.mathHash).not.toBe(snapshot.nodeData[1].data.mathHash)
    expect(restored.getMathFormat('file:rc')).toBe('celldl')
    expect(restored.getMathSource('file:plain')).toBeNull()
  })

  it('drops a malformed source, so its math loads as CellML', () => {
    const snapshot = {
      mathSources: { h1: { format: 'celldl', document: 3, documentUri: 'x' } },
    }
    expect(getSnapshotMathSource(snapshot, 'h1')).toBeNull()
    expect(getSnapshotMathSource(snapshot, 'h2')).toBeNull()
    expect(getSnapshotMathSource({}, 'h1')).toBeNull()
  })
})
