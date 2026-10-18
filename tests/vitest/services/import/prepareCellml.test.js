import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prepareCellmlImport, prepareCellmlImports } from '../../../../src/services/import/prepareCellml.js'
import { hoistEncapsulatedComponents } from '../../../../src/utils/cellml'
import { notify } from '../../../../src/utils/notify'

vi.mock('../../../../src/utils/notify', () => ({ notify: { info: vi.fn(), warning: vi.fn() } }))
vi.mock('../../../../src/utils/cellml', () => ({ hoistEncapsulatedComponents: vi.fn() }))

/**
 * A hoisting result for `content`.
 *
 * @param {string} content
 * @param {Object} [flags] - ignoredContainment and hoistFailed.
 * @returns {Object}
 */
const hoistResult = (content, flags = {}) => ({ cellml: `${content}+hoisted`, hoisted: [], ignoredContainment: false, hoistFailed: false, ...flags })

describe('prepareCellml', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    hoistEncapsulatedComponents.mockImplementation((content) => hoistResult(content))
  })

  it('returns the hoisted CellML of one file, without a notice when nothing was ignored or kept', () => {
    expect(prepareCellmlImport('<a/>', 'a.cellml')).toBe('<a/>+hoisted')
    expect(notify.info).not.toHaveBeenCalled()
    expect(notify.warning).not.toHaveBeenCalled()
  })

  it('names one file in the containment notice', () => {
    hoistEncapsulatedComponents.mockImplementation((content) => hoistResult(content, { ignoredContainment: true }))

    prepareCellmlImport('<a/>', 'a.cellml')

    expect(notify.info).toHaveBeenCalledTimes(1)
    expect(notify.info.mock.calls[0][0]).toMatchObject({ title: 'Containment Groups Ignored', items: [expect.stringMatching(/^a\.cellml groups /)] })
  })

  it('gives a batch one notice of each kind, naming the files it applies to', () => {
    hoistEncapsulatedComponents
      .mockImplementationOnce((content) => hoistResult(content, { ignoredContainment: true }))
      .mockImplementationOnce((content) => hoistResult(content, { ignoredContainment: true, hoistFailed: true }))
      .mockImplementationOnce((content) => hoistResult(content, { hoistFailed: true }))

    const files = ['a', 'b', 'c'].map((name) => ({ name: `${name}.cellml`, content: `<${name}/>` }))
    expect(prepareCellmlImports(files)).toEqual(['<a/>+hoisted', '<b/>+hoisted', '<c/>+hoisted'])

    expect(notify.info).toHaveBeenCalledTimes(1)
    expect(notify.info.mock.calls[0][0].items[0]).toMatch(/^a\.cellml, b\.cellml group /)
    expect(notify.warning).toHaveBeenCalledTimes(1)
    expect(notify.warning.mock.calls[0][0]).toMatchObject({ title: 'Encapsulation Kept', items: [expect.stringContaining('b.cellml, c.cellml')] })
  })
})
