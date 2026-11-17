// Settings for coi-serviceworker.js, loaded just before it. A file rather than an inline script, so the
// Electron build's Content-Security-Policy (script-src 'self') lets it run.
function isolatesUnderAutomation() {
  try {
    return localStorage.getItem('phlynx.isolateUnderAutomation') === 'true'
  } catch {
    return false
  }
}
window.coi = {
  // Electron serves the app from file://, where the service worker can't fetch the page. Automated browsers
  // (Playwright) skip it unless a test opts in, since page.route can't see requests that go through a
  // service worker.
  shouldRegister: () =>
    !navigator.userAgent.includes('Electron') && (!navigator.webdriver || isolatesUnderAutomation()),
  coepCredentialless: () => !!(window.chrome || window.netscape),
}
