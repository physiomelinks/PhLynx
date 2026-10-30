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
    global: { plugins: [PrimeVue], directives: { tooltip: {} }, provide },
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

  it('shows the IRIs, place, ApiCoord path, subject and sidecar on hover', async () => {
    const port = toy.port('porter_in', 'c_A_i')
    const node = toy.node('porter_in')
    const quantity = quantityOfPort(port, node, toy.context())
    mountChips({ annotation: port.annotation, quantity, variable: 'c_A_i', isBound: true })

    await wrapper.find('.annotation-chips').trigger('mouseenter')
    await flushPromises()

    const text = detail().textContent
    expect(text).toContain('c_A_i')
    expect(text).toContain('reader')
    expect(text).toContain('CHEBI:29101')
    expect(text).toContain('OPB:00340')
    expect(text).toContain('GO:0005737')
    expect(text).toContain('./porter.cellml#porter.c_A_i')
    expect(text).toContain(port.annotation.source.mathRef)
    expect(detail().querySelector('[data-test="path"]').textContent).toBe(quantity.locations[0].path.join(' → '))
    expect(detail().querySelector('a.annotation-detail__iri').getAttribute('href')).toMatch(/^http/)
  })

  it('says an unbound instance has no place', async () => {
    mountChips({ annotation: toy.port('porter_in', 'c_A_i').annotation })
    await wrapper.find('.annotation-chips').trigger('click')
    await flushPromises()
    expect(detail().textContent).toContain('not bound to an ApiCoord')
  })

  it('names where a mirrored copy came from', async () => {
    const partner = toy.port('porter_in', 'c_A_i')
    const annotation = mirrorAnnotation(partner, toy.node('porter_in'), toy.node('cell'), toy.context())
    mountChips({ annotation })
    await wrapper.find('.annotation-chips').trigger('click')
    await flushPromises()
    expect(detail().querySelector('[data-test="copied-from"]').textContent).toContain('./porter.cellml#porter.c_A_i')
    expect(detail().querySelector('.annotation-detail__variable').textContent.trim()).toBe('No variable chosen yet')
  })

  it('outlines a low-confidence place, with its reason', async () => {
    const annotation = toy.port('porter_in', 'c_A_i').annotation
    const quantity = {
      ...annotation,
      locations: [{ key: 'lyph:x', confidence: 'low', path: ['coord_a'], why: 'Assumed: the only lyph' }],
    }
    mountChips({ annotation, quantity })
    expect(wrapper.find('.annotation-chip--location').classes()).toContain('annotation-chip--low')
    await wrapper.find('.annotation-chips').trigger('click')
    await flushPromises()
    expect(detail().textContent).toContain('Assumed: the only lyph')
    expect(detail().textContent).toContain('low confidence')
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
