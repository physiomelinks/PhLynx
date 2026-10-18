// @vitest-environment happy-dom
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import CaIdentityDialog from '../../../src/components/dialogs/CaIdentityDialog.vue'
import { useCaIdentityPrompt } from '../../../src/composables/useCaIdentityPrompt.js'

describe('CaIdentityDialog', () => {
  const prompt = useCaIdentityPrompt()
  let wrapper

  const pump = { smId: 'sm_1', name: 'pump', reason: 'new', suggestion: { module_type: 'pump', module_subtype: 'phlynx_v1' } }
  const valve = { smId: 'sm_2', name: 'valve', reason: 'changed', from: 'heart:Argus2026_v01', suggestion: { module_type: 'valve', module_subtype: 'phlynx_v1' } }

  /** Mounts the dialog, its content kept in place rather than teleported, and asks for some identities. */
  async function ask(requests = [pump]) {
    wrapper = mount(CaIdentityDialog, { global: { plugins: [PrimeVue], stubs: { teleport: true } } })
    const problemsOf = (identities) =>
      new Map(requests.map(({ smId }) => [smId, identities.get(smId)?.module_type === 'taken' ? 'Another super-module here is taken:phlynx_v1.' : null]))
    const answer = prompt.ask(requests, problemsOf)
    await nextTick()
    await nextTick()
    return answer
  }
  const button = (label) => wrapper.findAll('button').find((b) => b.text() === label)
  const confirmLabel = 'Keep identities and export'
  afterEach(() => {
    if (prompt.question.value) prompt.answer(null)
    wrapper?.unmount()
  })

  it('asks for every super-module in one table, offering the suggestions, and answers with the identities given', async () => {
    const answer = ask([pump, valve])
    await nextTick()
    expect(wrapper.find('#ca-identity-type-0').element.value).toBe('pump')
    expect(wrapper.find('#ca-identity-subtype-1').element.value).toBe('phlynx_v1')
    expect(wrapper.text()).toContain('changed from heart:Argus2026_v01')
    await wrapper.find('#ca-identity-subtype-0').setValue('v2')
    await button(confirmLabel).trigger('click')
    expect(await answer).toEqual(
      new Map([
        ['sm_1', { module_type: 'pump', module_subtype: 'v2' }],
        ['sm_2', { module_type: 'valve', module_subtype: 'phlynx_v1' }],
      ])
    )
  })

  it('refuses an identity with a problem, showing it by its row', async () => {
    ask()
    await nextTick()
    await wrapper.find('#ca-identity-type-0').setValue('taken')
    expect(wrapper.find('#ca-identity-problem-0').text()).toBe('Another super-module here is taken:phlynx_v1.')
    expect(button(confirmLabel).attributes('disabled')).toBeDefined()
  })

  it('answers with no identities to export flat', async () => {
    const answer = ask()
    await nextTick()
    await button('Export flat').trigger('click')
    expect(await answer).toEqual(new Map())
  })

  it('answers null to cancel the export, from Cancel or by closing it', async () => {
    let answer = ask()
    await nextTick()
    expect(wrapper.text()).toContain('Cancel stops the export')
    await button('Cancel').trigger('click')
    expect(await answer).toBeNull()
    wrapper.unmount()

    answer = ask()
    await nextTick()
    wrapper.findComponent({ name: 'Dialog' }).vm.$emit('update:visible', false)
    expect(await answer).toBeNull()
  })
})
