import JSZip from 'jszip'

/**
 * Builds the COMBINE archive manifest.xml listing every file included in the
 * archive, plus the mandatory self-referencing "." entry for the archive
 * format itself. See the example archive (enterocyte.omex) for the shape
 * this mirrors.
 */
export function buildManifestXml(entries) {
  const contentLines = entries
    .map(
      (entry) =>
        `  <content location="${escapeAttribute(entry.location)}" format="${escapeAttribute(entry.format)}"${entry.master ? ' master="true"' : ''}/>`
    )
    .join('\n')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<omexManifest xmlns="http://identifiers.org/combine.specifications/omex-manifest">
  <content location="." format="http://identifiers.org/combine.specifications/omex"/>
${contentLines}
</omexManifest>
`
}

const ATTRIBUTE_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }

/** Escapes text for a double-quoted XML attribute. */
function escapeAttribute(value) {
  return String(value).replace(/[&<>"]/g, (c) => ATTRIBUTE_ESCAPES[c])
}
