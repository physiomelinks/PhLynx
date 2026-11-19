import { computed, reactive, ref } from 'vue'

import { WHATS_NEW_PATH, parseWhatsNew, shouldAnnounce } from '../services/whatsNew'

/** The version seen on the last visit. */
export const LAST_VERSION_KEY = 'phlynx-last-version'
/**
 * Kept by the app on any first visit, so not a sign of an earlier one: the caches the notices and node themes fill,
 * and the last version itself.
 */
const FIRST_VISIT_KEYS = new Set([LAST_VERSION_KEY, 'phlynx-notices-cache', 'phlynx-node-themes-cache'])

const page = import.meta.glob('../../docs/getting-started/whats-new.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const whatsNew = parseWhatsNew(Object.values(page)[0])
const version = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : ''

function readLastVersion() {
  try {
    return window.localStorage.getItem(LAST_VERSION_KEY)
  } catch (e) {
    return null
  }
}

/** Whether this browser holds anything PhLynx keeps once used, read before the app writes anything of its own. */
function hasUsedBefore() {
  try {
    const storage = window.localStorage
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i)
      if (key?.startsWith('phlynx') && !FIRST_VISIT_KEYS.has(key)) return true
    }
  } catch (e) {
    // storage unavailable: nothing to go on
  }
  return false
}

function recordVersion() {
  try {
    window.localStorage.setItem(LAST_VERSION_KEY, version)
  } catch (e) {
    // ignore storage errors: the card may be offered again
  }
}

/** Opened from a link that loads a model: the card waits for the next visit, rather than greet the model. */
function openedFromLink() {
  try {
    return new URLSearchParams(window.location.search).has('open')
  } catch (e) {
    return false
  }
}

// Decided once, as the app starts.
const announce = ref(
  shouldAnnounce({
    version,
    lastVersion: readLastVersion(),
    usedBefore: hasUsedBefore(),
    pageRelease: whatsNew?.release ?? null,
  })
)
if (!announce.value) recordVersion()
const deferred = announce.value && openedFromLink()

/** What holds the card back for now, such as the offer of unsaved work to recover, by name. */
const holds = reactive(new Set())

/** Marks this release as seen, so the card is not shown again. */
function markSeen() {
  if (!announce.value) return
  announce.value = false
  recordVersion()
}

/**
 * Holds the card back while `active`, so it does not compete with another prompt.
 *
 * @param {string} reason - What is holding it, such as 'recovery'.
 * @param {boolean} active
 */
function holdWhatsNew(reason, active) {
  if (active) holds.add(reason)
  else holds.delete(reason)
}

const pending = computed(() => announce.value && !deferred && holds.size === 0)

/**
 * The once-per-release card announcing what is new: whether it is due, what it says, and the means to dismiss it.
 */
export function useWhatsNew() {
  return { pending, whatsNew, version, path: WHATS_NEW_PATH, markSeen, holdWhatsNew }
}
