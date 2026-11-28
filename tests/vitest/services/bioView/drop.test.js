import { describe, expect, it } from 'vitest'

import { patchBioView, planRelayout } from '../../../../src/services/bioView/drop.js'

describe('laying the physiological view out again', () => {
  it('sends loose modules back to the tray or the cards, keeping skins and sites, and drops retired fields', () => {
    const bioViews = new Map([
      ['a', { role: 'membraneProtein', skin: 'pump', facet: 'lateral', at: 'left', position: { x: 1, y: 2 } }],
      ['b', { skin: 'channel' }],
      ['c', undefined],
      ['bound', { site: 'pieces/plasma-membrane.apical', order: 2 }],
      ['cell', { rect: { x: 0, y: 0, width: 1, height: 1 }, added: true }],
    ])
    expect(Object.fromEntries(planRelayout(bioViews))).toEqual({
      a: { skin: 'pump' },
      cell: {},
    })
  })

  it('drops fields set to undefined when patching', () => {
    expect(patchBioView({ site: 'pieces/x', order: 1 }, { order: undefined, skin: 'pump' })).toEqual({
      site: 'pieces/x',
      skin: 'pump',
    })
  })
})
