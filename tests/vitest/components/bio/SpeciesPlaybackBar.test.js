// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import SpeciesPlaybackBar from '../../../../src/components/bio/SpeciesPlaybackBar.vue'
import { setChartZoom } from '../../../../src/services/simulation/chartZoom.js'
import { useSimulationResultsStore } from '../../../../src/stores/simulationResultsStore.js'
import { useVoiCursorStore } from '../../../../src/stores/voiCursorStore.js'

// The popover's content is shown only once opened, and then teleported: mounted in place here.
const Popover = { template: '<div><slot /></div>', emits: ['show'], methods: { toggle() {} } }

let wrapper
let cursor
const find = (id) => wrapper.find(`[data-testid="${id}"]`)

beforeEach(() => {
  setActivePinia(createPinia())
  cursor = useVoiCursorStore()
  useSimulationResultsStore().results = {
    voi: { name: 't', unit: 's', values: Float64Array.from([0, 1, 2, 3, 4]) },
    variables: new Map(),
  }
  wrapper = mount(SpeciesPlaybackBar, {
    global: { plugins: [PrimeVue], directives: { tooltip: Tooltip }, stubs: { Popover } },
  })
})
afterEach(() => wrapper.unmount())

describe('the species playback bar', () => {
  it('shows the end of the run until scrubbed, then offers the way back', async () => {
    expect(find('bio-species-voi').text()).toBe('t = 4 s')
    expect(find('bio-species-playback-reset').exists()).toBe(false)
    await find('bio-species-scrubber').setValue('1')
    expect(cursor.index).toBe(1)
    expect(find('bio-species-voi').text()).toBe('t = 1 s')
    await find('bio-species-playback-reset').trigger('click')
    expect(cursor.isActive).toBe(false)
  })

  it('plays and pauses from its button and the space bar, and steps with the arrows', async () => {
    await find('bio-species-play').trigger('click')
    expect(cursor.isPlaying).toBe(true)
    await find('bio-species-playback').trigger('keydown', { key: ' ' })
    expect(cursor.isPlaying).toBe(false)
    await find('bio-species-playback').trigger('keydown', { key: 'ArrowRight' })
    expect(cursor.index).toBe(1)
    await find('bio-species-playback').trigger('keydown', { key: 'ArrowLeft' })
    expect(cursor.index).toBe(0)
  })

  it('sets the speed as a time for the window or a rate, and the window by its ends', async () => {
    await find('bio-species-play-rate').setValue('2')
    await find('bio-species-play-rate').trigger('change')
    expect(cursor.playSeconds).toBe(2)
    await find('bio-species-window-from').setValue('1')
    await find('bio-species-window-from').trigger('change')
    expect(cursor.range).toEqual([1, 4])
    await find('bio-species-window-to').setValue('3')
    await find('bio-species-window-to').trigger('change')
    expect(cursor.range).toEqual([1, 3])
  })

  it('is not there without a run to follow', async () => {
    useSimulationResultsStore().results = null
    await wrapper.vm.$nextTick()
    expect(find('bio-species-playback').exists()).toBe(false)
  })

  it('takes its window from the plot zoomed last, once one is', async () => {
    expect(find('bio-species-window-zoom').attributes('disabled')).toBeDefined()
    setChartZoom('panel:a', { min: 0.5, max: 2 })
    setChartZoom('panel:b', { min: 1, max: 3 })
    await wrapper.findComponent(Popover).vm.$emit('show')
    await find('bio-species-window-zoom').trigger('click')
    expect(cursor.range).toEqual([1, 3])
    setChartZoom('panel:a', null)
    setChartZoom('panel:b', null)
  })

  it('has the plots mark the cursor for as long as it is there', () => {
    expect(cursor.isFollowed).toBe(true)
    wrapper.unmount()
    expect(cursor.isFollowed).toBe(false)
    wrapper = mount(SpeciesPlaybackBar, { global: { plugins: [PrimeVue], directives: { tooltip: Tooltip }, stubs: { Popover } } })
  })

  it('reads every point out to the same length, so the bar keeps its width, and goes back to the start', async () => {
    useSimulationResultsStore().results = {
      voi: { name: 't', unit: 's', values: Float64Array.from([0, 0.25, 0.5, 0.75, 1]) },
      variables: new Map(),
    }
    await wrapper.vm.$nextTick()
    const texts = []
    for (const point of ['0', '1', '2', '4']) {
      await find('bio-species-scrubber').setValue(point)
      texts.push(find('bio-species-voi').text())
    }
    expect(texts).toEqual(['t = 0.00 s', 't = 0.25 s', 't = 0.50 s', 't = 1.00 s'])
    expect(find('bio-species-voi').attributes('style')).toContain('min-width: 10ch')
    await find('bio-species-rewind').trigger('click')
    expect(cursor.index).toBe(0)
  })

  it('sets what a path’s width is compared with, and whether brief spikes set the scale', async () => {
    expect(cursor.flowScale).toEqual({ group: 'species', spikes: false })
    await find('bio-species-width-group').setValue('path')
    await find('bio-species-width-spikes').setValue(true)
    expect(cursor.flowScale).toEqual({ group: 'path', spikes: true })
  })
})
