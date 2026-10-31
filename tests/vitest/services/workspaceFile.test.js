import { beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify }))

import { createPinia, setActivePinia } from 'pinia'

import { getBuiltInTemplate } from '../../../src/services/bioView/builtInTemplates'
import { buildWorkspaceFile, loadWorkspaceFile } from '../../../src/services/workspaceFile'
import { useAnnotationStore } from '../../../src/stores/annotationStore'
import { useBioTemplateStore } from '../../../src/stores/bioTemplateStore'
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
  it('carries sidecars, instance sources, dismissed keys and node annotation fields through load and save', () => {
    const apiCoord = { subject: 'model#cell', coordIri: 'coord_cell', name: 'cell' }
    const doc = {
      id: PHLYNX_PROJECT_IDENTIFIER,
      version: PHLYNX_PROJECT_VERSION,
      flow: {
        nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { name: 'cell', apiCoord, annotationOverlay: {} } }],
        edges: [],
      },
      store: { moduleAnnotations: [['pool.cellml:pool', '# sidecar']] },
      annotations: {
        instanceSources: [{ location: 'a.ttl', format: 'turtle', text: '# a' }],
        dismissedSuggestions: ['k'],
      },
    }

    const saved = loadAndSave(doc)

    expect(saved.store.moduleAnnotations).toEqual(doc.store.moduleAnnotations)
    expect(saved.annotations).toEqual(doc.annotations)
    expect(saved.flow.nodes[0].data).toEqual(doc.flow.nodes[0].data)
  })
})

describe('buildWorkspaceFile bioTemplates', () => {
  const FLOW = { nodes: [{ id: 'n1', position: { x: 0, y: 0 }, data: { name: 'pump' } }], edges: [] }

  /** Builds the file from fresh stores, with or without the template store. */
  function build({ withTemplates = true, fill } = {}) {
    setActivePinia(createPinia())
    const bioTemplates = useBioTemplateStore()
    fill?.(bioTemplates)
    return buildWorkspaceFile({
      flow: FLOW,
      library: useLibraryStore(),
      simulation: useSimulationSettingsStore(),
      inspectionModules: useInspectionModuleStore(),
      omex: useOmexStore(),
      annotations: useAnnotationStore(),
      ...(withTemplates ? { bioTemplates } : {}),
    })
  }

  it('saves a workspace without templates byte for byte as before', () => {
    const file = build()
    expect(file).not.toHaveProperty('bioTemplates')
    expect(JSON.stringify(file, null, 2)).toBe(JSON.stringify(build({ withTemplates: false }), null, 2))
  })

  it('writes the placed templates and their definitions once there are instances', () => {
    const file = build({ fill: (store) => store.addInstance('enterocyte', { x: 3, y: 4 }, 'Villus') })

    expect(file.version).toBe(PHLYNX_PROJECT_VERSION)
    expect(file.bioTemplates.instances).toEqual([
      { id: expect.stringMatching(/^bt-/), template: 'enterocyte', at: { x: 3, y: 4 }, label: 'Villus' },
    ])
    const enterocyte = JSON.parse(JSON.stringify(getBuiltInTemplate('enterocyte')))
    expect(file.bioTemplates.templates).toEqual({ enterocyte })
  })

  it('carries the templates through load and save', () => {
    const bioTemplates = {
      templates: { enterocyte: JSON.parse(JSON.stringify(getBuiltInTemplate('enterocyte'))) },
      instances: [{ id: 'bt-a1', template: 'enterocyte', at: { x: 0, y: 0 } }],
    }
    const doc = { id: PHLYNX_PROJECT_IDENTIFIER, version: PHLYNX_PROJECT_VERSION, flow: FLOW, store: {}, bioTemplates }

    expect(loadAndSave(doc).bioTemplates).toEqual(bioTemplates)
  })
})
