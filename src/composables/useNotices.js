import { computed, ref, shallowRef } from 'vue'

import { NOTICES_URL, feedNoticeIds, isUsableFeed, noticesFor } from '../services/notices'

const READ_KEY = 'phlynx-notices-read'
const CACHE_KEY = 'phlynx-notices-cache'
/** A feed is not fetched again within this long of the last attempt. */
const REFRESH_INTERVAL_MS = 60 * 60 * 1000
/** A feed longer than this is shown but not kept, so it cannot fill the storage the workspace shares. */
const MAX_CACHED_CHARS = 200_000

const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''

function readStored(key) {
  try {
    return JSON.parse(window.localStorage.getItem(key))
  } catch (e) {
    // localStorage unavailable (e.g. private browsing) or unreadable
    return null
  }
}

function store(key, value) {
  try {
    window.localStorage.setItem(key, value)
  } catch (e) {
    // ignore storage errors
  }
}

function loadCachedFeed() {
  const cached = readStored(CACHE_KEY)
  return isUsableFeed(cached) ? cached : null
}

function loadReadIds() {
  const stored = readStored(READ_KEY)
  return new Set(Array.isArray(stored) ? stored.filter((id) => typeof id === 'string') : [])
}

// The last feed fetched, shown until a newer one arrives - and all there is when offline.
const feed = shallowRef(loadCachedFeed())
const readIds = ref(loadReadIds())
/** Bumped on each fetch, so notices published or expired since the last one are picked up. */
const checkedAt = ref(Date.now())

const notices = computed(() => noticesFor(feed.value, { version: appVersion, now: checkedAt.value }))
const unreadIds = computed(() => notices.value.filter((notice) => !readIds.value.has(notice.id)).map((n) => n.id))
const unreadCount = computed(() => unreadIds.value.length)

function saveReadIds(ids) {
  readIds.value = ids
  store(READ_KEY, JSON.stringify([...ids]))
}

/** Marks every notice now shown as read. */
function markAllRead() {
  if (!unreadIds.value.length) return
  saveReadIds(new Set([...readIds.value, ...unreadIds.value]))
}

let lastAttempt = -Infinity
let inFlight = null

async function fetchFeed() {
  const response = await fetch(NOTICES_URL, { cache: 'no-cache' })
  if (!response.ok) return
  const body = await response.text()
  const fetched = JSON.parse(body)
  if (!isUsableFeed(fetched)) return

  feed.value = fetched
  if (body.length <= MAX_CACHED_CHARS) store(CACHE_KEY, body)

  // Forget the notices the feed no longer holds, so the read list does not grow for ever.
  const known = feedNoticeIds(fetched)
  const kept = new Set([...readIds.value].filter((id) => known.has(id)))
  if (kept.size !== readIds.value.size) saveReadIds(kept)
}

/**
 * Fetches the notice feed, unless it was fetched within the last hour. Never rejects: with no network, or a feed
 * that cannot be read, the notices stay as they were.
 *
 * @param {object} [options]
 * @param {boolean} [options.force] - Fetch however recent the last attempt.
 * @returns {Promise<void>}
 */
function refreshNotices({ force = false } = {}) {
  if (inFlight) return inFlight
  if (!force && Date.now() - lastAttempt < REFRESH_INTERVAL_MS) return Promise.resolve()

  lastAttempt = Date.now()
  inFlight = fetchFeed()
    .catch(() => {
      // offline, blocked or not JSON - keep what is shown
    })
    .finally(() => {
      checkedAt.value = Date.now()
      inFlight = null
    })
  return inFlight
}

/**
 * The notices posted for this app, shared across the app: what to show, how many are unread, and the means to
 * fetch them and mark them read.
 */
export function useNotices() {
  return { notices, unreadIds, unreadCount, markAllRead, refreshNotices }
}
