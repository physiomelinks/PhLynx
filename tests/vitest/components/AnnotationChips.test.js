// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'

import AnnotationChips from '../../../src/components/AnnotationChips.vue'
import { mirrorAnnotation, quantityOfPort } from '../../../src/services/annotations/couple.js'
import { loadToyNodes } from '../services/annotations/toyNodes.js'

let wrapper
let toy

/**
 * Mounts the chips attached to the document, so their teleported detail can be read.
 *
 * @param {Object} props
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountChips(props, { provide = {}, attrs = {} } = {}) {
  wrapper = mount(AnnotationChips, {
    props,
    attrs,
    attachTo: document.body,
    global: { plugins: [PrimeVue], directives: { tooltip: {}, hint: {} }, provide },
  })
  return wrapper
}

const chipTexts = () => wrapper.findAll('.annotation-chips .p-chip').map((chip) => chip.text())
const detail = () => document.body.querySelector('.annotation-detail')

describe('AnnotationChips', () => {
  beforeAll(async () => {
    toy = await loadToyNodes()
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
  })

  it('shows species, property and location as labelled chips', () => {
    mountChips({ annotation: toy.port('porter_in', 'c_A_i').annotation })
    expect(chipTexts()).toEqual(['Na⁺', 'concentration', 'cytoplasm'])
  })

  it('folds the chips past the limit into a "+N" chip', () => {
    mountChips({ annotation: toy.port('porter_in', 'c_A_i').annotation, limit: 1 })
    expect(chipTexts()).toEqual(['Na⁺', '+2'])
  })

  it('greys chips for a variable with no port', () => {
    mountChips({ annotation: toy.port('porter_in', 'c_A_i').annotation, muted: true })
    expect(wrapper.find('.annotation-chips').classes()).toContain('annotation-chips--muted')
  })

  it('shows the IRIs, place, subject and sidecar on hover', async () => {
    const port = toy.port('porter_in', 'c_A_i')
    const node = toy.node('porter_in')
    const quantity = {
      ...quantityOfPort(port, node, toy.context()),
      locations: [{ key: 'cytosol', label: 'cytosol', path: ['cell', 'cytosol'] }],
    }
    mountChips({ annotation: port.annotation, quantity, variable: 'c_A_i', isPlaced: true })

    await wrapper.find('.annotation-chips').trigger('mouseenter')
    await flushPromises()

    const text = detail().textContent
    expect(text).toContain('c_A_i')
    expect(text).toContain('reader')
    expect(text).toContain('CHEBI:29101')
    expect(text).toContain('OPB:00340')
    expect(text).toContain('GO:0005737')
    expect(text).toContain('./porter.cellml#v4y7hdahd')
    expect(text).toContain(port.annotation.source.mathRef)
    expect(detail().querySelector('[data-test="path"]').textContent).toBe('cell → cytosol')
    expect(detail().querySelector('a.annotation-detail__iri').getAttribute('href')).toMatch(/^http/)
  })

  it('names the places a placed instance’s quantity resolves to by their template labels', async () => {
    const port = toy.port('porter_in', 'c_A_o')
    const node = toy.node('porter_in')
    const quantity = quantityOfPort(port, node, toy.context([node]))
    mountChips({ annotation: port.annotation, quantity, variable: 'c_A_o', isPlaced: true })
    await wrapper.find('.annotation-chips').trigger('click')
    await flushPromises()
    expect(detail().querySelector('[data-place="0"]').textContent).toContain('Apical fluid (lumen)')
  })

  it('says a placed instance with no matching place has none resolved', async () => {
    const port = toy.port('outside', 'area')
    const node = toy.node('outside')
    mountChips({ annotation: port.annotation, quantity: quantityOfPort(port, node, toy.context([node])), isPlaced: true })
    await wrapper.find('.annotation-chips').trigger('click')
    await flushPromises()
    expect(detail().textContent).toContain('No place resolved')
  })

  it('says an unplaced instance has no place', async () => {
    mountChips({ annotation: toy.port('porter_in', 'c_A_i').annotation })
    await wrapper.find('.annotation-chips').trigger('click')
    await flushPromises()
    expect(detail().textContent).toContain('The instance is not placed')
  })

  it('names where a mirrored copy came from', async () => {
    const partner = toy.port('porter_in', 'c_A_i')
    const annotation = mirrorAnnotation(partner, toy.node('porter_in'), toy.node('cell'), toy.context())
    mountChips({ annotation })
    await wrapper.find('.annotation-chips').trigger('click')
    await flushPromises()
    expect(detail().querySelector('[data-test="copied-from"]').textContent).toContain('./porter.cellml#v4y7hdahd')
    expect(detail().querySelector('.annotation-detail__variable').textContent.trim()).toBe('No variable chosen yet')
  })

  it('puts attributes on the chips and reports whether the detail is open', async () => {
    mountChips({ annotation: toy.port('porter_in', 'c_A_i').annotation }, { attrs: { 'data-test': 'chips' } })
    const chips = wrapper.find('[data-test="chips"]')
    expect(chips.classes()).toContain('annotation-chips')
    expect(chips.attributes('aria-expanded')).toBe('false')
    await chips.trigger('keydown', { key: 'Enter' })
    await flushPromises()
    expect(detail()).not.toBeNull()
    expect(chips.attributes('aria-expanded')).toBe('true')
  })

  it('holds a host popover open while its detail is open', async () => {
    const host = { hold: vi.fn(), release: vi.fn() }
    mountChips({ annotation: toy.port('porter_in', 'c_A_i').annotation }, { provide: { annotationPopoverHost: host } })
    const chips = wrapper.find('.annotation-chips')
    await chips.trigger('click')
    await flushPromises()
    expect(host.hold).toHaveBeenCalledTimes(1)
    expect(host.release).not.toHaveBeenCalled()
    // Moving onto the detail and back keeps the hold balanced.
    detail().dispatchEvent(new MouseEvent('mouseenter'))
    detail().dispatchEvent(new MouseEvent('mouseleave'))
    await chips.trigger('click')
    await flushPromises()
    expect(host.hold).toHaveBeenCalledTimes(1)
    expect(host.release).toHaveBeenCalledTimes(1)
  })

  it('puts a self-located term and its own-place note on separate lines', async () => {
    const annotation = { subject: 'x', variable: 'area', property: 'OPB:00295', location: 'self+GO:0005886', role: 'owner' }
    mountChips({ annotation })
    await wrapper.find('.annotation-chips').trigger('click')
    await flushPromises()
    const location = [...detail().querySelectorAll('dt')].find((dt) => dt.textContent === 'Location').nextElementSibling
    expect(location.querySelector('.annotation-detail__iri').textContent).toBe('GO:0005886')
    expect(location.querySelector('div').textContent).toBe('Of this instance’s own place')
  })
})
