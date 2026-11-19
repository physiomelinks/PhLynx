import coerce from 'semver/functions/coerce.js'
import valid from 'semver/functions/valid.js'

/** Where the What's New page is shown in the app. */
export const WHATS_NEW_PATH = '/docs/getting-started/whats-new'

/**
 * The release a What's New page describes, read from its first heading ("What's New in PhLynx 0.7"), and the first
 * paragraph below it as plain text.
 *
 * @param {string} markdown - The page's Markdown.
 * @returns {{release: string, title: string, summary: string}|null} Null when the heading names no release.
 */
export function parseWhatsNew(markdown) {
  const text = String(markdown ?? '').replace(/\r\n/g, '\n')
  const heading = /^# +(.+?) *$/m.exec(text)
  if (!heading) return null
  const release = /(\d+)\.(\d+)(?:\.\d+)?\s*$/.exec(heading[1])
  if (!release) return null

  const afterHeading = text.slice(heading.index + heading[0].length).trim()
  const paragraph = afterHeading.split(/\n\s*\n/)[0] ?? ''
  const summary = paragraph.startsWith('#') ? '' : plainText(paragraph)
  // Only the sentence that says what the release brings: the rest of the paragraph points about the page.
  const firstSentence = /^.*?[.!?](?=\s|$)/.exec(summary)?.[0] ?? summary

  return { release: `${release[1]}.${release[2]}`, title: heading[1], summary: firstSentence }
}

/** Markdown as the text a reader sees: links as their words, emphasis and code marks dropped. */
function plainText(markdown) {
  return markdown
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__|\*|_|`)(.+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The major.minor of a version, such as 0.7 for 0.7.2, or null when it is not a version. */
export function releaseOf(version) {
  if (!valid(version)) return null
  const parsed = coerce(version)
  return `${parsed.major}.${parsed.minor}`
}

const releaseRank = (release) => release.split('.').map(Number)

/** Whether release `a` (major.minor) comes after release `b`. */
function isLaterRelease(a, b) {
  const [aMajor, aMinor] = releaseRank(a)
  const [bMajor, bMinor] = releaseRank(b)
  return aMajor !== bMajor ? aMajor > bMajor : aMinor > bMinor
}

/**
 * Whether to tell the user about this release.
 *
 * Told: someone who last used an earlier major or minor release - or, when no release was recorded, someone who has
 * used PhLynx before - and only when the What's New page describes this release. Not told: new users, a patch
 * release, or a build whose page is out of date.
 *
 * @param {object} options
 * @param {string} options.version - This build's version.
 * @param {string|null} options.lastVersion - The version recorded on the last visit, if any.
 * @param {boolean} options.usedBefore - Whether there are signs of an earlier visit.
 * @param {string|null} options.pageRelease - The release the What's New page describes.
 * @returns {boolean}
 */
export function shouldAnnounce({ version, lastVersion, usedBefore, pageRelease }) {
  const release = releaseOf(version)
  if (!release || release !== pageRelease) return false
  const lastRelease = releaseOf(lastVersion)
  if (lastRelease) return isLaterRelease(release, lastRelease)
  return usedBefore
}
