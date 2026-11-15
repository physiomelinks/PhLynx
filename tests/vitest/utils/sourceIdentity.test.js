import { describe, expect, it } from 'vitest'

import { parseModuleRef, uniqueModuleRef } from '../../../src/utils/config.js'
import {
  baseNameOf,
  fileKeyFromPath,
  findModule,
  moduleRefOf,
  renameSourceIn,
  resolveComponentFile,
  sanitiseSourceName,
  sourceOfFileKey,
  sourceOfModuleRef,
  uniqueSourceName,
} from '../../../src/utils/sourceIdentity.js'

describe('file keys', () => {
  it('take their source from the first path segment, and none from a bare name', () => {
    expect(sourceOfFileKey('repo/math/membrane.cellml')).toBe('repo')
    expect(sourceOfFileKey('membrane.cellml')).toBeNull()
    expect(baseNameOf('repo/math/membrane.cellml')).toBe('membrane.cellml')
  })

  it('are normalised and colon-free', () => {
    expect(fileKeyFromPath('repo/./math/../math/a.cellml')).toBe('repo/math/a.cellml')
    expect(fileKeyFromPath('repo/odd:name.cellml')).toBe('repo/odd_name.cellml')
    expect(sanitiseSourceName('owner/repo:x')).toBe('owner_repo_x')
  })
})

describe('module refs', () => {
  it('carry a source as a third part that parseModuleRef reads back', () => {
    expect(moduleRefOf('membrane', 'membrane', 'repo')).toBe('membrane:membrane:repo')
    expect(moduleRefOf('membrane', 'membrane')).toBe('membrane:membrane')
    expect(parseModuleRef('membrane:membrane:repo')).toEqual({ moduleType: 'membrane', moduleSubtype: 'membrane', source: 'repo' })
    expect(sourceOfModuleRef('membrane:membrane')).toBeNull()
  })

  it('keep their source when made unique', () => {
    const taken = new Map([['decay:default:repo', { mathRef: 'repo/a.cellml:decay' }]])
    expect(uniqueModuleRef('decay:default:repo', 'repo/b.cellml:decay', (ref) => taken.get(ref))).toBe(
      'decay:default_2:repo'
    )
  })
})

describe('resolveComponentFile', () => {
  const config = 'repo/configurations/x_config.json'

  it('prefers the math folder beside configurations', () => {
    const candidates = ['repo/math/membrane.cellml', 'repo/old/membrane.cellml', 'other/math/membrane.cellml']
    expect(resolveComponentFile(config, 'membrane.cellml', candidates)).toBe('repo/math/membrane.cellml')
  })

  it('finds the file elsewhere in its own source, never in another', () => {
    expect(resolveComponentFile(config, 'membrane.cellml', ['repo/CellML/math/membrane.cellml', 'other/math/membrane.cellml'])).toBe(
      'repo/CellML/math/membrane.cellml'
    )
    expect(resolveComponentFile(config, 'membrane.cellml', ['other/math/membrane.cellml'])).toBe('repo/math/membrane.cellml')
  })

  it('reads a path as relative to the config, and leaves a config without a source alone', () => {
    expect(resolveComponentFile(config, '../models/m.cellml', [])).toBe('repo/models/m.cellml')
    expect(resolveComponentFile('x_config.json', 'membrane.cellml', ['repo/math/membrane.cellml'])).toBe('membrane.cellml')
  })
})

describe('findModule', () => {
  const modules = new Map([
    ['membrane:membrane:a', { moduleRef: 'membrane:membrane:a' }],
    ['membrane:membrane:b', { moduleRef: 'membrane:membrane:b' }],
    ['heart:simple:a', { moduleRef: 'heart:simple:a' }],
  ])

  it('picks the preferred source, else the only one, else reports the candidates', () => {
    expect(findModule(modules, 'membrane', 'membrane', 'b').module.moduleRef).toBe('membrane:membrane:b')
    expect(findModule(modules, 'heart', 'simple').module.moduleRef).toBe('heart:simple:a')
    expect(findModule(modules, 'membrane', 'membrane')).toEqual({ module: null, ambiguous: ['a', 'b'] })
    expect(findModule(modules, 'lung', 'simple')).toEqual({ module: null, ambiguous: [] })
  })
})

describe('sources', () => {
  it('rename in file keys and module refs only', () => {
    expect(renameSourceIn('repo/math/a.cellml', 'repo', 'repo (2)')).toBe('repo (2)/math/a.cellml')
    expect(renameSourceIn('a:b:repo', 'repo', 'repo (2)')).toBe('a:b:repo (2)')
    expect(renameSourceIn('repository/a.cellml', 'repo', 'x')).toBe('repository/a.cellml')
  })

  it('get a free name by numbering', () => {
    const taken = new Set(['CellML', 'CellML (2)'])
    expect(uniqueSourceName('CellML', (name) => taken.has(name))).toBe('CellML (3)')
    expect(uniqueSourceName('other', (name) => taken.has(name))).toBe('other')
  })
})
