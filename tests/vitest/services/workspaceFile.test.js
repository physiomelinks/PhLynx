import { beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify }))

import { createPinia, setActivePinia } from 'pinia'

import { getBuiltInPieceTemplate } from '../../../src/services/bioView/pieces/builtInTemplates'
import { validatePieces, writtenPieces } from '../../../src/services/bioView/pieces/model'
import { buildWorkspaceFile, loadWorkspaceFile } from '../../../src/services/workspaceFile'
import { useBioPiecesStore } from '../../../src/stores/bioPiecesStore'
import { useDefaultParametersStore } from '../../../src/stores/defaultParametersStore'
import { useInspectionModuleStore } from '../../../src/stores/inspectionModuleStore'
import { useLibraryStore } from '../../../src/stores/libraryStore'
import { useOmexStore } from '../../../src/stores/omexStore'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore'
import { takeInputFile } from '../../../src/utils/misc'
import { PHLYNX_PROJECT_IDENTIFIER, PHLYNX_PROJECT_VERSION } from '../../../src/utils/constants'
import { loadAndSave } from '../helpers/workspaceSave.js'

const jsonFile = (text, name = 'workspace.json') => new File([text], name, { type: 'application/json' })

describe('takeInputFile', () => {
  it('returns the chosen file and clears the input so the same file fires change again', () => {
    const input = document.createElement('input')
    input.type = 'file'
    const file = jsonFile('{}')
    Object.defineProperty(input, 'files', { value: [file] })
    const clear = vi.spyOn(input, 'value', 'set')

    expect(takeInputFile({ target: input })).toBe(file)
    expect(clear).toHaveBeenCalledWith('')
  })

  it('returns undefined when nothing was chosen', () => {
    const target = { files: [], value: 'C:\\fakepath\\old.json' }
    expect(takeInputFile({ target })).toBeUndefined()
    expect(target.value).toBe('')
  })
})

describe('loadWorkspaceFile', () => {
  beforeEach(() => notify.error.mockClear())

  it('hands the parsed workspace to apply', async () => {
    const apply = vi.fn()
    expect(await loadWorkspaceFile(jsonFile('{"version":"1.2.0"}'), apply)).toBe(true)
    expect(apply).toHaveBeenCalledWith({ version: '1.2.0' })
    expect(notify.error).not.toHaveBeenCalled()
  })

  it('notifies when the file cannot be read', async () => {
    const readAsText = vi.spyOn(FileReader.prototype, 'readAsText').mockImplementation(function () {
      this.onerror(new ProgressEvent('error'))
    })
    const apply = vi.fn()
    try {
      expect(await loadWorkspaceFile(jsonFile('{}', 'broken.json'), apply)).toBe(false)
    } finally {
      readAsText.mockRestore()
    }
    expect(apply).not.toHaveBeenCalled()
    expect(notify.error).toHaveBeenCalledWith({ title: 'Failed to read workflow', message: 'Failed to read broken.json' })
  })

  it('notifies when the file is not JSON', async () => {
    const apply = vi.fn()
    expect(await loadWorkspaceFile(jsonFile('not json'), apply)).toBe(false)
    expect(apply).not.toHaveBeenCalled()
    expect(notify.error).toHaveBeenCalledWith(expect.objectContaining({ title: 'Failed to read workflow' }))
  })

  it('notifies when applying the workspace fails', async () => {
    const apply = vi.fn().mockRejectedValue(new Error('bad flow'))
    expect(await loadWorkspaceFile(jsonFile('{}'), apply)).toBe(false)
    expect(notify.error).toHaveBeenCalledWith({ title: 'Failed to load workflow', message: 'bad flow' })
  })
})

describe('buildWorkspaceFile annotations', () => {
  it('carries sidecars through load and save', () => {
    const doc = {
      id: PHLYNX_PROJECT_IDENTIFIER,
      version: PHLYNX_PROJECT_VERSION,
      flow: { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { name: 'pool' } }], edges: [] },
      store: { moduleAnnotations: [['pool.cellml:pool', '# sidecar']] },
    }

    const saved = loadAndSave(doc)

    expect(saved.store.moduleAnnotations).toEqual(doc.store.moduleAnnotations)
    expect(saved.flow.nodes[0].data).toEqual(doc.flow.nodes[0].data)
  })
})

describe('buildWorkspaceFile bioPieces', () => {
  const FLOW = { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { name: 'pump' } }], edges: [] }

  /** Builds the file from fresh stores, with or without the pieces store. */
  function build({ withPieces = true, fill } = {}) {
    setActivePinia(createPinia())
    const bioPieces = useBioPiecesStore()
    fill?.(bioPieces)
    return buildWorkspaceFile({
      flow: FLOW,
      library: useLibraryStore(),
      simulation: useSimulationSettingsStore(),
      inspectionModules: useInspectionModuleStore(),
      omex: useOmexStore(),
      parameters: useDefaultParametersStore(),
      ...(withPieces ? { bioPieces } : {}),
    })
  }

  it('saves a workspace without pieces byte for byte as before', () => {
    const file = build()
    expect(file).not.toHaveProperty('bioPieces')
    expect(JSON.stringify(file, null, 2)).toBe(JSON.stringify(build({ withPieces: false }), null, 2))
  })

  it('writes the pieces as they are written once a template is placed', () => {
    const epithelial = getBuiltInPieceTemplate('epithelial-cell')
    const file = build({ fill: (store) => store.addTemplate(epithelial, { x: 3, y: 4 }) })
    expect(file.version).toBe(PHLYNX_PROJECT_VERSION)
    expect(file.bioPieces.pieces.map((piece) => piece.id)).toEqual(epithelial.pieces.map((piece) => piece.id))
    // The template's corner, its fluids and all, is where it was placed, so its membrane is further in.
    const { frame } = file.bioPieces.pieces.find((piece) => piece.id === 'plasma-membrane')
    expect(frame.x).toBeGreaterThan(3)
    expect(frame.y).toBeGreaterThan(4)
    expect(validatePieces(file.bioPieces.pieces)).toMatchObject({ errors: [], warnings: [] })
  })

  it('carries the pieces through load and save', () => {
    const bioPieces = { pieces: writtenPieces(getBuiltInPieceTemplate('cardiomyocyte').pieces) }
    const doc = { id: PHLYNX_PROJECT_IDENTIFIER, version: PHLYNX_PROJECT_VERSION, flow: FLOW, store: {}, bioPieces }
    expect(loadAndSave(doc).bioPieces).toEqual(bioPieces)
  })

  it('drops what an older build saved as placed templates, which no longer load', () => {
    const doc = {
      id: PHLYNX_PROJECT_IDENTIFIER,
      version: PHLYNX_PROJECT_VERSION,
      flow: FLOW,
      store: {},
      bioTemplates: { templates: {}, instances: [] },
    }
    expect(loadAndSave(doc)).not.toHaveProperty('bioTemplates')
  })
})

describe('buildWorkspaceFile nodeTheme', () => {
  it('carries a theme this browser lacks through load and save', () => {
    const nodeTheme = {
      id: 'local:mine',
      theme: {
        schemaVersion: 1,
        id: 'local:mine',
        name: 'Mine',
        categories: [{ key: 'pump', label: 'Pump', color: '#ffeedd', dark: '#332211' }],
      },
    }
    const doc = {
      id: PHLYNX_PROJECT_IDENTIFIER,
      version: PHLYNX_PROJECT_VERSION,
      flow: { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { name: 'p', domainType: 'pump' } }], edges: [] },
      store: {},
      nodeTheme,
    }

    expect(loadAndSave(doc).nodeTheme).toEqual(nodeTheme)
  })
})
