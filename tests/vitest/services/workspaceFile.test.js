import { beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.hoisted(() => ({ error: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify }))

import { loadWorkspaceFile } from '../../../src/services/workspaceFile'
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
