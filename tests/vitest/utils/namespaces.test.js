import { describe, expect, it } from 'vitest'

import { parseModuleRef, uniqueModuleRef } from '../../../src/utils/config.js'
import {
  baseNameOf,
  describeFileKey,
  fileKeyFromPath,
  fileKeyOf,
  findModule,
  flatFileNames,
  instanceArrayNamespaces,
  moduleRefLabel,
  moduleRefOf,
  namespaceOfFileKey,
  namespaceOfModuleRef,
  namespaceOfPath,
  pickTargetNamespace,
  renameFileNamespace,
  renameModuleNamespace,
  resolveComponentFile,
  sanitiseNamespace,
} from '../../../src/utils/namespaces.js'

describe('file keys', () => {
  it('are a namespace and a file name, whatever folders the file sat in', () => {
    expect(fileKeyFromPath('bond_graph_cardiac_AP/CellML/math/membrane.cellml')).toBe('bond_graph_cardiac_AP/membrane.cellml')
    expect(fileKeyFromPath('repo/./math/../math/a.cellml')).toBe('repo/a.cellml')
    expect(fileKeyFromPath('membrane.cellml')).toBe('membrane.cellml')
    expect(fileKeyOf('cardiac_ap', 'CellML/math/membrane.cellml')).toBe('cardiac_ap/membrane.cellml')
    expect(fileKeyOf(null, 'odd:name.cellml')).toBe('odd_name.cellml')
  })

  it('take their namespace from the first folder, and none from a bare name', () => {
    expect(namespaceOfPath('CellML/math/membrane.cellml')).toBe('CellML')
    expect(namespaceOfPath('membrane.cellml')).toBeNull()
    expect(namespaceOfFileKey('cardiac_ap/membrane.cellml')).toBe('cardiac_ap')
    expect(namespaceOfFileKey('membrane.cellml')).toBeNull()
    expect(baseNameOf('cardiac_ap/membrane.cellml')).toBe('membrane.cellml')
    expect(sanitiseNamespace(' owner/repo:x ')).toBe('owner_repo_x')
  })
})

describe('module refs', () => {
  it('carry a namespace as a third part that parseModuleRef reads back', () => {
    expect(moduleRefOf('membrane', 'membrane', 'repo')).toBe('membrane:membrane:repo')
    expect(moduleRefOf('membrane', 'membrane')).toBe('membrane:membrane')
    expect(parseModuleRef('membrane:membrane:repo')).toEqual({ moduleType: 'membrane', moduleSubtype: 'membrane', namespace: 'repo' })
    expect(namespaceOfModuleRef('membrane:membrane')).toBeNull()
  })

  it('keep their namespace when made unique', () => {
    const taken = new Map([['decay:default:repo', { mathRef: 'repo/a.cellml:decay' }]])
    expect(uniqueModuleRef('decay:default:repo', 'repo/b.cellml:decay', (ref) => taken.get(ref))).toBe(
      'decay:default_2:repo'
    )
  })
})

describe('resolveComponentFile', () => {
  it("names the file of the config's namespace, dropping any folders", () => {
    expect(resolveComponentFile('cardiac_ap', 'membrane.cellml')).toBe('cardiac_ap/membrane.cellml')
    expect(resolveComponentFile('cardiac_ap', '../math/membrane.cellml')).toBe('cardiac_ap/membrane.cellml')
    expect(resolveComponentFile(null, 'membrane.cellml')).toBe('membrane.cellml')
  })
})

describe('findModule', () => {
  const modules = new Map([
    ['membrane:membrane:a', { moduleRef: 'membrane:membrane:a' }],
    ['membrane:membrane:b', { moduleRef: 'membrane:membrane:b' }],
    ['heart:simple:a', { moduleRef: 'heart:simple:a' }],
  ])

  it('picks the preferred namespace, else the only one, else reports the candidates', () => {
    expect(findModule(modules, 'membrane', 'membrane', 'b').module.moduleRef).toBe('membrane:membrane:b')
    expect(findModule(modules, 'heart', 'simple').module.moduleRef).toBe('heart:simple:a')
    expect(findModule(modules, 'membrane', 'membrane')).toEqual({ module: null, ambiguous: ['a', 'b'] })
    expect(findModule(modules, 'lung', 'simple')).toEqual({ module: null, ambiguous: [] })
  })

  it('gives the namespaces an instance array could target', () => {
    const rows = [{ module_type: 'membrane', module_subtype: 'membrane' }]
    expect([...instanceArrayNamespaces(rows, [...modules.keys(), 'membrane:membrane'])].sort()).toEqual(['', 'a', 'b'])
  })
})

describe('target namespaces', () => {
  it('go where what the files name is, else to the only namespace, else to none', () => {
    expect(pickTargetNamespace(['b'], ['a', 'b'])).toEqual({ namespace: 'b' })
    expect(pickTargetNamespace([''], ['a'])).toEqual({ namespace: '' })
    expect(pickTargetNamespace([], ['a'])).toEqual({ namespace: 'a' })
    expect(pickTargetNamespace([], [])).toEqual({ namespace: '' })
  })

  it('offer a choice only when several fit', () => {
    expect(pickTargetNamespace(['b', 'a'], ['a', 'b'])).toEqual({ choices: ['a', 'b'] })
    expect(pickTargetNamespace([], ['b', 'a'])).toEqual({ choices: ['', 'a', 'b'] })
  })
})

describe('renaming a namespace', () => {
  it('moves the file keys, mathRefs and module refs in it, and nothing else', () => {
    expect(renameFileNamespace('CellML/membrane.cellml', 'CellML', 'cardiac_ap')).toBe('cardiac_ap/membrane.cellml')
    expect(renameFileNamespace('CellML/membrane.cellml:membrane', 'CellML', 'cardiac_ap')).toBe('cardiac_ap/membrane.cellml:membrane')
    expect(renameFileNamespace('CellMLx/membrane.cellml', 'CellML', 'cardiac_ap')).toBe('CellMLx/membrane.cellml')
    expect(renameFileNamespace('membrane.cellml', 'CellML', 'cardiac_ap')).toBe('membrane.cellml')
    expect(renameModuleNamespace('membrane:membrane:CellML', 'CellML', 'cardiac_ap')).toBe('membrane:membrane:cardiac_ap')
    expect(renameModuleNamespace('membrane:membrane', 'CellML', 'cardiac_ap')).toBe('membrane:membrane')
  })

  it('can take files out of a namespace, or into one', () => {
    expect(renameFileNamespace('CellML/membrane.cellml', 'CellML', '')).toBe('membrane.cellml')
    expect(renameFileNamespace('membrane.cellml:membrane', null, 'cardiac_ap')).toBe('cardiac_ap/membrane.cellml:membrane')
  })
})

describe('display', () => {
  it('shows a file by name, with its namespace as a tag and its whole key on hover', () => {
    expect(describeFileKey('repo/membrane.cellml')).toEqual({ name: 'membrane.cellml', namespace: 'repo', title: 'repo/membrane.cellml' })
    expect(describeFileKey('membrane.cellml')).toEqual({ name: 'membrane.cellml', namespace: null, title: 'membrane.cellml' })
  })

  it('shows a module ref without its namespace part, adding it in brackets unless asked not to', () => {
    expect(moduleRefLabel('membrane:membrane:cardiac_ap')).toBe('membrane:membrane (cardiac_ap)')
    expect(moduleRefLabel('membrane:membrane:repo', { withNamespace: false })).toBe('membrane:membrane')
    expect(moduleRefLabel('membrane:membrane')).toBe('membrane:membrane')
  })
})

describe('flatFileNames', () => {
  it('names files by their names alone when none clash, as a single-namespace export always has', () => {
    const names = flatFileNames(['repo/membrane.cellml', 'repo/heart.cellml', 'loose.cellml'])
    expect(Object.fromEntries(names)).toEqual({
      'repo/membrane.cellml': 'membrane.cellml',
      'repo/heart.cellml': 'heart.cellml',
      'loose.cellml': 'loose.cellml',
    })
  })

  it('prefixes clashing files in a namespace, leaving a loose one its name, and numbers what still clashes', () => {
    const names = flatFileNames(['a/m.cellml', 'b (2)/m.cellml', 'm.cellml', 'a_m.cellml'], { reserved: ['model.cellml'] })
    expect(Object.fromEntries(names)).toEqual({
      'm.cellml': 'm.cellml',
      'a_m.cellml': 'a_m.cellml',
      'a/m.cellml': 'a_m_2.cellml',
      'b (2)/m.cellml': 'b_2_m.cellml',
    })
    expect(flatFileNames(['r/model.cellml'], { reserved: ['model.cellml'] }).get('r/model.cellml')).toBe('model_2.cellml')
  })
})
