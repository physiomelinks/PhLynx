// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import BioCell from '../../../../src/components/bio/BioCell.vue'
import BioMembrane from '../../../../src/components/bio/BioMembrane.vue'
import BioProtein from '../../../../src/components/bio/BioProtein.vue'
import ProteinGlyph from '../../../../src/components/bio/ProteinGlyph.vue'
import { GLYPHS } from '../../../../src/services/bioView/glyphs.js'
import { useNodeThemeStore } from '../../../../src/stores/nodeThemeStore.js'

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

  it('draws an arrow for each species it carries, one way when a run says which, both ways until then', () => {
    const arrows = [
      { label: 'Na⁺', direction: 'out' },
      { label: 'K⁺', direction: 'in' },
      { label: 'Glc', direction: null },
    ]
    const glyph = mount(ProteinGlyph, { props: { glyph: 'pump', rotation: 180, arrows } })
    const drawn = glyph.findAll('.protein-glyph__arrow')
    expect(drawn.map((a) => [a.attributes('data-species'), a.attributes('data-direction'), a.findAll('polygon').length])).toEqual([
      ['Na⁺', 'out', 1],
      ['K⁺', 'in', 1],
      ['Glc', 'both', 2],
    ])
    // Spread across the body.
    const xs = drawn.map((a) => Number(a.find('line').attributes('x1')))
    expect(new Set(xs).size).toBe(3)
    expect(glyph.find('.protein-glyph__atp-label').attributes('transform')).toBe('rotate(-180 52 34)')
  })

  it('names what a protein carries under its name, in the order its arrows show', () => {
    const arrows = [
      { label: 'Glc', direction: null },
      { label: 'Na⁺', direction: null },
    ]
    const species = (rotation) =>
      mount(BioProtein, { props: { data: { name: 'p', glyph: 'symporter', rotation, arrows } } }).find('[data-testid=bio-protein-species]').text()
    expect(species(0)).toBe('Glc · Na⁺')
    // Turned upside down on the basolateral membrane, or back onto a cell's left side, its arrows read
    // the other way; turned onto the right side, top to bottom is the same way.
    expect(species(180)).toBe('Na⁺ · Glc')
    expect(species(-90)).toBe('Na⁺ · Glc')
    expect(species(90)).toBe('Glc · Na⁺')
    expect(mount(BioProtein, { props: { data: { name: 'p' } } }).find('[data-testid=bio-protein-species]').exists()).toBe(false)
  })

  it('draws no arrows for a protein whose annotations say nothing it carries', () => {
    expect(mount(ProteinGlyph, { props: { glyph: 'symporter' } }).findAll('.protein-glyph__arrow')).toHaveLength(0)
  })

  it('runs a channel’s arrow down its pore, and several side by side in it', () => {
    const channel = (arrows) => mount(ProteinGlyph, { props: { glyph: 'channel', arrows } })
    expect(channel([{ label: 'K⁺', direction: 'out' }]).find('.protein-glyph__arrow line').attributes('x1')).toBe('32')
    const two = channel([
      { label: 'Na⁺', direction: 'in' },
      { label: 'K⁺', direction: 'out' },
    ]).findAll('.protein-glyph__arrow line')
    expect(two.map((line) => line.attributes('x1'))).toEqual(['29', '35'])
  })

  it('draws a protein in the cartoon palette whatever its diagram category, as the theme’s card tint hides its arrows', () => {
    useNodeThemeStore().setPreviewTheme({
      id: 'domain-types',
      name: 'Domain types',
      categories: [{ key: 'protein', label: 'Protein', color: '#d1fff0', dark: '#1d4a3c' }],
    })
    const style = (domainType) =>
      mount(BioProtein, { props: { data: { name: 'p', glyph: 'symporter', domainType } } })
        .find('[data-testid=bio-protein]')
        .attributes('style')
    // A workspace node the user coloured as a protein, and one dropped from the library with no category.
    expect(style('protein')).toBeUndefined()
    expect(style(null)).toBeUndefined()
  })

  it('makes a membrane hit only on its bilayer band, and draws its head groups when selected', () => {
    const membrane = (selected) =>
      mount(BioMembrane, { props: { data: { name: 'Membrane', width: 300, height: 200 }, selected } })
    const plain = membrane(false)
    expect(plain.findAll('.bio-membrane__band')).toHaveLength(1)
    expect(plain.find('.bio-membrane__band').attributes('stroke-width')).toBe('20')
    expect(plain.findAll('.bio-membrane__heads')).toHaveLength(0)
    const heads = membrane(true).find('.bio-membrane__heads')
    expect(heads.findAll('pattern circle.bio-bilayer__head')).toHaveLength(2)
    expect(heads.find('.bio-bilayer__tail').exists()).toBe(false)
  })

  it('shows only a cell’s inside selected when its membrane is a node of its own', () => {
    const cell = (membrane) =>
      mount(BioCell, { props: { data: { name: 'c', membrane }, selected: true, width: 300, height: 200 } })
    expect(cell('wall').find('[data-testid=bio-cell]').classes()).not.toContain('bio-cell--own-membrane')
    expect(cell('wall').find('[data-testid=bio-cell-selection]').exists()).toBe(true)
    expect(cell(null).find('[data-testid=bio-cell]').classes()).toContain('bio-cell--own-membrane')
    expect(cell(null).find('[data-testid=bio-cell-selection]').exists()).toBe(false)
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
    // One lipid, repeated along each straight side: a head group just outside the outline, one just inside.
    const pattern = cell.find('pattern')
    const across = (head) => Number(head.attributes('cy')) + Number(pattern.attributes('y'))
    expect(pattern.findAll('.bio-bilayer__head').map(across)).toEqual([-7, 7])
    expect(pattern.find('.bio-bilayer__tail').exists()).toBe(true)
    const strips = cell.findAll(`rect[fill="url(#${pattern.attributes('id')})"]`)
    expect(strips).toHaveLength(4)
    // Only the corners are dashed, outside and inside the outline.
    const corners = cell.findAll('.bio-bilayer__heads')
    expect(corners).toHaveLength(2)
    expect(corners[0].attributes('d')).toMatch(/^M -7 40 A 47 47 /)
    expect(corners[1].attributes('d')).toMatch(/^M 7 40 A 33 33 /)
    expect(cell.find('.bio-bilayer__tails').exists()).toBe(true)
  })
})
