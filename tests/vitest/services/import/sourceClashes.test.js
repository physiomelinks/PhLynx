import { describe, expect, it, vi } from 'vitest'

import { settleSourceClashes } from '../../../../src/services/import/sourceClashes.js'

const store = (clashes, sources = []) => ({ findClashes: vi.fn(() => clashes), loadedSources: () => new Set(sources) })

const CLASHES = [
  { kind: 'math', key: 'repo/math/membrane.cellml:membrane', existing: {}, incoming: {} },
  { kind: 'module', key: 'membrane:membrane:repo', existing: {}, incoming: {} },
  { kind: 'math', key: 'loose.cellml:x', existing: {}, incoming: {} },
]

describe('settleSourceClashes', () => {
  it('asks once per source, listing what differs, and never about loose files', async () => {
    const choose = vi.fn(async () => 'extra')
    const settlement = await settleSourceClashes({}, { store: store(CLASHES, ['repo']), choose })

    expect(choose).toHaveBeenCalledTimes(1)
    expect(choose.mock.calls[0][0]).toMatchObject({
      acceptLabel: 'Keep both',
      extraLabel: 'Replace',
      rejectLabel: 'Skip',
      issues: [
        { key: 'repo/math/membrane.cellml:membrane', message: 'math of membrane in repo/math/membrane.cellml' },
        { key: 'membrane:membrane:repo', message: 'configuration membrane:membrane' },
      ],
    })
    expect(settlement.isReplaced('repo/math/membrane.cellml')).toBe(true)
    expect(settlement.mapKey('repo/math/membrane.cellml')).toBe('repo/math/membrane.cellml')
  })

  it('keeps both by renaming the new files’ source to a free name', async () => {
    const choose = vi.fn(async () => 'accept')
    const settlement = await settleSourceClashes({}, { store: store(CLASHES, ['repo', 'repo (2)']), choose })

    expect(settlement.mapKey('repo/math/membrane.cellml')).toBe('repo (3)/math/membrane.cellml')
    expect(settlement.mapKey('membrane:membrane:repo')).toBe('membrane:membrane:repo (3)')
    expect(settlement.mapKey('other/x.cellml')).toBe('other/x.cellml')
    expect(settlement.isSkipped('repo/math/membrane.cellml')).toBe(false)
  })

  it('skips the source’s files', async () => {
    const settlement = await settleSourceClashes({}, { store: store(CLASHES, ['repo']), choose: async () => 'reject' })

    expect(settlement.isSkipped('repo/configurations/x.json')).toBe(true)
    expect(settlement.isSkipped('loose.cellml')).toBe(false)
  })

  it('asks nothing when nothing clashes', async () => {
    const choose = vi.fn()
    const settlement = await settleSourceClashes({}, { store: store([]), choose })
    expect(choose).not.toHaveBeenCalled()
    expect(settlement.mapKey('repo/a.cellml')).toBe('repo/a.cellml')
  })
})
