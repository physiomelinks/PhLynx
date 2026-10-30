// @vitest-environment happy-dom
import { nextTick, ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { suggestCouplings } from '../../../src/services/annotations/match.js'
import { useSuggestionStore } from '../../../src/stores/suggestionStore.js'
import { loadToy } from '../services/annotations/toyModel.js'

const nodes = ref([])
const viewport = ref({ x: 0, y: 0, zoom: 1 })

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  Panel: { name: 'Panel', props: ['position'], template: '<div class="panel-stub"><slot /></div>' },
  useVueFlow: () => ({ findNode: (id) => nodes.value.find((node) => node.id === id), viewport }),
}))

const { default: SuggestionLayer } = await import('../../../src/components/SuggestionLayer.vue')
const { default: SuggestionPanel } = await import('../../../src/components/SuggestionPanel.vue')

/** Keeps the tooltip's text on its element, to read back. */
const showTip = (el, { value }) => (el.dataset.tooltip = value ?? '')
const global = { plugins: [PrimeVue], directives: { tooltip: { mounted: showTip, updated: showTip } } }

const HELD = new Set(['outside', 'vessel'])

let toy, wrapper, store

/** A node laid out top to bottom, as Vue Flow gives it: computedPosition is where it is drawn. */
const flowNode = (name, y) => ({
  id: name,
  position: { x: 999, y: 999 },
  computedPosition: { x: 0, y },
  dimensions: { width: 100, height: 40 },
  data: { name: `${name}_instance` },
})

describe('suggestions on the canvas', () => {
  beforeAll(async () => {
    toy = await loadToy()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useSuggestionStore()
    const { suggestions } = suggestCouplings(toy.instances, {
      coords: toy.coords,
      scopes: toy.scopes,
      heldConstant: HELD,
    })
    store.setSuggestions(suggestions)
    viewport.value = { x: 0, y: 0, zoom: 1 }
    nodes.value = ['outside', 'porter_in', 'cell', 'wall', 'porter_out', 'vessel'].map((name, i) =>
      flowNode(name, i * 100),
    )
  })

  afterEach(() => {
    wrapper?.unmount()
    document.body.innerHTML = ''
  })

  describe('SuggestionLayer', () => {
    const mountLayer = () => (wrapper = mount(SuggestionLayer, { global, attachTo: document.body }))

    it('draws each suggestion between its nodes’ facing sides, dotted when low confidence', () => {
      mountLayer()
      const badges = wrapper.findAll('.suggested-edge__badge')
      expect(badges).toHaveLength(6)
      const lines = wrapper.findAll('.suggested-edge__line')
      expect(lines.filter((line) => line.classes('suggested-edge__line--low'))).toHaveLength(1)

      // outside sits above porter_in: from outside's bottom middle (50, 40) to porter_in's top (50, 100).
      const first = wrapper.find('[data-suggestion="outside->porter_in"]')
      expect(first.attributes('style')).toContain('translate(50px, 70px)')
      expect(lines[0].attributes('d')).toMatch(/^M\s?50[ ,]40/)
    })

    it('skips a suggestion whose node is gone', async () => {
      mountLayer()
      nodes.value = nodes.value.filter((node) => node.id !== 'vessel')
      await nextTick()
      expect(wrapper.findAll('.suggested-edge__badge')).toHaveLength(5)
    })

    it('says why a low-confidence suggestion is unsure', () => {
      mountLayer()
      const why = wrapper.find('[data-suggestion="porter_out->vessel"] [data-test="why"]')
      expect(why.attributes('data-tooltip')).toMatch(/only lyph with api:coalescedWith/)
      expect(wrapper.find('[data-suggestion="outside->porter_in"] [data-test="why"]').exists()).toBe(false)
    })

    it('passes Accept and Dismiss on with their suggestion', async () => {
      mountLayer()
      const badge = wrapper.find('[data-suggestion="porter_in->cell"]')
      await badge.find('[data-test="accept"]').trigger('click')
      await badge.find('[data-test="dismiss"]').trigger('click')
      expect(wrapper.emitted('accept')[0][0].key).toBe('porter_in->cell')
      expect(wrapper.emitted('dismiss')[0][0].key).toBe('porter_in->cell')
    })

    it('keeps the badges legible when zoomed out', async () => {
      mountLayer()
      const badge = () => wrapper.find('[data-suggestion="outside->porter_in"]').attributes('style')
      expect(badge()).toContain('scale(1)')
      viewport.value = { x: 0, y: 0, zoom: 0.5 }
      await nextTick()
      expect(badge()).toContain('scale(1.5)')
      viewport.value = { x: 0, y: 0, zoom: 0.25 }
      await nextTick()
      expect(badge()).toContain('scale(1.5)')
      viewport.value = { x: 0, y: 0, zoom: 1.5 }
      await nextTick()
      expect(badge()).toContain('scale(1)')
    })

    it('names the connection on its buttons, and opens the couplings from the keyboard', async () => {
      mountLayer()
      const badge = wrapper.find('[data-suggestion="porter_in->cell"]')
      expect(badge.find('[data-test="accept"]').attributes('aria-label')).toBe('Accept porter_in_instance to cell_instance')
      expect(badge.find('[data-test="dismiss"]').attributes('aria-label')).toBe(
        'Dismiss porter_in_instance to cell_instance',
      )
      const count = badge.find('[data-test="couplings"]')
      expect(count.attributes('tabindex')).toBe('0')
      await count.trigger('focus')
      await flushPromises()
      expect(document.body.querySelector('.suggestion-detail')).not.toBeNull()
    })

    it('stays open while a coupling’s chip detail is open', async () => {
      vi.useFakeTimers()
      try {
        mountLayer()
        await wrapper.find('[data-suggestion="porter_in->cell"] [data-test="couplings"]').trigger('mouseenter')
        await flushPromises()
        const detail = document.body.querySelector('.suggestion-detail')
        detail.querySelector('.annotation-chips').dispatchEvent(new MouseEvent('click', { bubbles: true }))
        detail.dispatchEvent(new MouseEvent('mouseleave'))
        vi.advanceTimersByTime(500)
        await flushPromises()
        expect(document.body.querySelector('.suggestion-detail')).not.toBeNull()
        expect(document.body.querySelector('.annotation-detail')).not.toBeNull()
      } finally {
        vi.useRealTimers()
      }
    })

    it('lists the couplings as annotation chip pairs on hover', async () => {
      mountLayer()
      await wrapper.find('[data-suggestion="porter_in->cell"] [data-test="couplings"]').trigger('mouseenter')
      await flushPromises()
      const detail = document.body.querySelector('.suggestion-detail')
      expect(detail.textContent).toContain('porter_in_instance → cell_instance')
      const couplings = detail.querySelectorAll('.suggestion-detail__coupling')
      expect(couplings).toHaveLength(3)
      expect(couplings[1].querySelectorAll('.annotation-chips')).toHaveLength(2)
      expect([...couplings].map((c) => [...c.querySelectorAll('code')].map((code) => code.textContent))).toEqual([
        ['area', 'area'],
        ['c_A_i', 'c_A'],
        ['v_A_i', 'v_A'],
      ])
    })
  })

  describe('SuggestionPanel', () => {
    it('counts the suggestions and offers Accept all and Dismiss all', async () => {
      wrapper = mount(SuggestionPanel, { global })
      expect(wrapper.find('[data-test="count"]').text()).toBe('6 suggested connections (1 low confidence)')
      await wrapper.find('[data-test="accept-all"]').trigger('click')
      await wrapper.find('[data-test="dismiss-all"]').trigger('click')
      expect(wrapper.emitted('accept-all')).toHaveLength(1)
      expect(wrapper.emitted('dismiss-all')).toHaveLength(1)
    })

    it('offers the dismissed suggestions back', async () => {
      wrapper = mount(SuggestionPanel, { global })
      store.setSuggestions([], [], [store.suggestions[0]])
      await nextTick()
      expect(wrapper.find('[data-test="count"]').exists()).toBe(false)
      expect(wrapper.find('[data-test="accept-all"]').exists()).toBe(false)
      const restore = wrapper.find('[data-test="restore-dismissed"]')
      expect(restore.text()).toBe('Show 1 dismissed')
      await restore.trigger('click')
      expect(wrapper.emitted('restore-dismissed')).toHaveLength(1)
    })

    it('is hidden without suggestions', async () => {
      wrapper = mount(SuggestionPanel, { global })
      store.setSuggestions([])
      await nextTick()
      expect(wrapper.find('.panel-stub').exists()).toBe(false)
    })
  })
})
