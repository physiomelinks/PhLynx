import { describe, expect, it } from 'vitest'

import { feedNoticeIds, isUsableFeed, noticesFor } from '../../../src/services/notices'

const NOW = Date.parse('2026-11-12T12:00:00Z')

const entry = (overrides = {}) => ({
  id: 'one',
  title: 'A notice',
  targets: ['phlynx'],
  ...overrides,
})
const feedOf = (...notices) => ({ schema: 1, notices })
const shown = (feed, version = '0.6.0') => noticesFor(feed, { version, now: NOW })
const shownIds = (feed, version) => shown(feed, version).map((notice) => notice.id)

describe('isUsableFeed', () => {
  it('accepts a schema 1 feed with a list of notices', () => {
    expect(isUsableFeed(feedOf())).toBe(true)
  })

  it.each([null, 'text', [], {}, { schema: 2, notices: [] }, { schema: 1 }, { schema: 1, notices: {} }])(
    'rejects %j',
    (feed) => {
      expect(isUsableFeed(feed)).toBe(false)
      expect(noticesFor(feed)).toEqual([])
      expect(feedNoticeIds(feed).size).toBe(0)
    }
  )
})

describe('noticesFor', () => {
  it('normalises a notice, defaulting what is optional', () => {
    expect(shown(feedOf(entry()))).toEqual([
      { id: 'one', title: 'A notice', description: '', link: null, severity: 'info', published: null },
    ])
  })

  it('keeps the description, link, severity and publication date', () => {
    const [notice] = shown(
      feedOf(
        entry({
          description: ' Re-save older workspaces. ',
          link: 'https://github.com/physiomelinks/phlynx/issues/1',
          severity: 'warning',
          published: '2026-11-01',
          futureField: { ignored: true },
        })
      )
    )
    expect(notice).toEqual({
      id: 'one',
      title: 'A notice',
      description: 'Re-save older workspaces.',
      link: 'https://github.com/physiomelinks/phlynx/issues/1',
      severity: 'warning',
      published: Date.parse('2026-11-01'),
    })
  })

  it('shows notices for this app or for all, and no others', () => {
    const feed = feedOf(
      entry({ id: 'mine' }),
      entry({ id: 'everyone', targets: ['all'] }),
      entry({ id: 'both', targets: ['cuflynx', 'phlynx'] }),
      entry({ id: 'theirs', targets: ['cuflynx'] }),
      entry({ id: 'nobody', targets: [] }),
      entry({ id: 'untargeted', targets: undefined }),
      entry({ id: 'text-target', targets: 'phlynx' })
    )
    expect(shownIds(feed)).toEqual(['mine', 'everyone', 'both'])
  })

  it("applies this app's version range, ignoring the ranges of other apps", () => {
    const feed = feedOf(
      entry({ id: 'old', versions: { phlynx: '<0.8.0' } }),
      entry({ id: 'new', versions: { phlynx: '>=0.8.0' } }),
      entry({ id: 'other', versions: { cuflynx: '>=9.0.0' } }),
      entry({ id: 'bad-range', versions: { phlynx: 'not a range' } }),
      entry({ id: 'not-text', versions: { phlynx: 8 } })
    )
    expect(shownIds(feed, '0.6.0')).toEqual(['old', 'other'])
    expect(shownIds(feed, '0.8.0')).toEqual(['new', 'other'])
    expect(shownIds(feed, '0.8.0-beta.1')).toEqual(['old', 'other'])
  })

  it('shows a version-ranged notice to a build that cannot name its version', () => {
    expect(shownIds(feedOf(entry({ versions: { phlynx: '<0.8.0' } })), 'Dev')).toEqual(['one'])
  })

  it('hides notices not yet published or already expired', () => {
    const feed = feedOf(
      entry({ id: 'current', published: '2026-11-01', expires: '2026-12-01' }),
      entry({ id: 'scheduled', published: '2026-11-13' }),
      entry({ id: 'expired', expires: '2026-11-12' }),
      entry({ id: 'bad-dates', published: 'soon', expires: 42 })
    )
    expect(shownIds(feed)).toEqual(['current', 'bad-dates'])
  })

  it('orders notices newest first, with undated ones last in feed order', () => {
    const feed = feedOf(
      entry({ id: 'undated-a' }),
      entry({ id: 'older', published: '2026-10-01' }),
      entry({ id: 'undated-b' }),
      entry({ id: 'newer', published: '2026-11-01' })
    )
    expect(shownIds(feed)).toEqual(['newer', 'older', 'undated-a', 'undated-b'])
  })

  it('skips entries without an id or title, repeats of an id, and anything that is not an entry', () => {
    const feed = feedOf(
      null,
      'text',
      [],
      entry({ id: '' }),
      entry({ id: 7 }),
      entry({ id: 'untitled', title: '  ' }),
      entry({ id: 'kept' }),
      entry({ id: 'kept', title: 'A repeat' })
    )
    expect(shown(feed).map((notice) => notice.title)).toEqual(['A notice'])
  })

  it.each(['http://example.org/', 'javascript:alert(1)', 'not a url', 12])('drops the link %j', (link) => {
    expect(shown(feedOf(entry({ link })))[0].link).toBeNull()
  })

  it('shows an unknown severity as info', () => {
    expect(shown(feedOf(entry({ severity: 'apocalyptic' })))[0].severity).toBe('info')
    expect(shown(feedOf(entry({ severity: 'critical' })))[0].severity).toBe('critical')
  })
})

describe('feedNoticeIds', () => {
  it('lists every id in the feed, whoever it is for', () => {
    const feed = feedOf(entry({ id: 'mine' }), entry({ id: 'theirs', targets: ['cuflynx'] }), null, { id: 3 })
    expect([...feedNoticeIds(feed)]).toEqual(['mine', 'theirs'])
  })
})
