// @vitest-environment happy-dom
import { defineComponent, h } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import { afterEach, describe, expect, it } from 'vitest'

import ConfirmDialog from '../../../src/components/ConfirmDialog.vue'
import { useConfirmDialog } from '../../../src/composables/useConfirmDialog'

let wrapper
let dialogs
afterEach(() => {
  wrapper?.unmount()
  document.body.innerHTML = ''
})

/** Mounts the app's confirm dialog with a host whose dialogs the test calls. */
function mountDialog() {
  const Host = defineComponent({
    setup() {
      dialogs = useConfirmDialog()
      return () => h(ConfirmDialog)
    },
  })
  wrapper = mount(Host, { global: { plugins: [PrimeVue, ConfirmationService] }, attachTo: document.body })
}

/** Asks a three-way question and clicks one of its buttons. */
async function chooseBy(label) {
  const answer = dialogs.choose({ header: 'Overwrite Math?', message: 'm', acceptLabel: 'Overwrite', extraLabel: 'Save as new component' })
  await flushPromises()
  const buttons = [...document.body.querySelectorAll('.confirm-actions button')]
  expect(buttons.map((button) => button.textContent.trim())).toEqual(['Cancel', 'Save as new component', 'Overwrite'])
  buttons.find((button) => button.textContent.trim() === label).click()
  return answer
}

describe('ConfirmDialog choose', () => {
  it.each([
    ['Overwrite', 'accept'],
    ['Save as new component', 'extra'],
    ['Cancel', 'reject'],
  ])('resolves %s as %s', async (label, choice) => {
    mountDialog()
    expect(await chooseBy(label)).toBe(choice)
  })

  it('focuses Save as new component, never Overwrite, so Enter saves as new', async () => {
    mountDialog()
    dialogs.choose({ header: 'Overwrite Math?', message: 'm', acceptLabel: 'Overwrite', extraLabel: 'Save as new component' })
    await flushPromises()
    const byLabel = (label) =>
      [...document.body.querySelectorAll('.confirm-actions button')].find((button) => button.textContent.trim() === label)
    expect(byLabel('Save as new component').hasAttribute('autofocus')).toBe(true)
    expect(byLabel('Overwrite').hasAttribute('autofocus')).toBe(false)
  })

  it('shows no third button for a plain confirm', async () => {
    mountDialog()
    dialogs.confirm({ header: 'Sure?', message: 'm', acceptLabel: 'Yes', rejectLabel: 'No' })
    await flushPromises()
    expect([...document.body.querySelectorAll('.confirm-actions button')].map((button) => button.textContent.trim())).toEqual(['No', 'Yes'])
  })
})

describe('ConfirmDialog issues', () => {
  it('lists issues, linking those that name an element, and closes on following one', async () => {
    mountDialog()
    const followed = []
    const answer = dialogs.alert({
      header: 'Diagram Has Errors',
      message: "The diagram can't be converted:",
      issues: [
        { key: 'error-0', message: 'no template', elementId: 'ID-1', label: 'R' },
        { key: 'error-1', message: 'no model' },
      ],
      onIssue: (issue) => followed.push(issue.elementId),
    })
    await flushPromises()
    const items = [...document.body.querySelectorAll('.confirm-issues li')]
    expect(items.map((item) => item.textContent.replace(/\s+/g, ' ').trim())).toEqual(['R no template', 'no model'])
    expect(items[1].querySelector('button')).toBeNull()
    items[0].querySelector('.confirm-issue-link').click()
    expect(await answer).toBe(false)
    expect(followed).toEqual(['ID-1'])
  })
})
