/**
 * The markdown-it setup the docs pages render with. The docs search index parses with the same setup, so its
 * heading ids and text match the rendered pages.
 */
import LinkAttributes from 'markdown-it-link-attributes'
import MarkdownItAttrs from 'markdown-it-attrs'
import MarkdownItGitHubAlerts from 'markdown-it-github-alerts'

export const markdownItOptions = {
  html: true,
  linkify: true,
  typographer: true,
}

/**
 * Adds the docs' markdown-it plugins.
 *
 * @param {import('markdown-it').default} md
 */
export function markdownItSetup(md) {
  // Enable the attribute syntax
  md.use(MarkdownItAttrs)
  md.use(LinkAttributes, {
    pattern: /^https?:\/\//,
    attrs: {
      target: '_blank',
      rel: 'noopener',
    },
  })
  md.use(MarkdownItGitHubAlerts)
}
