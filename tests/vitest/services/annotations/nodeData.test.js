import { describe, expect, it } from 'vitest'

import { withAnnotationData, withoutApiCoord } from '../../../../src/services/annotations/nodeData.js'
import { buildInstance } from '../../../../src/services/import/buildWorkflow.js'

const apiCoord = { subject: 'https://phlynx.invalid/apicoords/model.cellml#pool', coordIri: 'x#coord_pool', name: 'pool' }

describe('withAnnotationData', () => {
  it('keeps the binding and reservoir state of a node rebuilt from a snapshot', () => {
    const snapshotData = { name: 'pool', mathRef: 'pool.cellml:pool', ports: [], variables: [], apiCoord, annotationOverlay: { heldConstant: true } }
    const rebuilt = buildInstance('n1', 'pool', 'instanceNode', snapshotData, [], { x: 0, y: 0 })
    expect(rebuilt.data.apiCoord).toBeUndefined()

    withAnnotationData(rebuilt.data, snapshotData)
    expect(rebuilt.data.apiCoord).toEqual(apiCoord)
    expect(rebuilt.data.annotationOverlay).toEqual({ heldConstant: true })
  })

  it('adds nothing for a node without annotations', () => {
    const data = { name: 'p' }
    expect(withAnnotationData(data, withoutApiCoord({ name: 'p', apiCoord }))).toEqual({ name: 'p' })
  })
})
