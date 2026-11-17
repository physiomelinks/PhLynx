import { describe, expect, it, vi } from 'vitest'

import {
  AS_IS,
  chooseTargetNamespace,
  configNamespace,
  planNamespaceImport,
} from '../../../../src/services/import/namespaceImport.js'

/**
 * A library holding some namespaces, whose clashes are those listed, when the files clashing are among those coming in.
 *
 * @param {Object} options
 * @param {string[]} [options.namespaces]
 * @param {Array<{kind: string, key: string}>} [options.clashes] - By the keys they'd load under.
 * @param {Object<string, string[]>} [options.filesIn] - Namespaces holding each file name.
 */
function fakeStore({ namespaces = [], clashes = [], filesIn = {} } = {}) {
  return {
    loadedNamespaces: () => new Set(namespaces),
    namespacesWithFiles: (names) => new Set([...names].flatMap((name) => filesIn[name] ?? [])),
    findClashes: vi.fn(({ mathFiles = [], configFiles = [] }) => {
      const incoming = new Set([...mathFiles, ...configFiles].map(({ key }) => key))
      return clashes.filter(({ kind, key }) => kind === 'module' || incoming.has(kind === 'math' ? key.split(':')[0] : key))
    }),
  }
}

/** What findClashes would be given: the CellML files under their mapped keys. */
const incomingFor = (keys) => (mapKey) => ({
  mathFiles: keys.filter((key) => mapKey(key) !== null).map((key) => ({ key: mapKey(key), components: [] })),
})

describe('planNamespaceImport', () => {
  it('asks nothing for loose files, which load as they are', async () => {
    const prompt = vi.fn()
    const choose = vi.fn()
    const plan = await planNamespaceImport(['membrane.cellml'], { store: fakeStore(), prompt, choose, incomingFor: incomingFor([]) })
    expect(plan).toBe(AS_IS)
    expect(prompt).not.toHaveBeenCalled()
    expect(choose).not.toHaveBeenCalled()
  })

  it("names a folder's namespace as the user does, offering those in use, and asks nothing more when nothing clashes", async () => {
    const keys = ['CellML/membrane.cellml', 'CellML/heart.cellml', 'loose.cellml']
    const store = fakeStore({ namespaces: ['enterocyte-modules'] })
    const prompt = vi.fn(async () => 'cardiac_ap')
    const choose = vi.fn()
    const plan = await planNamespaceImport(keys, { store, prompt, choose, incomingFor: incomingFor(keys) })

    expect(prompt).toHaveBeenCalledOnce()
    expect(prompt.mock.calls[0][0]).toMatchObject({ value: 'CellML', suggestions: ['enterocyte-modules'] })
    expect(prompt.mock.calls[0][0].hint('enterocyte-modules')).toMatch(/in use/)
    expect(prompt.mock.calls[0][0].hint('new_one')).toBe('')
    expect(plan.mapKey('CellML/membrane.cellml')).toBe('cardiac_ap/membrane.cellml')
    expect(plan.mapKey('loose.cellml')).toBe('loose.cellml')
    expect(store.findClashes.mock.calls[0][0].mathFiles.map(({ key }) => key)).toEqual([
      'cardiac_ap/membrane.cellml',
      'cardiac_ap/heart.cellml',
      'loose.cellml',
    ])
    expect(keys.some(plan.isSkipped)).toBe(false)
    expect(choose).not.toHaveBeenCalled()
  })

  it("can take a folder's files into no namespace", async () => {
    const plan = await planNamespaceImport(['CellML/membrane.cellml'], {
      store: fakeStore(),
      prompt: async () => '  ',
      choose: vi.fn(),
      incomingFor: incomingFor(['CellML/membrane.cellml']),
    })
    expect(plan.mapKey('CellML/membrane.cellml')).toBe('membrane.cellml')
  })

  it('leaves out the files of a namespace whose naming is cancelled', async () => {
    const keys = ['CellML/membrane.cellml', 'other/heart.cellml']
    const plan = await planNamespaceImport(keys, {
      store: fakeStore(),
      prompt: async ({ value }) => (value === 'CellML' ? null : value),
      choose: vi.fn(),
      incomingFor: incomingFor(keys),
    })
    expect(plan.isSkipped('CellML/membrane.cellml')).toBe(true)
    expect(plan.mapKey('CellML/membrane.cellml')).toBe('CellML/membrane.cellml')
    expect(plan.isSkipped('other/heart.cellml')).toBe(false)
  })

  describe('in a namespace already in use', () => {
    const keys = ['CellML/membrane.cellml', 'CellML/heart.cellml']
    const clashes = [
      { kind: 'math', key: 'cardiac_ap/membrane.cellml:membrane' },
      { kind: 'module', key: 'heart:simple:cardiac_ap' },
      { kind: 'math', key: 'elsewhere/x.cellml:x' },
    ]
    const plan = (choice) => {
      const choose = vi.fn(async () => choice)
      return planNamespaceImport(keys, {
        store: fakeStore({ namespaces: ['cardiac_ap'], clashes }),
        prompt: async () => 'cardiac_ap',
        choose,
        incomingFor: incomingFor(keys),
      }).then((result) => ({ result, choose }))
    }

    it('lists what differs there, once, defaulting to leaving the loaded files', async () => {
      const { choose } = await plan('extra')
      expect(choose).toHaveBeenCalledOnce()
      const asked = choose.mock.calls[0][0]
      expect(asked).toMatchObject({ extraLabel: 'Leave', acceptLabel: 'Overwrite', rejectLabel: 'Cancel' })
      expect(asked.issues.map(({ message }) => message)).toEqual([
        'math of membrane in cardiac_ap/membrane.cellml',
        'configuration heart:simple',
      ])
    })

    it('leaves the clashing files out and imports the rest, when the user leaves the loaded ones', async () => {
      const { result } = await plan('extra')
      expect(result.isSkipped('CellML/membrane.cellml')).toBe(true)
      expect(result.isSkipped('CellML/heart.cellml')).toBe(false)
      expect(result.isReplaced('CellML/heart.cellml')).toBe(false)
    })

    it('replaces them all, when the user overwrites', async () => {
      const { result } = await plan('accept')
      expect(keys.some(result.isSkipped)).toBe(false)
      expect(keys.every(result.isReplaced)).toBe(true)
    })

    it("leaves out the namespace's files, when the user cancels", async () => {
      const { result } = await plan('reject')
      expect(keys.every(result.isSkipped)).toBe(true)
    })
  })
})

describe('target namespaces', () => {
  it('go to the only fitting namespace without asking, and ask among several', async () => {
    const prompt = vi.fn(async () => 'b')
    const store = fakeStore({ namespaces: ['a', 'b'] })
    expect(await chooseTargetNamespace(['a'], { store, prompt, what: 'x' })).toBe('a')
    expect(prompt).not.toHaveBeenCalled()

    expect(await chooseTargetNamespace(['a', 'b'], { store, prompt, what: 'x' })).toBe('b')
    expect(prompt.mock.calls[0][0].choices).toEqual([
      { label: 'a', value: 'a' },
      { label: 'b', value: 'b' },
    ])
  })

  it("give a loose config the library's only namespace, and the one holding its math among several", async () => {
    const prompt = vi.fn()
    const deps = { store: fakeStore({ namespaces: ['cardiac_ap'] }), prompt }
    expect(await configNamespace('membrane_config.json', [{ component_file: 'membrane.cellml' }], deps)).toBe('cardiac_ap')

    const several = { store: fakeStore({ namespaces: ['a', 'b'], filesIn: { 'membrane.cellml': ['b'] } }), prompt }
    expect(await configNamespace('membrane_config.json', [{ component_file: 'membrane.cellml' }], several)).toBe('b')
    expect(await configNamespace('x.json', [{ component_file: 'heart.cellml' }], several, AS_IS, ['a/heart.cellml'])).toBe('a')
    expect(prompt).not.toHaveBeenCalled()
  })

  it('keep a config of a folder in the namespace its folder went to', async () => {
    const plan = { ...AS_IS, mapKey: (key) => key.replace('CellML/', 'cardiac_ap/') }
    expect(await configNamespace('CellML/membrane_config.json', [], { store: fakeStore(), prompt: vi.fn() }, plan)).toBe('cardiac_ap')
  })
})
