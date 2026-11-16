import satisfies from 'semver/functions/satisfies.js'
import valid from 'semver/functions/valid.js'

/** The name this app goes by in the shared notice feed. */
export const NOTICE_TARGET = 'phlynx'
/** The target of a notice meant for every application. */
export const ALL_TARGETS = 'all'
/** The feed layout this app reads; a feed of any other schema is left alone. */
export const NOTICE_SCHEMA = 1
/** The feed shared by the Physiome Links applications. */
export const NOTICES_URL = 'https://cdn.jsdelivr.net/gh/physiomelinks/LynxNotices@main/notices.json'
/** From least to most pressing; a notice of any other severity is shown as the first. */
export const NOTICE_SEVERITIES = ['info', 'warning', 'critical']

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/**
 * Whether `feed` is one this app can read: `{ schema: 1, notices: [...] }`.
 *
 * @param {*} feed - The parsed feed.
 * @returns {boolean}
 */
export function isUsableFeed(feed) {
  return isRecord(feed) && feed.schema === NOTICE_SCHEMA && Array.isArray(feed.notices)
}

/**
 * The id of every notice in the feed, whichever application or version it is for.
 *
 * @param {*} feed - The parsed feed.
 * @returns {Set<string>}
 */
export function feedNoticeIds(feed) {
  if (!isUsableFeed(feed)) return new Set()
  return new Set(feed.notices.filter(isRecord).map((entry) => entry.id).filter((id) => typeof id === 'string'))
}

const text = (value) => (typeof value === 'string' ? value.trim() : '')

/** The time `value` names, or null when it is not a date. */
function timestamp(value) {
  if (typeof value !== 'string') return null
  const time = Date.parse(value)
  return Number.isNaN(time) ? null : time
}

/** `value` as an https address, or null: the feed is fetched, so no other kind of link is followed. */
function httpsUrl(value) {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch (e) {
    return null
  }
}

/** Whether the entry is for this app at `version`: `versions` holds a semver range by target. */
function appliesToVersion(entry, version) {
  if (!isRecord(entry.versions) || !Object.hasOwn(entry.versions, NOTICE_TARGET)) return true
  const range = entry.versions[NOTICE_TARGET]
  if (typeof range !== 'string') return false
  // A build that cannot name its version sees the notice, rather than missing one meant for it.
  if (!valid(version)) return true
  return satisfies(version, range, { includePrerelease: true })
}

/**
 * The notices in `feed` to show in this app, newest first.
 *
 * Kept: entries with an id and a title, targeted at this app or at all, whose version range (if any) holds
 * `version`, already published and not yet expired. Anything else is skipped, so one bad entry hides only itself.
 *
 * @param {*} feed - The parsed feed.
 * @param {object} [options]
 * @param {string} [options.version] - This app's version.
 * @param {number} [options.now] - The current time, in milliseconds.
 * @returns {Array<{id: string, title: string, description: string, link: string|null, severity: string, published: number|null}>}
 */
export function noticesFor(feed, { version = '', now = Date.now() } = {}) {
  if (!isUsableFeed(feed)) return []

  const notices = []
  const seen = new Set()
  for (const entry of feed.notices) {
    if (!isRecord(entry)) continue
    const id = text(entry.id)
    const title = text(entry.title)
    if (!id || !title || seen.has(id)) continue
    if (!Array.isArray(entry.targets)) continue
    if (!entry.targets.includes(NOTICE_TARGET) && !entry.targets.includes(ALL_TARGETS)) continue
    if (!appliesToVersion(entry, version)) continue

    const published = timestamp(entry.published)
    const expires = timestamp(entry.expires)
    if (published !== null && published > now) continue
    if (expires !== null && expires <= now) continue

    seen.add(id)
    notices.push({
      id,
      title,
      description: text(entry.description),
      link: httpsUrl(entry.link),
      severity: NOTICE_SEVERITIES.includes(entry.severity) ? entry.severity : NOTICE_SEVERITIES[0],
      published,
    })
  }

  // Newest first; undated notices keep their feed order, after the dated ones.
  return notices.sort((a, b) => (b.published ?? -Infinity) - (a.published ?? -Infinity))
}
