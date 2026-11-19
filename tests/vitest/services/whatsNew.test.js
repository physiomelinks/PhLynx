import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { parseWhatsNew, releaseOf, shouldAnnounce } from '../../../src/services/whatsNew'

describe('parseWhatsNew', () => {
  it('reads the release from the heading and the first sentence below it as plain text', () => {
    const page = "# What's New in PhLynx 0.7\n\nPhLynx 0.7 adds **lots**, and [more](../x.md). Every change is listed.\n\n## A"
    expect(parseWhatsNew(page)).toEqual({
      release: '0.7',
      title: "What's New in PhLynx 0.7",
      summary: 'PhLynx 0.7 adds lots, and more.',
    })
  })

  it('takes a release written with a patch number as its major.minor', () => {
    expect(parseWhatsNew('# New in 1.12.3\r\n\r\nText.').release).toBe('1.12')
  })

  it('has no summary when a section follows the heading', () => {
    expect(parseWhatsNew('# New in 1.2\n\n## Section').summary).toBe('')
  })

  it.each(['', null, 'No heading here.', '# What is new\n\nText.'])('reads no release from %j', (page) => {
    expect(parseWhatsNew(page)).toBeNull()
  })

  it('reads a release from the page in the docs', () => {
    const page = readFileSync(resolve(__dirname, '../../../docs/getting-started/whats-new.md'), 'utf8')
    const parsed = parseWhatsNew(page)
    expect(parsed.release).toMatch(/^\d+\.\d+$/)
    expect(parsed.summary).not.toBe('')
  })
})

describe('releaseOf', () => {
  it.each([
    ['0.7.0', '0.7'],
    ['0.7.3', '0.7'],
    ['1.0.0-beta.1', '1.0'],
    ['Dev', null],
    ['', null],
    [null, null],
  ])('%j is release %j', (version, release) => {
    expect(releaseOf(version)).toBe(release)
  })
})

describe('shouldAnnounce', () => {
  const announce = (overrides) =>
    shouldAnnounce({ version: '0.7.0', lastVersion: null, usedBefore: false, pageRelease: '0.7', ...overrides })

  it('announces a later major or minor release than the last one used', () => {
    expect(announce({ lastVersion: '0.6.0' })).toBe(true)
    expect(announce({ lastVersion: '0.5.4' })).toBe(true)
    expect(announce({ version: '1.0.0', lastVersion: '0.9.9', pageRelease: '1.0' })).toBe(true)
    expect(announce({ version: '0.10.0', lastVersion: '0.9.0', pageRelease: '0.10' })).toBe(true)
  })

  it('announces a release first reached at one of its patches', () => {
    expect(announce({ version: '0.7.2', lastVersion: '0.6.0' })).toBe(true)
  })

  it('does not announce the same release, a patch of it, or an earlier one', () => {
    expect(announce({ lastVersion: '0.7.0' })).toBe(false)
    expect(announce({ version: '0.7.1', lastVersion: '0.7.0' })).toBe(false)
    expect(announce({ lastVersion: '0.8.0' })).toBe(false)
  })

  it('announces to someone who used PhLynx before versions were recorded, and not to a new user', () => {
    expect(announce({ usedBefore: true })).toBe(true)
    expect(announce({ usedBefore: false })).toBe(false)
    expect(announce({ lastVersion: 'garbage', usedBefore: true })).toBe(true)
  })

  it('does not announce when the page describes another release, or the build has no version', () => {
    expect(announce({ lastVersion: '0.6.0', pageRelease: '0.6' })).toBe(false)
    expect(announce({ lastVersion: '0.6.0', pageRelease: null })).toBe(false)
    expect(announce({ version: 'Dev', lastVersion: '0.6.0' })).toBe(false)
  })
})
