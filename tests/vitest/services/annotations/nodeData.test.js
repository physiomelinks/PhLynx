import { describe, expect, it } from 'vitest'

import { nodeDataForCopy, variableNamesOf, withAnnotationData } from '../../../../src/services/annotations/nodeData.js'
import { buildInstance } from '../../../../src/services/import/buildWorkflow.js'

describe('withAnnotationData', () => {
  it('keeps the reservoir state of a node rebuilt from a snapshot', () => {
    const snapshotData = { name: 'pool', mathRef: 'pool.cellml:pool', ports: [], variables: [], annotationOverlay: { heldConstant: true } }
    const rebuilt = buildInstance('n1', 'pool', 'instanceNode', snapshotData, [], { x: 0, y: 0 })
    expect(rebuilt.data.annotationOverlay).toBeUndefined()

    withAnnotationData(rebuilt.data, snapshotData)
    expect(rebuilt.data.annotationOverlay).toEqual({ heldConstant: true })
  })

  it('keeps a node’s place in the physiological view', () => {
    const bioView = { facet: 'basolateral', order: 2, glyph: 'pump' }
    const rebuilt = buildInstance('n1', 'pump', 'instanceNode', { name: 'pump', ports: [], variables: [], bioView }, [], { x: 0, y: 0 })
    withAnnotationData(rebuilt.data, { bioView })
    expect(rebuilt.data.bioView).toEqual(bioView)
  })

  it('adds nothing for a node without annotations', () => {
    const data = { name: 'p' }
    expect(withAnnotationData(data, { name: 'p' })).toEqual({ name: 'p' })
  })
})

describe('nodeDataForCopy', () => {
  it('keeps only the user’s role and glyph of a copy’s bioView', () => {
    const data = { name: 'p', bioView: { role: 'membraneProtein', glyph: 'pump', cell: 'n2', facet: 'apical', order: 1 } }
    expect(nodeDataForCopy(data)).toEqual({ name: 'p', bioView: { role: 'membraneProtein', glyph: 'pump' } })
  })

  it('drops a bioView with nothing left in it', () => {
    expect(nodeDataForCopy({ name: 'p', bioView: { facet: 'apical' } })).toEqual({ name: 'p' })
  })
})

describe('variableNamesOf', () => {
  it('lists a node’s variable rows, and nothing for a node without rows', () => {
    expect(variableNamesOf({ variables: [{ name: 'a' }, { name: 'b' }] })).toEqual(['a', 'b'])
    expect(variableNamesOf({})).toBeUndefined()
  })
})
