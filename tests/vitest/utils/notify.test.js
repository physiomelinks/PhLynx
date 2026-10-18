import { beforeEach, describe, expect, it, vi } from 'vitest'

const emit = vi.hoisted(() => vi.fn())
vi.mock('primevue/toasteventbus', () => ({ default: { emit } }))

import { escapeHtml, notify } from '../../../src/utils/notify.js'

describe('escapeHtml', () => {
  it('escapes markup characters', () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;')
  })
})

describe('notify', () => {
  beforeEach(() => emit.mockClear())

  const shown = () => emit.mock.calls[0][1]

  it('shows its items escaped, one per line', () => {
    notify.warning({ title: 'T', items: ['<img src=x onerror=alert(1)>', 'a & b'] })

    expect(shown()).toMatchObject({ severity: 'warn', summary: 'T', detail: '&lt;img src=x onerror=alert(1)&gt;<br>a &amp; b' })
  })

  it('shows a message as given', () => {
    notify.info({ message: 'one<br>two' })

    expect(shown().detail).toBe('one<br>two')
  })

  it('stays until closed when sticky, else for its type', () => {
    notify.warning({ items: ['x'], sticky: true })
    notify.warning({ items: ['x'] })

    expect(emit.mock.calls[0][1].life).toBeUndefined()
    expect(emit.mock.calls[1][1].life).toBe(3000)
  })
})
