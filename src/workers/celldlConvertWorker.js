/**
 * Converts CellDL diagrams off the main thread, as they are edited (useLiveCelldlConvert). libCellML's checks take
 * about 15 ms an element, which would hold up the page. bg2cellml's worker entry answers the messages; the worker
 * has its own libCellML and oxigraph, whose wasm Vite serves as assets, and is sent the BG-RDF framework as text.
 * Workers have no DOMParser, which the framework's MathML needs; bg2cellml's own fallback import of xmldom loses
 * its named exports in Vite's dev server, so the worker passes one.
 */
import createLibCellML from 'libcellml.js/libcellml.js'
import libcellmlWasm from 'libcellml.js/libcellml.wasm?url'
import initOxigraph, * as oxigraph from 'oxigraph/web.js'
import oxigraphWasm from 'oxigraph/web_bg.wasm?url'
import { startConversionWorker } from '@physiomelinks/bg2cellml/worker'
import { DOMParser } from '@xmldom/xmldom'

startConversionWorker({
  libcellml: () => createLibCellML({ locateFile: () => libcellmlWasm }),
  oxigraph,
  initOxigraph: () => initOxigraph({ module_or_path: oxigraphWasm }),
  domParser: new DOMParser(),
})
