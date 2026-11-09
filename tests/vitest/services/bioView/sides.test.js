import { describe, expect, it } from 'vitest'

import { GO } from '../../../../src/services/annotations/iris.js'
import { sideOf } from '../../../../src/services/bioView/sides.js'

describe('the side of its membrane a protein’s quantity is on', () => {
  it('reads the GO cellular components, plain or relative to the instance', () => {
    expect(sideOf(GO.extracellularRegion)).toBe('outside')
    expect(sideOf(GO.cytoplasm)).toBe('inside')
    expect(sideOf(`self+${GO.cytoplasm}`)).toBe('inside')
    expect(sideOf(GO.plasmaMembrane)).toBe('membrane')
    expect(sideOf('self')).toBe('membrane')
  })

  it('says nothing of other places', () => {
    expect(sideOf('GO:0005634')).toBeNull()
    expect(sideOf(null)).toBeNull()
  })
})
