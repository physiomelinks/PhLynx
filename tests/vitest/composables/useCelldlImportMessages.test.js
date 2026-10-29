// The messages loadCelldlFiles shows, with the conversion stubbed.
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { importCelldl } = vi.hoisted(() => ({ importCelldl: vi.fn() }))
vi.mock('../../../src/services/celldl/importCelldl.js', () => ({ importCelldl }))
vi.mock('../../../src/utils/notify', () => ({ notify: { error: vi.fn(), success: vi.fn() } }))

import { useCelldlImport } from '../../../src/composables/useCelldlImport.js'
import { notify } from '../../../src/utils/notify'

const issue = (n) => ({ message: `bad <${n}>`, severity: 'error', stage: 'build', elementId: `e${n}` })

describe('useCelldlImport messages', () => {
  let confirm

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    confirm = vi.fn(async () => true)
  })

  it('lists five errors, escaped, and counts the rest', async () => {
    importCelldl.mockResolvedValueOnce({ ok: false, errors: [1, 2, 3, 4, 5, 6, 7].map(issue), warnings: [] })

    const [result] = await useCelldlImport({ confirm }).loadCelldlFiles([{ name: '<a>.celldl', content: '' }])

    expect(result).toEqual({ ok: false, name: '<a>.celldl', mathRef: undefined })
    const { message } = notify.error.mock.calls[0][0]
    expect(message.split('<br>')).toEqual([
      '&lt;a&gt;.celldl can&#39;t be imported:',
      ...[1, 2, 3, 4, 5].map((n) => `• e${n}: bad &lt;${n}&gt;`),
      '…and 2 more',
    ])
  })

  it('shows no error when warnings are declined', async () => {
    importCelldl.mockImplementationOnce(async (name, content, store, { confirmWarnings }) => {
      expect(await confirmWarnings([issue(1)])).toBe(false)
      return { ok: false, cancelled: true, errors: [], warnings: [issue(1)] }
    })
    confirm.mockResolvedValueOnce(false)

    await useCelldlImport({ confirm }).loadCelldlFiles([{ name: 'rc.celldl', content: '' }])

    expect(confirm.mock.calls[0][0].message).toBe('rc.celldl converted with warnings:\n• e1: bad <1>\n\nAdd it anyway?')
    expect(notify.error).not.toHaveBeenCalled()
  })

  it("reports a converter that doesn't start, and goes on to the next file", async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    importCelldl
      .mockRejectedValueOnce(new Error('no <wasm>'))
      .mockResolvedValueOnce({ ok: true, componentName: 'b', mathRef: 'b.cellml:b', errors: [], warnings: [] })

    const results = await useCelldlImport({ confirm }).loadCelldlFiles([
      { name: 'a.celldl', content: '' },
      { name: 'b.celldl', content: '' },
    ])

    expect(results).toEqual([
      { ok: false, name: 'a.celldl' },
      { ok: true, name: 'b.celldl', mathRef: 'b.cellml:b' },
    ])
    expect(notify.error).toHaveBeenCalledWith({
      title: 'CellDL Import Error',
      message: 'a.celldl can&#39;t be converted: no &lt;wasm&gt;',
    })
    expect(notify.success).toHaveBeenCalledWith({ title: 'CellDL Diagram Loaded', message: 'Added b from b.celldl.' })
  })
})
