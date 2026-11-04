import { describe, expect, it } from 'vitest'

import { variableNamesOf, withAnnotationData } from '../../../../src/services/annotations/nodeData.js'
import { buildInstance } from '../../../../src/services/import/buildWorkflow.js'

describe('withAnnotationData', () => {
  it('keeps the reservoir state of a node rebuilt from a snapshot', () => {
    const snapshotData = { name: 'pool', mathRef: 'pool.cellml:pool', ports: [], variables: [], annotationOverlay: { heldConstant: true } }
    const rebuilt = buildInstance('n1', 'pool', 'instanceNode', snapshotData, [], { x: 0, y: 0 })
    expect(rebuilt.data.annotationOverlay).toBeUndefined()

    withAnnotationData(rebuilt.data, snapshotData)
    expect(rebuilt.data.annotationOverlay).toEqual({ heldConstant: true })
  })

  it('adds nothing for a node without annotations', () => {
    const data = { name: 'p' }
    expect(withAnnotationData(data, { name: 'p' })).toEqual({ name: 'p' })
  })
})

describe('variableNamesOf', () => {
  it('lists a node’s variable rows, and nothing for a node without rows', () => {
    expect(variableNamesOf({ variables: [{ name: 'a' }, { name: 'b' }] })).toEqual(['a', 'b'])
    expect(variableNamesOf({})).toBeUndefined()
  })
})
