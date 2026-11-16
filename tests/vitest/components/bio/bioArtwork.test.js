// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import BioCard from '../../../../src/components/bio/BioCard.vue'
import BioCell from '../../../../src/components/bio/BioCell.vue'
import BioMembrane from '../../../../src/components/bio/BioMembrane.vue'
import BioProtein from '../../../../src/components/bio/BioProtein.vue'
import ProteinGlyph from '../../../../src/components/bio/ProteinGlyph.vue'
import { MEMBRANE_BAND_HALF } from '../../../../src/services/bioView/geometry.js'
import { GLYPHS, setLoadedGlyphs } from '../../../../src/services/bioView/glyphs.js'
import { useNodeThemeStore } from '../../../../src/stores/nodeThemeStore.js'

describe('physiological view artwork', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it.each(GLYPHS)('draws the %s cartoon', (glyph) => {
    const svg = mount(ProteinGlyph, { props: { glyph } }).find('svg')
    expect(svg.attributes('data-glyph')).toBe(glyph)
    // Painted in its body colour, filled or, for line art, stroked.
    const parts = svg.findAll('.protein-glyph__part')
    expect(parts.some((part) => /var\(--glyph-body\)/.test(part.attributes('style') ?? ''))).toBe(true)
  })

  it('draws a process card’s cartoon beside its name, and none when it has none', () => {
    const card = mount(BioCard, { props: { data: { name: 'ATP synthesis', glyph: 'mitochondrion' } } })
    expect(card.find('[data-testid="bio-card-glyph"]').attributes('data-glyph')).toBe('mitochondrion')
    expect(card.text()).toContain('ATP synthesis')
    expect(mount(BioCard, { props: { data: { name: 'plain' } } }).find('[data-testid="bio-card-glyph"]').exists()).toBe(false)
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
    expect(glyph.find('text').text()).toBe('ATP')
    expect(glyph.find('text').attributes('transform')).toBe('rotate(-180 52 34)')
  })

  it('keeps arrows clear of a receptor’s binding cleft, and anchors its outside face in the cleft', () => {
    const receptor = mount(ProteinGlyph, { props: { glyph: 'receptor', arrows: [{ label: 'L', direction: 'in' }] } })
    expect(receptor.find('.protein-glyph__arrow line').attributes('y1')).toBe('18')
    expect(receptor.find('path').attributes('d')).toContain('L 32 15')
  })

  it('draws a loaded glyph with its own palette for light and dark', () => {
    setLoadedGlyphs([
      {
        id: 'local:cup',
        name: 'Cup',
        viewBox: '0 0 64 48',
        elements: [
          { type: 'circle', cx: 32, cy: 24, r: 20, fill: 'body', stroke: 'none' },
          { type: 'rect', x: 30, y: 2, width: 4, height: 4, fill: 'arrow' },
        ],
        arrowRoom: { left: 20, right: 44, top: 8, bottom: 40, colour: 'outline' },
        palette: { light: { body: '#3366cc' }, dark: { body: '#99bbff' } },
      },
    ])
    const svg = mount(ProteinGlyph, { props: { glyph: 'local:cup', arrows: [{ label: 'X', direction: null }] } }).find('svg')
    expect(svg.attributes('data-glyph')).toBe('local:cup')
    expect(svg.attributes('style')).toContain('--glyph-body-light: #3366cc')
    expect(svg.attributes('style')).toContain('--glyph-body-dark: #99bbff')
    expect(svg.find('circle').attributes('style')).toContain('fill: var(--glyph-body)')
    expect(svg.find('.protein-glyph__arrow').attributes('style')).toContain('--glyph-arrow-ink: var(--glyph-outline)')
    // A shape painted with the arrow slot is not one of the arrows.
    expect(svg.findAll('.protein-glyph__arrow').map((a) => a.attributes('data-species'))).toEqual(['X'])
    setLoadedGlyphs([])
    expect(mount(ProteinGlyph, { props: { glyph: 'local:cup' } }).find('svg').attributes('data-glyph')).toBe('generic')
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
    // As wide as the band a drop on the membrane takes.
    expect(plain.find('.bio-membrane__band').attributes('stroke-width')).toBe(String(2 * MEMBRANE_BAND_HALF))
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

  it('glows a selected or coupled protein with its own shapes, not a filter', () => {
    const halo = (props) => mount(ProteinGlyph, { props: { glyph: 'pump', ...props } }).findAll('.protein-glyph__halo')
    expect(halo({})).toHaveLength(0)
    const selected = halo({ halo: 'selected' })
    expect(selected).toHaveLength(2)
    expect(selected[0].findAll('path, rect, circle').length).toBeGreaterThan(0)
    expect(selected[0].find('text').exists()).toBe(false)
    expect(halo({ halo: 'coupled' })).toHaveLength(2)
    const protein = mount(BioProtein, { props: { data: { name: 'p', glyph: 'pump' }, selected: true } })
    expect(protein.findAll('.protein-glyph__halo').length).toBeGreaterThan(0)
  })
})
