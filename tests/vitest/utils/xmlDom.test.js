// @vitest-environment happy-dom
import { DOMParser as XmldomParser, XMLSerializer as XmldomSerializer } from '@xmldom/xmldom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { appendChildren, childElements, elementsWithId, parseXml, removeNode, tryParseXml } from '../../../src/utils/xmlDom.js'

const HAPPY_DOM = { DOMParser: globalThis.DOMParser, XMLSerializer: globalThis.XMLSerializer }
const XMLDOM = { DOMParser: XmldomParser, XMLSerializer: XmldomSerializer }

const XML = '<r xmlns="urn:r"><a id="1"/>text<b><c id="2"/><a/></b><!-- note --><a id="3"/></r>'

describe.each([
  ['happy-dom', HAPPY_DOM],
  ['xmldom', XMLDOM],
])('xmlDom under %s', (_name, implementation) => {
  beforeEach(() => Object.assign(globalThis, implementation))
  afterEach(() => Object.assign(globalThis, HAPPY_DOM))

  const serialize = (node) => new globalThis.XMLSerializer().serializeToString(node)

  it('parses XML, and gives null and a message for XML that does not parse', () => {
    expect(parseXml(XML).documentElement.localName).toBe('r')
    for (const bad of ['<a><b>', '<a></b>', 'not xml', '<a>&nbsp;</a>']) {
      const { doc, error } = tryParseXml(bad)
      expect(doc).toBeNull()
      expect(error).toEqual(expect.any(String))
      expect(parseXml(bad)).toBeNull()
    }
  })

  it('lists child elements, optionally of one local name', () => {
    const root = parseXml(XML).documentElement
    expect(childElements(root).map((el) => el.localName)).toEqual(['a', 'b', 'a'])
    expect(childElements(root, 'a').map((el) => el.getAttribute('id'))).toEqual(['1', '3'])
    expect(childElements(root, 'missing')).toEqual([])
  })

  it('lists the descendants with an id, in document order', () => {
    const doc = parseXml(XML)
    expect(elementsWithId(doc).map((el) => el.getAttribute('id'))).toEqual(['1', '2', '3'])
    const [b] = childElements(doc.documentElement, 'b')
    expect(elementsWithId(b).map((el) => el.getAttribute('id'))).toEqual(['2'])
  })

  it('removes nodes and appends them in order', () => {
    const doc = parseXml(XML)
    const root = doc.documentElement
    const [first, b, last] = childElements(root)
    removeNode(first)
    removeNode(first)
    appendChildren(b, [last, doc.createElementNS('urn:r', 'd')])
    expect(serialize(root)).toBe('<r xmlns="urn:r">text<b><c id="2"/><a/><a id="3"/><d/></b><!-- note --></r>')
  })
})
