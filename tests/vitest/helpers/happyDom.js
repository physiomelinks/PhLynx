/**
 * happy-dom's selector engine never matches tag names containing an underscore
 * (`querySelectorAll('map_variables')` is always empty), unlike browsers. Route
 * plain underscore tag selectors to getElementsByTagName so the parser sees what
 * it would in a real browser.
 *
 * @returns {() => void} Restores the original selectors.
 */
export function patchUnderscoreTagSelectors() {
  const sample = new DOMParser().parseFromString('<a><b/></a>', 'application/xml')
  const protos = [Object.getPrototypeOf(sample), Object.getPrototypeOf(sample.documentElement)]
  const isUnderscoreTag = (sel) => /^[A-Za-z]\w*$/.test(sel) && sel.includes('_')
  const originals = protos.map((proto) => ({
    proto,
    all: proto.querySelectorAll,
    one: proto.querySelector,
  }))
  for (const { proto, all, one } of originals) {
    proto.querySelectorAll = function (sel) {
      return isUnderscoreTag(sel) ? Array.from(this.getElementsByTagName(sel)) : all.call(this, sel)
    }
    proto.querySelector = function (sel) {
      return isUnderscoreTag(sel) ? (this.getElementsByTagName(sel)[0] ?? null) : one.call(this, sel)
    }
  }
  return () => {
    for (const { proto, all, one } of originals) {
      proto.querySelectorAll = all
      proto.querySelector = one
    }
  }
}

/**
 * happy-dom dispatches `selectionchange` as soon as the selection changes, so CodeMirror, which sets the selection
 * while it updates, hears it mid-update and throws. Browsers queue the event, so it is queued here too.
 *
 * @param {Document} [doc=document]
 * @returns {() => void} Restores the original dispatch.
 */
export function deferSelectionChange(doc = document) {
  const dispatch = doc.dispatchEvent
  doc.dispatchEvent = function (event) {
    if (event.type !== 'selectionchange') return dispatch.call(this, event)
    setTimeout(() => dispatch.call(this, event))
    return true
  }
  return () => {
    doc.dispatchEvent = dispatch
  }
}
