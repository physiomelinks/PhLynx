const MEASUREMENT_ID = 'G-82PSN5PXQK'
const enabled =
  import.meta.env.PROD &&
  (typeof __IS_ELECTRON__ === 'undefined' || !__IS_ELECTRON__) &&
  window.location.hostname === 'phlynx.com'

function gtag() {
  window.dataLayer.push(arguments)
} // must be `arguments`; gtag.js ignores plain objects

export function initAnalytics() {
  if (!enabled) return
  window.dataLayer = window.dataLayer || []
  gtag('js', new Date())
  gtag('config', MEASUREMENT_ID, { send_page_view: false })
  const s = document.createElement('script')
  s.async = true
  s.src = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`
  document.head.appendChild(s)
}

export function useGtm() {
  const trackEvent = (name, params = {}) =>
    enabled ? gtag('event', name, params) : console.debug(`[analytics] ${name}`, params)
  const trackPageView = (to, pageTitle) =>
    enabled &&
    gtag('event', 'page_view', {
      page_title: pageTitle,
      page_location: window.location.href,
      page_category: to.path.startsWith('/docs')
        ? 'Documentation'
        : to.path.startsWith('/about')
        ? 'About'
        : 'Workflow Builder',
    })
  return { trackEvent, trackPageView }
}
