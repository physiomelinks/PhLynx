// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import BioZone from '../../../../src/components/bio/BioZone.vue'
import { isDefaultZoneLabel } from '../../../../src/services/bioView/pieces/constants.js'

const zone = (data, selected = false) =>
  mount(BioZone, { props: { data: { name: 'Process zone', ...data }, selected } })
const isQuiet = (wrapper) => wrapper.find('[data-testid=bio-zone-label]').classes().includes('bio-zone__label--quiet')

describe('a process zone', () => {
  it('asks for a module while empty, named in its corner', () => {
    const empty = zone({ empty: true, named: false })
    expect(empty.find('[data-testid=bio-empty-hint]').text()).toBe('Drop a module')
    expect(isQuiet(empty)).toBe(false)
  })

  it('drops the hint, and the name it was added with, once a module is in it', () => {
    const filled = zone({ empty: false, named: false })
    expect(filled.find('[data-testid=bio-empty-hint]').exists()).toBe(false)
    expect(isQuiet(filled)).toBe(true)
  })

  it('names itself again while selected', () => {
    expect(isQuiet(zone({ empty: false, named: false }, true))).toBe(false)
  })

  it('always shows a name someone gave it', () => {
    expect(isQuiet(zone({ name: 'Glycolysis', empty: false, named: true }))).toBe(false)
  })

  it('tells the names zones are added with from ones given them', () => {
    expect(isDefaultZoneLabel('Process zone')).toBe(true)
    expect(isDefaultZoneLabel('Process zone 3')).toBe(true)
    expect(isDefaultZoneLabel('Process zone of the rod')).toBe(false)
    expect(isDefaultZoneLabel('Mitochondria')).toBe(false)
  })
})
