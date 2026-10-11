import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { generateProtocolZip } from '../../../../src/services/export/protocolExport.js'

describe('generateProtocolZip', () => {
  /** Reads a zip. */
  const open = async (blob) => JSZip.loadAsync(await blob.arrayBuffer())
  /** Reads a manifest's contents as `{location: [format, master]}`. */
  const readManifest = async (zip) =>
    Object.fromEntries(
      [...(await zip.file('manifest.xml').async('string')).matchAll(/<content location="([^"]+)" format="([^"]+)"( master="true")?/g)].map(([, location, format, master]) => [
        location,
        [format, !!master],
      ])
    )

  it('bundles the SED-ML, the master, with the model it runs and their manifest', async () => {
    const zip = await open(await generateProtocolZip({ sedml: '<sedML/>', cellml: '<model clocked/>' }))
    expect(Object.keys(zip.files).sort()).toEqual(['manifest.xml', 'protocol.sedml', 'protocol_model.cellml'])
    expect(await zip.file('protocol.sedml').async('string')).toBe('<sedML/>')
    expect(await zip.file('protocol_model.cellml').async('string')).toBe('<model clocked/>')
    expect(await readManifest(zip)).toEqual({
      '.': ['http://identifiers.org/combine.specifications/omex', false],
      'protocol.sedml': ['http://identifiers.org/combine.specifications/sed-ml', true],
      'protocol_model.cellml': ['http://identifiers.org/combine.specifications/cellml', false],
    })
  })
})
