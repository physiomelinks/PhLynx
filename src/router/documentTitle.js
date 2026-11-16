import { useSessionMetadataStore } from '../stores/sessionMetadataStore'

const SITE_NAME = 'PhLynx'
const SEPARATOR = ' - '

/**
 * Formats a docs slug as a title, the page before its category: "my-category/setup-guide" gives
 * "Setup Guide - My Category".
 *
 * @param {string|string[]} slug - The docs route's slug.
 * @returns {string}
 */
export function formatDocsSlug(slug) {
  const parts = Array.isArray(slug) ? slug : [slug]

  return parts
    .map((part) => part.replace(/[-_]/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase()))
    .reverse()
    .join(SEPARATOR)
}

/**
 * The route's own title, without the project or site name.
 *
 * @param {import('vue-router').RouteLocationNormalized} route
 * @returns {string}
 */
export function routeTitle(route) {
  const { title } = route.meta

  return (typeof title === 'function' ? title(route) : title) || ''
}

/**
 * Sets the tab's title for a route, most specific part first: the project on the views that show it, then the page,
 * then the site.
 *
 * @param {import('vue-router').RouteLocationNormalized} route
 */
export function updateDocumentTitle(route) {
  const projectName = route.meta.showsProjectName ? useSessionMetadataStore().lastSaveName : ''

  document.title = [projectName, routeTitle(route), SITE_NAME].filter(Boolean).join(SEPARATOR)
}
