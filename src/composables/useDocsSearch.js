/**
 * The docs search index, loaded the first time something searches, and a search over it that follows a query.
 */
import { computed, shallowRef, toValue } from 'vue'

import { searchDocs } from '../utils/docsSearch'

const index = shallowRef(null)
let loading = null

/**
 * Starts loading the index, once. It is a chunk of its own, so the docs pages don't wait for it.
 *
 * @returns {Promise<Array<Object>>}
 */
export function loadDocsSearchIndex() {
  loading ??= import('virtual:docs-search-index')
    .then((module) => {
      index.value = module.default
      return module.default
    })
    .catch((error) => {
      loading = null
      throw error
    })
  return loading
}

/**
 * Searches the docs as a query changes.
 *
 * @param {import('vue').MaybeRefOrGetter<string>} query
 * @param {Object} [options] - Passed to searchDocs.
 * @returns {{results: import('vue').ComputedRef<Array<Object>>, isReady: import('vue').ComputedRef<boolean>, load: Function}}
 */
export function useDocsSearch(query, options = {}) {
  const results = computed(() => (index.value ? searchDocs(index.value, toValue(query), options) : []))
  const isReady = computed(() => index.value !== null)

  return { results, isReady, load: loadDocsSearchIndex }
}
