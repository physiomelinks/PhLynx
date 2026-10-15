import { ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useCellmlDrop } from '../../../src/composables/useCellmlDrop.js'
import { importOmexFile } from '../../../src/services/import/omex'
import { parseCellMLConnections } from '../../../src/services/import/parseCellmlConnections'
import { prepareCellmlImport, prepareCellmlImports } from '../../../src/services/import/prepareCellml'
import { loadParametersFromCellML } from '../../../src/utils/cellml'
import { readFileAsText } from '../../../src/utils/misc'
import { notify } from '../../../src/utils/notify'

const nodes = ref([])
const edges = ref([])
const toIds = (ids) => (Array.isArray(ids) ? ids : [ids])
const addNodes = vi.fn((added) => nodes.value.push(...toIds(added)))
const addEdges = vi.fn((added) => edges.value.push(...toIds(added)))

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges,
    addNodes,
    addEdges,
    toObject: () => ({
      nodes: JSON.parse(JSON.stringify(nodes.value)),
      edges: JSON.parse(JSON.stringify(edges.value)),
    }),
  }),
}))

vi.mock('../../../src/utils/notify', () => ({
  notify: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
}))
vi.mock('../../../src/services/import/parseCellmlConnections', () => ({ parseCellMLConnections: vi.fn() }))
vi.mock('../../../src/services/import/omex', () => ({ importOmexFile: vi.fn() }))
vi.mock('../../../src/services/import/prepareCellml', () => ({
  prepareCellmlImport: vi.fn((content) => content),
  prepareCellmlImports: vi.fn((files) => files.map((file) => file.content)),
}))
vi.mock('../../../src/utils/cellml', () => ({ loadParametersFromCellML: vi.fn(() => ({ params: true })) }))
vi.mock('../../../src/utils/misc', () => ({ readFileAsText: vi.fn() }))

const createNode = (id, x = 0) => ({ id, position: { x, y: 5 }, data: { name: id } })

const makeEvent = ({ files, types } = {}) => ({
  preventDefault: vi.fn(),
  dataTransfer: { files, types, dropEffect: 'none' },
})

describe('useCellmlDrop', () => {
  let deps, drop

  beforeEach(() => {
    vi.clearAllMocks()
    nodes.value = []
    edges.value = []
    parseCellMLConnections.mockReturnValue({ edges: [{ id: 'conn' }] })
    deps = {
      // Mirrors the view: registers the file's modules and reports the result.
      loadCellMLData: vi.fn(async () => ({ ok: true, moduleCount: 1, unitsCount: 0 })),
      // Mirrors useLoadFromCellML: clears the workspace, then adds the new graph.
      loadFromCellML: vi.fn(async () => {
        nodes.value = [createNode('a', 10), createNode('new-only', 20)]
        edges.value = [{ id: 'fresh-edge', source: 'a', target: 'new-only' }]
        addNodes.mockClear()
        addEdges.mockClear()
      }),
      rebuildNodeEdgeIndex: vi.fn(),
      confirm: vi.fn(),
      libcellml: { status: 'ready' },
      processImportedOmexArchive: vi.fn(),
      onDragOverModule: vi.fn(),
      onDropModule: vi.fn(),
    }
    drop = useCellmlDrop(deps)
  })

  describe('loadCellMLFiles, single file with connections', () => {
    it('loads into an empty workspace without asking, then rebuilds the edge index', async () => {
      const results = await drop.loadCellMLFiles([{ name: 'm.cellml', content: '<model/>' }])

      expect(deps.confirm).not.toHaveBeenCalled()
      expect(parseCellMLConnections).toHaveBeenCalledWith('<model/>', 'm.cellml')
      expect(deps.loadCellMLData).toHaveBeenCalledWith('<model/>', 'm.cellml', { notify: false })
      expect(loadParametersFromCellML).toHaveBeenCalledWith('<model/>')
      expect(deps.loadFromCellML).toHaveBeenCalledWith({ edges: [{ id: 'conn' }] }, 'm.cellml', { params: true })
      expect(deps.rebuildNodeEdgeIndex).toHaveBeenCalledTimes(1)
      expect(results).toEqual([{ ok: true, moduleCount: 1, unitsCount: 0 }])
      expect(nodes.value.map((n) => n.id)).toEqual(['a', 'new-only'])
    })

    it('reads the prepared CellML in every step, preparing it once', async () => {
      prepareCellmlImport.mockReturnValueOnce('<hoisted/>')

      await drop.loadCellMLFiles([{ name: 'm.cellml', content: '<model/>' }])

      expect(prepareCellmlImport).toHaveBeenCalledTimes(1)
      expect(prepareCellmlImport).toHaveBeenCalledWith('<model/>', 'm.cellml')
      expect(parseCellMLConnections).toHaveBeenCalledWith('<hoisted/>', 'm.cellml')
      expect(deps.loadCellMLData).toHaveBeenCalledWith('<hoisted/>', 'm.cellml', { notify: false })
      expect(loadParametersFromCellML).toHaveBeenCalledWith('<hoisted/>')
    })

    it('waits for the graph to load before rebuilding the edge index', async () => {
      const order = []
      deps.loadFromCellML.mockImplementation(async () => {
        await Promise.resolve()
        order.push('loaded')
      })
      deps.rebuildNodeEdgeIndex.mockImplementation(() => order.push('rebuilt'))

      await drop.loadCellMLFiles([{ name: 'm.cellml', content: '<model/>' }])

      expect(order).toEqual(['loaded', 'rebuilt'])
    })

    it('waits for the graph to load before restoring the snapshot on combine', async () => {
      nodes.value = [createNode('old')]
      deps.confirm.mockResolvedValue(false)
      deps.loadFromCellML.mockImplementation(async () => {
        await Promise.resolve()
        nodes.value = [createNode('a')]
      })

      await drop.loadCellMLFiles([{ name: 'm.cellml', content: '<model/>' }])

      expect(nodes.value.map((n) => n.id)).toEqual(['a', 'old'])
    })

    it('reads a browser File through readFileAsText', async () => {
      readFileAsText.mockResolvedValue('<from-file/>')
      const file = new File(['ignored'], 'f.cellml')

      await drop.loadCellMLFiles([file])

      expect(readFileAsText).toHaveBeenCalledWith(file)
      expect(parseCellMLConnections).toHaveBeenCalledWith('<from-file/>', 'f.cellml')
    })

    it('replaces the workspace when Overwrite is chosen (nothing restored)', async () => {
      nodes.value = [createNode('a', 1), createNode('old', 2)]
      edges.value = [{ id: 'old-edge', source: 'a', target: 'old' }]
      deps.confirm.mockResolvedValue(true)

      await drop.loadCellMLFiles([{ name: 'm.cellml', content: '<model/>' }])

      expect(deps.confirm).toHaveBeenCalledWith(
        expect.objectContaining({ header: 'Workspace Not Empty', acceptLabel: 'Overwrite', rejectLabel: 'Add to Workspace' })
      )
      expect(deps.loadFromCellML).toHaveBeenCalledTimes(1)
      expect(addNodes).not.toHaveBeenCalled()
      expect(addEdges).not.toHaveBeenCalled()
      expect(nodes.value.map((n) => n.id)).toEqual(['a', 'new-only'])
      expect(deps.rebuildNodeEdgeIndex).toHaveBeenCalledTimes(1)
    })

    it('combines on Add to Workspace: remaps clashing ids, offsets by 1500 x and restores edges', async () => {
      nodes.value = [createNode('a', 100), createNode('old', 200)]
      edges.value = [{ id: 'old-edge', source: 'a', target: 'old' }]
      deps.confirm.mockResolvedValue(false)

      const results = await drop.loadCellMLFiles([{ name: 'm.cellml', content: '<model/>' }])

      // The new graph is loaded first (it clears the workspace), then the snapshot is added back.
      expect(deps.loadFromCellML).toHaveBeenCalledTimes(1)
      expect(deps.loadCellMLData).toHaveBeenCalledWith('<model/>', 'm.cellml', { notify: false })
      expect(nodes.value.map((n) => n.id)).toEqual(['a', 'new-only', 'a_1', 'old'])

      const restored = nodes.value.filter((n) => ['a_1', 'old'].includes(n.id))
      expect(restored.map((n) => n.position)).toEqual([
        { x: 1600, y: 5 },
        { x: 1700, y: 5 },
      ])
      expect(nodes.value.find((n) => n.id === 'a').position.x).toBe(10)

      const restoredEdge = addEdges.mock.calls[0][0][0]
      expect(restoredEdge.id).toMatch(/^old-edge_restored_[0-9a-f-]{36}$/)
      expect(restoredEdge.source).toBe('a_1')
      expect(restoredEdge.target).toBe('old')
      expect(edges.value.map((e) => e.id)).toContain('fresh-edge')

      // The combine path returns without rebuilding the node-edge index.
      expect(deps.rebuildNodeEdgeIndex).not.toHaveBeenCalled()
      expect(results).toEqual([{ ok: true, moduleCount: 1, unitsCount: 0 }])
    })

    it('gives distinct ids to repeated clashes', async () => {
      nodes.value = [createNode('a'), createNode('a_1')]
      deps.confirm.mockResolvedValue(false)
      deps.loadFromCellML.mockImplementation(async () => {
        nodes.value = [createNode('a'), createNode('a_1')]
      })

      await drop.loadCellMLFiles([{ name: 'm.cellml', content: '<model/>' }])

      expect(nodes.value.map((n) => n.id)).toEqual(['a', 'a_1', 'a_2', 'a_1_1'])
    })

    it('does not reuse an id it has just assigned to an earlier restored node', async () => {
      nodes.value = [createNode('a'), createNode('a_1')]
      deps.confirm.mockResolvedValue(false)
      deps.loadFromCellML.mockImplementation(async () => {
        nodes.value = [createNode('a')]
      })

      await drop.loadCellMLFiles([{ name: 'm.cellml', content: '<model/>' }])

      // 'a' clashes and becomes 'a_1', so the snapshot's own 'a_1' must move on to 'a_1_1'.
      expect(nodes.value.map((n) => n.id)).toEqual(['a', 'a_1', 'a_1_1'])
    })

    it('keeps the other node and edge fields when restoring the snapshot', async () => {
      nodes.value = [{ ...createNode('old'), type: 'module' }]
      edges.value = [{ id: 'e', source: 'old', target: 'old', sourceHandle: 'h1', targetHandle: 'h2' }]
      deps.confirm.mockResolvedValue(false)

      await drop.loadCellMLFiles([{ name: 'm.cellml', content: '<model/>' }])

      expect(nodes.value.find((n) => n.id === 'old')).toMatchObject({ type: 'module', data: { name: 'old' } })
      expect(addEdges.mock.calls[0][0][0]).toMatchObject({ sourceHandle: 'h1', targetHandle: 'h2' })
    })

    it('remaps the target endpoint of restored edges as well as the source', async () => {
      nodes.value = [createNode('a'), createNode('old')]
      edges.value = [{ id: 'e', source: 'old', target: 'a' }]
      deps.confirm.mockResolvedValue(false)

      await drop.loadCellMLFiles([{ name: 'm.cellml', content: '<model/>' }])

      expect(addEdges.mock.calls[0][0][0]).toMatchObject({ source: 'old', target: 'a_1' })
    })

    it('does not touch edge endpoints that are not in the snapshot', async () => {
      nodes.value = [createNode('a')]
      edges.value = [{ id: 'e', source: 'a', target: 'ghost' }]
      deps.confirm.mockResolvedValue(false)

      await drop.loadCellMLFiles([{ name: 'm.cellml', content: '<model/>' }])

      expect(addEdges.mock.calls[0][0][0]).toMatchObject({ source: 'a_1', target: 'ghost' })
    })
  })

  describe('loadCellMLFiles, no connections', () => {
    beforeEach(() => {
      parseCellMLConnections.mockReturnValue({ edges: [] })
    })

    it('registers modules with the default notifications and never asks or builds a graph', async () => {
      nodes.value = [createNode('a')]

      const results = await drop.loadCellMLFiles([{ name: 'lib.cellml', content: '<lib/>' }])

      expect(deps.confirm).not.toHaveBeenCalled()
      expect(deps.loadCellMLData).toHaveBeenCalledWith('<lib/>', 'lib.cellml')
      expect(deps.loadFromCellML).not.toHaveBeenCalled()
      expect(deps.rebuildNodeEdgeIndex).not.toHaveBeenCalled()
      expect(results).toEqual([{ ok: true, moduleCount: 1, unitsCount: 0 }])
    })

    it('returns a failed result when registration throws', async () => {
      deps.loadCellMLData.mockRejectedValue(new Error('boom'))

      const results = await drop.loadCellMLFiles([{ name: 'lib.cellml', content: '<lib/>' }])

      expect(results).toEqual([{ ok: false, moduleCount: 0, unitsCount: 0 }])
    })
  })

  describe('loadCellMLFiles, multiple files', () => {
    const entries = [
      { name: 'a.cellml', content: '<a/>' },
      { name: 'b.cellml', content: '<b/>' },
    ]

    it('registers each file silently without connection parsing and reports units in a success summary', async () => {
      deps.loadCellMLData.mockResolvedValue({ ok: true, moduleCount: 2, unitsCount: 3 })

      const results = await drop.loadCellMLFiles(entries)

      expect(parseCellMLConnections).not.toHaveBeenCalled()
      expect(deps.confirm).not.toHaveBeenCalled()
      expect(deps.loadCellMLData).toHaveBeenCalledWith('<a/>', 'a.cellml', { notify: false })
      expect(deps.loadCellMLData).toHaveBeenCalledWith('<b/>', 'b.cellml', { notify: false })
      expect(results).toHaveLength(2)
      expect(notify.success).toHaveBeenCalledWith({
        title: 'CellML Files Loaded',
        message: 'Loaded 4 modules and 6 units from 2 files.',
      })
    })

    it('prepares the files together, so the batch gets one notice of each kind, and registers the prepared CellML', async () => {
      prepareCellmlImports.mockReturnValueOnce(['<a hoisted="true"/>', '<b hoisted="true"/>'])

      await drop.loadCellMLFiles(entries)

      expect(prepareCellmlImports).toHaveBeenCalledTimes(1)
      expect(prepareCellmlImports).toHaveBeenCalledWith(entries)
      expect(prepareCellmlImport).not.toHaveBeenCalled()
      expect(deps.loadCellMLData).toHaveBeenCalledWith('<a hoisted="true"/>', 'a.cellml', { notify: false })
      expect(deps.loadCellMLData).toHaveBeenCalledWith('<b hoisted="true"/>', 'b.cellml', { notify: false })
    })

    it('fails only the file that cannot be read', async () => {
      readFileAsText.mockRejectedValueOnce(new Error('unreadable'))
      const file = new File(['<a/>'], 'a.cellml')

      const results = await drop.loadCellMLFiles([file, entries[1]])

      expect(deps.loadCellMLData).toHaveBeenCalledTimes(1)
      expect(deps.loadCellMLData).toHaveBeenCalledWith('<b/>', 'b.cellml', { notify: false })
      expect(results).toEqual([{ ok: false, moduleCount: 0, unitsCount: 0 }, { ok: true, moduleCount: 1, unitsCount: 0 }])
    })

    it('omits the module count when results carry no moduleCount (loadCellMLData returns componentCount)', async () => {
      deps.loadCellMLData.mockResolvedValue({ ok: true, componentCount: 2, unitsCount: 1 })

      await drop.loadCellMLFiles(entries)

      expect(notify.success).toHaveBeenCalledWith({
        title: 'CellML Files Loaded',
        message: 'Loaded 2 units from 2 files.',
      })
    })

    it('warns with a partial summary when some files fail', async () => {
      deps.loadCellMLData
        .mockResolvedValueOnce({ ok: true, moduleCount: 1, unitsCount: 0 })
        .mockResolvedValueOnce({ ok: false, moduleCount: 0, unitsCount: 0 })

      await drop.loadCellMLFiles(entries)

      expect(notify.warning).toHaveBeenCalledWith({
        title: 'Partial Import',
        message: 'Loaded 1 module from 1 file. 1 file failed.',
      })
      expect(notify.success).not.toHaveBeenCalled()
    })

    it('uses the singular for a single unit', async () => {
      deps.loadCellMLData
        .mockResolvedValueOnce({ ok: true, moduleCount: 0, unitsCount: 1 })
        .mockResolvedValueOnce({ ok: false, moduleCount: 0, unitsCount: 0 })

      await drop.loadCellMLFiles(entries)

      expect(notify.warning).toHaveBeenCalledWith({
        title: 'Partial Import',
        message: 'Loaded 1 unit from 1 file. 1 file failed.',
      })
    })

    it('errors when every file fails', async () => {
      deps.loadCellMLData.mockResolvedValue({ ok: false, moduleCount: 0, unitsCount: 0 })

      await drop.loadCellMLFiles(entries)

      expect(notify.error).toHaveBeenCalledWith({ title: 'Import Failed', message: 'Failed to load all 2 files.' })
    })

    it('counts a file that throws while reading as failed', async () => {
      readFileAsText.mockRejectedValue(new Error('read'))
      const file = new File(['x'], 'bad.cellml')

      const results = await drop.loadCellMLFiles([file, entries[0]])

      expect(results[0]).toEqual({ ok: false, moduleCount: 0, unitsCount: 0 })
      expect(notify.warning).toHaveBeenCalledWith(expect.objectContaining({ title: 'Partial Import' }))
    })
  })

  describe('onDragOver', () => {
    it('accepts OS file drags with a copy effect and does not delegate', () => {
      const event = makeEvent({ types: ['Files'] })

      drop.onDragOver(event)

      expect(event.preventDefault).toHaveBeenCalled()
      expect(event.dataTransfer.dropEffect).toBe('copy')
      expect(deps.onDragOverModule).not.toHaveBeenCalled()
    })

    it('delegates internal module drags without preventing default itself', () => {
      const event = makeEvent({ types: ['application/x-module'] })

      drop.onDragOver(event)

      expect(deps.onDragOverModule).toHaveBeenCalledWith(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(event.dataTransfer.dropEffect).toBe('none')
    })

    it('delegates when there is no dataTransfer', () => {
      const event = { preventDefault: vi.fn() }

      drop.onDragOver(event)

      expect(deps.onDragOverModule).toHaveBeenCalledWith(event)
    })
  })

  describe('onDrop', () => {
    const file = (name) => new File(['x'], name)

    it('delegates to the module drop handler when no files are dropped', async () => {
      const event = makeEvent({ files: [] })

      await drop.onDrop(event)

      expect(deps.onDropModule).toHaveBeenCalledWith(event)
      expect(event.preventDefault).not.toHaveBeenCalled()
    })

    it('warns about unsupported file types and loads nothing', async () => {
      const event = makeEvent({ files: [file('notes.txt')] })

      await drop.onDrop(event)

      expect(event.preventDefault).toHaveBeenCalled()
      expect(notify.warning).toHaveBeenCalledWith({
        title: 'Unsupported File Type',
        message: 'Only .cellml and .omex files can be dropped onto the workspace.',
      })
      expect(deps.loadCellMLData).not.toHaveBeenCalled()
      expect(deps.onDropModule).not.toHaveBeenCalled()
    })

    it('warns and loads nothing while libCellML is not ready', async () => {
      deps.libcellml.status = 'loading'

      await drop.onDrop(makeEvent({ files: [file('m.cellml')] }))

      expect(notify.warning).toHaveBeenCalledWith({
        title: 'CellML Library Not Ready',
        message: 'Please wait for the CellML library to finish loading and try again.',
      })
      expect(deps.loadCellMLData).not.toHaveBeenCalled()
      expect(importOmexFile).not.toHaveBeenCalled()
    })

    it('checks the file type before libCellML readiness', async () => {
      deps.libcellml.status = 'loading'

      await drop.onDrop(makeEvent({ files: [file('notes.txt')] }))

      expect(notify.warning).toHaveBeenCalledTimes(1)
      expect(notify.warning).toHaveBeenCalledWith(expect.objectContaining({ title: 'Unsupported File Type' }))
    })

    it('loads .cellml files case-insensitively and ignores other dropped files', async () => {
      readFileAsText.mockResolvedValue('<model/>')

      await drop.onDrop(makeEvent({ files: [file('M.CELLML'), file('readme.txt')] }))

      expect(deps.loadFromCellML).toHaveBeenCalledWith({ edges: [{ id: 'conn' }] }, 'M.CELLML', { params: true })
      expect(deps.loadCellMLData).toHaveBeenCalledTimes(1)
    })

    it('imports .omex files and notifies on success', async () => {
      const omex = file('archive.OMEX')
      omex.arrayBuffer = vi.fn(async () => 'buffer')
      importOmexFile.mockResolvedValue({ files: {} })

      await drop.onDrop(makeEvent({ files: [omex] }))

      expect(importOmexFile).toHaveBeenCalledWith('buffer')
      expect(deps.processImportedOmexArchive).toHaveBeenCalledWith('buffer', { files: {} }, 'archive.OMEX')
      expect(notify.success).toHaveBeenCalledWith({
        title: 'OMEX Import Complete',
        message: 'archive.OMEX imported successfully!',
      })
      expect(deps.loadCellMLData).not.toHaveBeenCalled()
    })

    it('reports a failing .omex and continues with the next one', async () => {
      const bad = file('bad.omex')
      bad.arrayBuffer = vi.fn(async () => 'bad-buffer')
      const good = file('good.omex')
      good.arrayBuffer = vi.fn(async () => 'good-buffer')
      importOmexFile.mockRejectedValueOnce(new Error('corrupt archive')).mockResolvedValueOnce({ files: {} })

      await drop.onDrop(makeEvent({ files: [bad, good] }))

      expect(notify.error).toHaveBeenCalledWith({ title: 'OMEX Import Failed', message: 'corrupt archive' })
      expect(deps.processImportedOmexArchive).toHaveBeenCalledTimes(1)
      expect(notify.success).toHaveBeenCalledWith({
        title: 'OMEX Import Complete',
        message: 'good.omex imported successfully!',
      })
    })

    it('loads .cellml files before importing .omex files', async () => {
      const order = []
      parseCellMLConnections.mockReturnValue({ edges: [] })
      deps.loadCellMLData.mockImplementation(async () => {
        order.push('cellml')
        return { ok: true, moduleCount: 1, unitsCount: 0 }
      })
      importOmexFile.mockImplementation(async () => {
        order.push('omex')
        return {}
      })
      readFileAsText.mockResolvedValue('<m/>')
      const omex = file('a.omex')
      omex.arrayBuffer = vi.fn(async () => 'b')

      await drop.onDrop(makeEvent({ files: [omex, file('a.cellml')] }))

      expect(order).toEqual(['cellml', 'omex'])
    })
  })
})
