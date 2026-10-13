import { describe, expect, it } from 'vitest'

import { useFileDrop } from '../../../src/composables/useFileDrop.js'

const { filesFromDataTransfer } = useFileDrop()

function fileEntry(name, { fail = false } = {}) {
  const file = { name }
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (resolve, reject) => (fail ? reject(new Error('unreadable')) : resolve(file)),
    _file: file,
  }
}

// Directory whose reader hands out one batch per readEntries call, then [].
function dirEntry(name, batches) {
  const queue = batches.map((b) => [...b])
  let reads = 0
  const entry = {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (resolve) => {
        reads++
        resolve(queue.shift() || [])
      },
    }),
  }
  entry.reads = () => reads
  return entry
}

function itemsOf(entries) {
  return entries.map((entry) => ({ webkitGetAsEntry: () => entry }))
}

describe('useFileDrop', () => {
  describe('filesFromDataTransfer with the entries API', () => {
    it('collects relevant files and skips irrelevant extensions', async () => {
      const csv = fileEntry('a.csv')
      const png = fileEntry('b.png')
      const result = await filesFromDataTransfer({ items: itemsOf([csv, png]) })
      expect(result).toEqual([{ file: csv._file, path: 'a.csv' }])
    })

    it('matches extensions case-insensitively', async () => {
      const entry = fileEntry('Model.CellML')
      const result = await filesFromDataTransfer({ items: itemsOf([entry]) })
      expect(result.map((r) => r.path)).toEqual(['Model.CellML'])
    })

    it('drops items whose webkitGetAsEntry returns null', async () => {
      const csv = fileEntry('a.csv')
      const items = [{ webkitGetAsEntry: () => null }, ...itemsOf([csv])]
      const result = await filesFromDataTransfer({ items })
      expect(result).toHaveLength(1)
    })

    it('uses the entries path when only a later item lacks webkitGetAsEntry', async () => {
      const csv = fileEntry('a.csv')
      const items = [...itemsOf([csv]), { getAsFile: () => ({ name: 'x.csv' }) }]
      const result = await filesFromDataTransfer({ items, files: [{ name: 'z.csv' }] })
      expect(result.map((r) => r.path)).toEqual(['a.csv'])
    })

    it('recurses into directories building slash-joined paths', async () => {
      const inner = fileEntry('inner.json')
      const sub = dirEntry('sub', [[inner]])
      const top = fileEntry('top.xml')
      const root = dirEntry('root', [[top, sub]])
      const result = await filesFromDataTransfer({ items: itemsOf([root]) })
      expect(result.map((r) => r.path)).toEqual(['root/top.xml', 'root/sub/inner.json'])
    })

    it('keeps reading a directory until readEntries returns an empty batch', async () => {
      const root = dirEntry('root', [[fileEntry('1.csv')], [fileEntry('2.csv')], [fileEntry('3.csv')]])
      const result = await filesFromDataTransfer({ items: itemsOf([root]) })
      expect(result.map((r) => r.path)).toEqual(['root/1.csv', 'root/2.csv', 'root/3.csv'])
      expect(root.reads()).toBe(4)
    })

    it('ignores entries nested deeper than the default maxDepth of 2', async () => {
      const d2 = dirEntry('d2', [[fileEntry('too-deep.csv')]])
      const d1 = dirEntry('d1', [[fileEntry('ok.csv'), d2]])
      const d0 = dirEntry('d0', [[d1]])
      const result = await filesFromDataTransfer({ items: itemsOf([d0]) })
      expect(result.map((r) => r.path)).toEqual(['d0/d1/ok.csv'])
    })

    it('honours a custom maxDepth', async () => {
      const build = () => dirEntry('root', [[fileEntry('a.csv'), dirEntry('sub', [[fileEntry('b.csv')]])]])
      const shallow = await filesFromDataTransfer({ items: itemsOf([build()]) }, { maxDepth: 0 })
      expect(shallow).toEqual([])
      const one = await filesFromDataTransfer({ items: itemsOf([build()]) }, { maxDepth: 1 })
      expect(one.map((r) => r.path)).toEqual(['root/a.csv'])
      const two = await filesFromDataTransfer({ items: itemsOf([build()]) }, { maxDepth: 2 })
      expect(two.map((r) => r.path)).toEqual(['root/a.csv', 'root/sub/b.csv'])
    })

    it('skips dot-entries and node_modules', async () => {
      const hiddenDir = dirEntry('.git', [[fileEntry('x.json')]])
      const nm = dirEntry('node_modules', [[fileEntry('y.json')]])
      const root = dirEntry('root', [[fileEntry('.hidden.csv'), hiddenDir, nm, fileEntry('keep.csv')]])
      const result = await filesFromDataTransfer({ items: itemsOf([root]) })
      expect(result.map((r) => r.path)).toEqual(['root/keep.csv'])
      expect(hiddenDir.reads()).toBe(0)
      expect(nm.reads()).toBe(0)
    })

    it('skips unreadable files without aborting the rest of the drop', async () => {
      const bad = fileEntry('bad.csv', { fail: true })
      const good = fileEntry('good.csv')
      const result = await filesFromDataTransfer({ items: itemsOf([bad, good]) })
      expect(result.map((r) => r.path)).toEqual(['good.csv'])
    })

    it('processes several dropped top-level entries in order', async () => {
      const result = await filesFromDataTransfer({
        items: itemsOf([fileEntry('a.csv'), dirEntry('d', [[fileEntry('b.csv')]]), fileEntry('c.json')]),
      })
      expect(result.map((r) => r.path)).toEqual(['a.csv', 'd/b.csv', 'c.json'])
    })
  })

  describe('filesFromDataTransfer fallback to dataTransfer.files', () => {
    it('uses files when items is empty', async () => {
      const csv = { name: 'a.csv' }
      const txt = { name: 'notes.txt' }
      const result = await filesFromDataTransfer({ items: [], files: [csv, txt] })
      expect(result).toEqual([{ file: csv, path: 'a.csv' }])
    })

    it('uses files when items is missing', async () => {
      const json = { name: 'x.JSON' }
      const result = await filesFromDataTransfer({ files: [json] })
      expect(result).toEqual([{ file: json, path: 'x.JSON' }])
    })

    it('uses files when the first item has no webkitGetAsEntry function', async () => {
      const f = { name: 'm.omex' }
      const result = await filesFromDataTransfer({ items: [{ getAsFile: () => f }], files: [f] })
      expect(result).toEqual([{ file: f, path: 'm.omex' }])
    })

    it('does not treat a non-function webkitGetAsEntry as support', async () => {
      const f = { name: 'm.xml' }
      const result = await filesFromDataTransfer({ items: [{ webkitGetAsEntry: 'nope' }], files: [f] })
      expect(result).toHaveLength(1)
    })

    it('returns an empty list when the fallback has no relevant files', async () => {
      expect(await filesFromDataTransfer({ items: [], files: [{ name: 'a.png' }, { name: 'noext' }] })).toEqual([])
    })

    it('returns an empty list when files is absent', async () => {
      expect(await filesFromDataTransfer({ items: [] })).toEqual([])
    })

    it('returns an empty list for a null or undefined dataTransfer', async () => {
      expect(await filesFromDataTransfer(null)).toEqual([])
      expect(await filesFromDataTransfer(undefined)).toEqual([])
    })
  })
})
