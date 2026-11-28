// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import BioCell from '../../../../src/components/bio/BioCell.vue'
import BioRegion from '../../../../src/components/bio/BioRegion.vue'

const facetLabels = [
  { facetId: 'apical', label: 'Apical membrane', edge: 'top' },
  { facetId: 'basolateral', label: 'Basolateral membrane', edge: 'bottom' },
  { facetId: 'pre', label: 'Presynaptic', edge: 'right' },
  { facetId: 'post', label: 'Postsynaptic', edge: 'right' },
]
const cell = (data) => mount(BioCell, { props: { data: { name: 'Cell', ...data }, width: 240, height: 200 } })

describe('template artwork', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('draws a cell as a cell, its bilayer round it, never asking for a module', () => {
    // A cell is never without its module; for the moment it is made before it, it is drawn as one anyway.
    for (const data of [{ instance: 'bt-1' }, { empty: true, instance: 'bt-1', facetLabels }]) {
      const drawn = cell(data)
      expect(drawn.find('[data-testid=bio-bilayer]').exists()).toBe(true)
      expect(drawn.find('[data-testid=bio-empty-hint]').exists()).toBe(false)
    }
  })

  it('names a template cell’s facets along their edges, sharing an edge between two', () => {
    const labels = cell({ instance: 'bt-1', facetLabels }).findAll('[data-testid=bio-facet-label]')
    expect(labels.map((label) => [label.text(), label.classes().find((c) => c.startsWith('bio-cell__facet--'))])).toEqual([
      ['Apical membrane', 'bio-cell__facet--top'],
      ['Basolateral membrane', 'bio-cell__facet--bottom'],
      ['Presynaptic', 'bio-cell__facet--right'],
      ['Postsynaptic', 'bio-cell__facet--right'],
    ])
    expect(labels[2].attributes('style')).toContain('top: 0%')
    expect(labels[3].attributes('style')).toContain('top: 50%')
  })

  it('puts a facet’s name where the layout placed it, outside the membrane clear of the proteins', () => {
    const placed = [{ facetId: 'apical', label: 'Apical membrane', edge: 'top', x: 30, y: -26, width: 94, height: 12 }]
    const label = cell({ instance: 'bt-1', facetLabels: placed }).find('[data-testid=bio-facet-label]')
    const style = label.attributes('style')
    for (const part of ['left: 30px', 'top: -26px', 'width: 94px', 'height: 12px']) expect(style).toContain(part)
  })

  it('draws a compartment in its template’s tone and against its edge, never asking for a module', () => {
    const region = mount(BioRegion, {
      props: { data: { name: 'Synaptic cleft', empty: true, instance: 'bt-1', tone: 'violet', edge: 'right' } },
    })
    expect(region.classes()).toEqual(expect.arrayContaining(['bio-region--tone-violet', 'bio-region--edge-right']))
    expect(region.classes()).not.toContain('bio-region--empty')
    expect(region.find('[data-testid=bio-empty-hint]').exists()).toBe(false)
  })
})
