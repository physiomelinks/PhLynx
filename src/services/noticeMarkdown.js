import MarkdownIt from 'markdown-it'

/**
 * Markdown for notice descriptions. The feed is fetched, so it is held to what is safe to show: raw HTML is shown as
 * text, images are not drawn (they would load from wherever the notice says), and only https links are followed -
 * any other link is shown as its text.
 */
const md = new MarkdownIt({ html: false, linkify: true, typographer: true, breaks: true })
md.disable('image')

md.validateLink = (url) => /^https:\/\//i.test(url.trim())

const renderToken = (tokens, idx, options, env, self) => self.renderToken(tokens, idx, options)
const defaultLinkOpen = md.renderer.rules.link_open || renderToken

md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx].attrSet('target', '_blank')
  tokens[idx].attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, idx, options, env, self)
}

/**
 * A notice's description as HTML.
 *
 * @param {string} text - The description, in Markdown.
 * @returns {string}
 */
export function renderNoticeMarkdown(text) {
  return text ? md.render(text) : ''
}
