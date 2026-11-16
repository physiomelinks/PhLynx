import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'

import { DRAFT_ENTRY, packDraft, unpackDraft } from '../../../../src/services/recovery/draftFile.js'

const workspace = { id: 'phlynx', version: '1', flow: { nodes: [{ id: 'a', data: { label: 'Heart' } }], edges: [] } }

describe('draftFile', () => {
  it('reads back the workspace it packed', async () => {
    expect(await unpackDraft(await packDraft(workspace))).toEqual(workspace)
  })

  it('zips the workspace without indentation', async () => {
    const zip = await JSZip.loadAsync(await packDraft(workspace))
    expect(await zip.file(DRAFT_ENTRY).async('string')).toBe(JSON.stringify(workspace))
  })

  it('compresses the workspace', async () => {
    const nodes = Array.from({ length: 500 }, (_, i) => ({ id: `n${i}`, data: { label: 'Heart', ports: [] } }))
    const large = { ...workspace, flow: { nodes, edges: [] } }
    expect((await packDraft(large)).byteLength).toBeLessThan(JSON.stringify(large).length / 5)
  })

  it('refuses a zip with no workspace in it', async () => {
    const zip = new JSZip()
    zip.file('other.txt', 'x')
    await expect(unpackDraft(await zip.generateAsync({ type: 'uint8array' }))).rejects.toThrow(/no workspace/)
  })
})
