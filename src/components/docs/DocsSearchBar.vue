<template>
  <div class="docs-search-container">
    <SearchField
      ref="fieldRef"
      v-model="query"
      label="Search the user guide"
      role="combobox"
      aria-autocomplete="list"
      :aria-expanded="showDropdown"
      aria-controls="docs-search-matches"
      :aria-activedescendant="activeIndex >= 0 ? `docs-search-match-${activeIndex}` : undefined"
      @input="activeIndex = -1"
      @keydown="onKeydown"
      @focus="onFocus"
      @blur="isFocused = false"
      @clear="clear"
    />
    <div v-if="showDropdown" class="search-suffix-content docs-search-dropdown">
      <div class="search-suffix-header">
        <span class="search-match-count">
          <template v-if="!isReady">Loading…</template>
          <template v-else>{{ results.length }} result{{ results.length !== 1 ? 's' : '' }}</template>
        </span>
      </div>
      <ul v-if="results.length" id="docs-search-matches" ref="listRef" class="search-match-list" role="listbox">
        <li
          v-for="(result, index) in shownResults"
          :id="`docs-search-match-${index}`"
          :key="`${result.section.path}#${result.section.anchor}`"
          class="search-match-item"
          :class="{ active: index === activeIndex }"
          role="option"
          :aria-selected="index === activeIndex"
          @mousedown.prevent="openResult(result)"
        >
          {{ result.section.heading }}
          <span class="search-match-vars">
            <template v-if="result.section.anchor">{{ result.section.page }} · </template>
            <template v-for="(part, i) in result.snippet" :key="i">
              <mark v-if="part.match" class="docs-search-mark">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </span>
        </li>
      </ul>
      <p v-else-if="isReady" class="search-empty docs-search-empty">No pages match '{{ query.trim() }}'</p>
      <button
        v-if="results.length"
        type="button"
        class="docs-search-all"
        @mousedown.prevent="openResultsPage"
      >
        See all results
        <kbd>Enter</kbd>
      </button>
    </div>
  </div>
</template>

<script setup>
/**
 * The docs search box. Typing lists the best few sections beneath it; the arrows pick one to open, and Enter opens
 * the picked one or, with none picked, the full results page.
 */
import { computed, nextTick, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import SearchField from '../SearchField.vue'
import { useDocsSearch } from '../../composables/useDocsSearch'
import { sectionLocation } from '../../utils/docsSearch'

const DROPDOWN_LIMIT = 8

const route = useRoute()
const router = useRouter()

const fieldRef = ref(null)
const listRef = ref(null)
const query = ref(typeof route.query.q === 'string' ? route.query.q : '')
const isFocused = ref(false)
// -1 until the arrows pick a result.
const activeIndex = ref(-1)

const { results, isReady, load } = useDocsSearch(query, { snippet: { before: 24, length: 160 } })
const shownResults = computed(() => results.value.slice(0, DROPDOWN_LIMIT))
const showDropdown = computed(() => isFocused.value && query.value.trim() !== '')

// The results page's query shows in the box.
watch(
  () => route.query.q,
  (q) => {
    if (route.name === 'docs' && typeof q === 'string') query.value = q
  }
)

watch(activeIndex, async () => {
  await nextTick()
  listRef.value?.querySelector('.search-match-item.active')?.scrollIntoView?.({ block: 'nearest' })
})

function onFocus() {
  isFocused.value = true
  load().catch((error) => console.error('Could not load the docs search index', error))
}

function clear() {
  query.value = ''
  activeIndex.value = -1
}

function openResult(result) {
  fieldRef.value?.blur()
  router.push(sectionLocation(result.section))
}

function openResultsPage() {
  const q = query.value.trim()
  if (!q) return
  fieldRef.value?.blur()
  router.push({ path: '/docs/search', query: { q } })
}

/**
 * The arrows step through the listed results, Enter opens the picked one or the results page, and Escape clears the
 * box, or leaves it once empty.
 *
 * @param {KeyboardEvent} event
 */
function onKeydown(event) {
  const count = shownResults.value.length
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    if (!count) return
    event.preventDefault()
    const step = event.key === 'ArrowDown' ? 1 : -1
    // From no pick, down picks the first and up the last.
    activeIndex.value = activeIndex.value < 0 ? (step > 0 ? 0 : count - 1) : (activeIndex.value + step + count) % count
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const picked = shownResults.value[activeIndex.value]
    if (picked) openResult(picked)
    else openResultsPage()
  } else if (event.key === 'Escape') {
    event.preventDefault()
    if (query.value) clear()
    else event.target.blur?.()
  }
}

/** Focuses the box, as the `/` shortcut does. */
function focus() {
  fieldRef.value?.focus()
}

defineExpose({ focus })
</script>

<style>
.docs-search-container {
  position: relative;
  width: 15.5rem;
  max-width: 100%;
}

.docs-search-dropdown {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 20;
  width: 26rem;
  max-width: calc(100vw - 32px);
}

.docs-search-dropdown .search-match-list {
  max-height: min(24rem, 60vh);
}

.docs-search-mark {
  background: color-mix(in srgb, var(--p-primary-color) 22%, transparent);
  color: inherit;
  border-radius: 2px;
}

.docs-search-empty {
  padding: 8px 12px;
  border-top: 1px solid var(--p-content-border-color);
}

.docs-search-all {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 14px;
  border: none;
  border-top: 1px solid var(--p-content-border-color);
  background: transparent;
  color: var(--p-primary-color);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  text-align: left;
}

.docs-search-all:hover {
  background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
}

.docs-search-all kbd {
  padding: 0 0.3rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 4px;
  color: var(--p-text-muted-color);
  font-family: inherit;
  font-size: 11px;
}
</style>
