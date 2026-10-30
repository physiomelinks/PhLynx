// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import BioCell from '../../../../src/components/bio/BioCell.vue'
import BioProtein from '../../../../src/components/bio/BioProtein.vue'
import ProteinGlyph from '../../../../src/components/bio/ProteinGlyph.vue'
import { GLYPHS } from '../../../../src/services/bioView/glyphs.js'

describe('physiological view artwork', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it.each(GLYPHS)('draws the %s cartoon', (glyph) => {
    const svg = mount(ProteinGlyph, { props: { glyph } }).find('svg')
    expect(svg.attributes('data-glyph')).toBe(glyph)
    expect(svg.findAll('.protein-glyph__body').length).toBeGreaterThan(0)
  })

  it('draws a cartoon it doesn’t know as a generic protein', () => {
    expect(mount(ProteinGlyph, { props: { glyph: 'blob' } }).find('svg').attributes('data-glyph')).toBe('generic')
  })

  it('shows movement into the cell, and keeps the pump’s ATP upright', () => {
    const arrowsOf = (glyph) => mount(ProteinGlyph, { props: { glyph } }).findAll('.protein-glyph__arrow')
    expect(arrowsOf('symporter')).toHaveLength(2)
    expect(arrowsOf('antiporter')).toHaveLength(2)
    expect(arrowsOf('generic')).toHaveLength(0)
    const pump = mount(ProteinGlyph, { props: { glyph: 'pump', rotation: 180 } })
    expect(pump.find('.protein-glyph__atp-label').attributes('transform')).toBe('rotate(-180 32 40)')
  })

  it('turns a protein’s cartoon with its facet and puts its name on the cell’s side', () => {
    const data = { name: 'p', glyph: 'pump', rotation: 180, outward: 'bottom' }
    const protein = mount(BioProtein, { props: { data } })
    expect(protein.find('.bio-protein__glyph').attributes('style')).toContain('rotate(180deg)')
    expect(protein.find('[data-testid=bio-protein]').classes()).toContain('bio-protein--label-top')
    expect(protein.find('.bio-protein__label').text()).toBe('p')
  })

  it('draws a cell’s membrane as a bilayer: two rows of head groups either side of its outline', () => {
    const cell = mount(BioCell, { props: { data: { name: 'c' }, width: 300, height: 200 } })
    const heads = cell.findAll('.bio-cell__heads')
    expect(heads).toHaveLength(2)
    // One leaflet just outside the outline, one just inside.
    expect(heads[0].attributes('d')).toMatch(/^M \d+ -7 /)
    expect(heads[1].attributes('d')).toMatch(/^M \d+ 7 /)
    expect(cell.find('.bio-cell__tails').exists()).toBe(true)
  })
})
