// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { forPostingProtocol } from '../../../src/workers/simulationWorker.js'

describe('forPostingProtocol', () => {
  it("hands over each experiment's buffers, its sub-experiments' own series too, and keeps a sub-experiment not run", () => {
    const own = [{ 'a/y': Float64Array.of(1, 2) }, null]
    const experiment = {
      voi: { name: 't', unit: 's', values: Float64Array.of(0, 1) },
      variables: new Map([['a/y', { kind: 'state', unit: 'm', values: Float64Array.of(1, 2) }]]),
      subs: [],
      subSeries: own,
    }
    const { results, buffers } = forPostingProtocol({ experiments: [experiment], issues: [], elapsedMs: 1, isStopped: false })
    const handed = [experiment.voi.values.buffer, experiment.variables.get('a/y').values.buffer, own[0]['a/y'].buffer]
    expect(buffers).toHaveLength(handed.length)
    handed.forEach((buffer, index) => expect(buffers[index]).toBe(buffer))
    expect(results.experiments[0].subSeries).toBe(own)
    expect(results.experiments[0].variables).toEqual([...experiment.variables])
  })
})
