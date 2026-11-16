import { afterEach, describe, expect, it } from 'vitest'
import {
  PLACEMENT_SOURCE,
  locationSource,
  registerLocationSource,
} from '../../../../src/services/annotations/locationSources.js'
import { nodeDataForCopy, withAnnotationData } from '../../../../src/services/annotations/nodeData.js'
import { buildCouplingContext, placesOf } from '../../../../src/services/annotations/couple.js'

describe('location sources', () => {
  let unregister = () => {}

  afterEach(() => unregister())

  it('uses physiology placement until another source is registered', () => {
    expect(locationSource()).toBe(PLACEMENT_SOURCE)
    expect(PLACEMENT_SOURCE.nodeKeys).toEqual(['bioView'])
    expect(PLACEMENT_SOURCE.workedRole({ id: 'a' }, { sidecar: null })).toBeNull()
  })

  it('puts a registered source in place, filling what it leaves out, until it is unregistered', () => {
    const stub = {
      id: 'stub',
      prepare: () => ({ placed: new Set(['a']) }),
      placeOf: (node, prepared) => (prepared.placed.has(node.id) ? [{ key: `stub:${node.id}`, kind: 'cytosol', as: ['self'] }] : []),
      workedRole: (node) => (node.data?.stubPlace ? { role: 'cytosol' } : null),
      nodeKeys: ['stubPlace'],
    }
    unregister = registerLocationSource(stub)
    const source = locationSource()
    expect(source.id).toBe('stub')
    expect(source.locate).toBe(PLACEMENT_SOURCE.locate)
    expect(source.rank).toBe(PLACEMENT_SOURCE.rank)

    const context = buildCouplingContext({ nodes: [{ id: 'a' }, { id: 'b' }], source })
    expect(placesOf({ id: 'a' }, context).map((place) => place.key)).toEqual(['stub:a'])
    expect(placesOf({ id: 'b' }, context)).toEqual([])
    expect(source.workedRole({ id: 'a', data: { stubPlace: 'x' } }, { sidecar: null })).toEqual({ role: 'cytosol' })

    unregister()
    expect(locationSource()).toBe(PLACEMENT_SOURCE)
  })

  it('keeps the source’s node keys through a snapshot rebuild, and leaves them off a pasted copy', () => {
    unregister = registerLocationSource({ id: 'stub', nodeKeys: ['stubPlace'] })
    const data = { name: 'a', stubPlace: 'p', bioView: { role: 'region', site: 'bt/x' } }
    expect(withAnnotationData({ name: 'a' }, data)).toEqual({ name: 'a', stubPlace: 'p', bioView: data.bioView })
    expect(nodeDataForCopy(data)).toEqual({ name: 'a', bioView: { role: 'region' } })
  })
})
