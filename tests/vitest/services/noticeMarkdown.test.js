import { describe, expect, it } from 'vitest'

import { renderNoticeMarkdown } from '../../../src/services/noticeMarkdown'

/** The rendered description, parsed, to look into. */
function rendered(text) {
  const container = document.createElement('div')
  container.innerHTML = renderNoticeMarkdown(text)
  return container
}

describe('renderNoticeMarkdown', () => {
  it('renders nothing for no description', () => {
    expect(renderNoticeMarkdown('')).toBe('')
  })

  it('renders emphasis, lists, headings and code', () => {
    const html = rendered('## Highlights\n\n- **Bold** and _italic_\n- `code`\n\n1. first')
    expect(html.querySelector('h2').textContent).toBe('Highlights')
    expect(html.querySelector('ul strong').textContent).toBe('Bold')
    expect(html.querySelector('ul em').textContent).toBe('italic')
    expect(html.querySelector('code').textContent).toBe('code')
    expect(html.querySelector('ol li').textContent).toBe('first')
  })

  it('keeps a single line break', () => {
    expect(rendered('one\ntwo').querySelector('br')).not.toBeNull()
  })

  it('opens https links, written or bare, in a new tab', () => {
    const links = [...rendered('[issue](https://github.com/a/b/issues/1) and https://phlynx.com').querySelectorAll('a')]
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://github.com/a/b/issues/1', 'https://phlynx.com'])
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank')
      expect(link.getAttribute('rel')).toBe('noopener noreferrer')
    }
  })

  it.each([
    '[x](http://example.org/)',
    '[x](javascript:alert(1))',
    '[x](/docs/getting-started/whats-new)',
    '[x](data:text/html;base64,PHNjcmlwdD4=)',
  ])('does not link %s', (text) => {
    const html = rendered(text)
    expect(html.querySelector('a')).toBeNull()
    expect(html.textContent).toContain('[x](')
  })

  it.each(['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<b onclick=alert(1)>bold</b>'])(
    'shows the HTML %s as text',
    (text) => {
      const html = rendered(text)
      expect(html.querySelector('script, img, b')).toBeNull()
      expect(html.textContent.trim()).toBe(text)
    }
  )

  it('does not draw images', () => {
    const html = rendered('![tracker](https://example.org/pixel.png)')
    expect(html.querySelector('img')).toBeNull()
  })
})
