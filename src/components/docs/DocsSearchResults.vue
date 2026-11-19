<template>
  <div class="docs-search-results">
    <h1 class="docs-search-results-title">
      <template v-if="query">Search results for ‘{{ query }}’</template>
      <template v-else>Search the user guide</template>
    </h1>

    <p v-if="!query" class="docs-search-results-status">Type in the search box above and press Enter.</p>
    <p v-else-if="loadError" class="docs-search-results-status">The search index could not be loaded.</p>
    <p v-else-if="!isReady" class="docs-search-results-status">Searching…</p>
    <template v-else>
      <p class="docs-search-results-status">
        {{ results.length }} result{{ results.length !== 1 ? 's' : '' }}<template v-if="pageCount > 1">
          across {{ pageCount }} pages</template
        >
      </p>

      <ol v-if="results.length" class="docs-search-results-list">
        <li v-for="result in results" :key="`${result.section.path}#${result.section.anchor}`" class="docs-search-result">
          <div class="docs-search-result-crumbs">
            <span v-if="pageGroup(result)">{{ pageGroup(result) }}</span>
            <i v-if="pageGroup(result) && result.section.anchor" class="pi pi-angle-right" aria-hidden="true" />
            <span v-if="result.section.anchor">{{ result.section.page }}</span>
          </div>
          <RouterLink :to="sectionLocation(result.section)" class="docs-search-result-link">
            <template v-for="(part, i) in result.headingSegments" :key="i">
              <mark v-if="part.match" class="docs-search-mark">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </RouterLink>
          <p v-if="result.snippet.length" class="docs-search-result-snippet">
            <template v-for="(part, i) in result.snippet" :key="i">
              <mark v-if="part.match" class="docs-search-mark">{{ part.text }}</mark>
              <template v-else>{{ part.text }}</template>
            </template>
          </p>
        </li>
      </ol>

      <div v-else class="docs-search-results-empty">
        <p>No sections hold every word of ‘{{ query }}’.</p>
        <p>Try fewer words, or the start of a word: <em>sim</em> finds <em>simulation</em> and <em>simulate</em>.</p>
      </div>
    </template>
  </div>
</template>

<script setup>
/**
 * The full results of a docs search: each matching section with where it sits in the guide, and a snippet of its text
 * around the match.
 */
import { computed, ref, watchEffect } from 'vue'

import { useDocsSearch } from '../../composables/useDocsSearch'
import { docsPage } from '../../utils/docsMenu'
import { sectionLocation } from '../../utils/docsSearch'

const props = defineProps({
  query: { type: String, default: '' },
})

const loadError = ref(null)
const { results, isReady, load } = useDocsSearch(() => props.query)

watchEffect(() => {
  if (props.query) {
    load().catch((error) => {
      loadError.value = error
    })
  }
})

const pageCount = computed(() => new Set(results.value.map((result) => result.section.path)).size)

/**
 * The sidebar group of the result's page, which its breadcrumb starts with.
 *
 * @param {Object} result
 * @returns {string}
 */
function pageGroup(result) {
  return docsPage(result.section.path)?.group ?? ''
}
</script>

<style>
.docs-search-results {
  max-width: 52rem;
}

.docs-page .markdown-body .docs-search-results-title {
  margin-top: 0;
}

.docs-search-results-status {
  color: var(--p-text-muted-color);
  font-size: 14px;
}

.docs-page .markdown-body .docs-search-results-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.docs-page .markdown-body .docs-search-result {
  margin: 0;
  padding: 14px 0;
  border-bottom: 1px solid var(--p-content-border-color);
}

.docs-search-result-crumbs {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}

.docs-search-result-crumbs .pi {
  font-size: 10px;
}

.docs-page .markdown-body a[href].docs-search-result-link {
  display: inline-block;
  margin: 2px 0 4px;
  font-size: 17px;
  font-weight: 600;
  text-decoration: none;
}

.docs-page .markdown-body a[href].docs-search-result-link:hover {
  text-decoration: underline;
}

.docs-page .markdown-body .docs-search-result-snippet {
  margin: 0;
  font-size: 14px;
  line-height: 1.5;
  color: var(--p-text-muted-color);
}

.docs-page .markdown-body .docs-search-mark {
  background: color-mix(in srgb, var(--p-primary-color) 22%, transparent);
  color: inherit;
  border-radius: 2px;
}

.docs-search-results-empty {
  color: var(--p-text-muted-color);
}
</style>
