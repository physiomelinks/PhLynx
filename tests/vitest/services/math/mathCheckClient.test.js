// @vitest-environment happy-dom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkModel } from '../../../../src/services/math/checkModel.js'
import { getLibCellML } from '../../../../src/utils/cellml.js'
import { mergeUnitDefinitions } from '../../../../src/utils/units.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

const DEFINITIONS = mergeUnitDefinitions([
  `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
    <units name="per_second"><unit units="second" exponent="-1"/></units>
  </model>`,
])

// dx/dt = k*x, with k in seconds: unbalanced, but only valid once per_second's definition is added.
const MATH = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="PhLynxComponent">
  <component name="decay">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" interface="public_and_private"/>
    <variable name="k" units="second" interface="public_and_private"/>
    <variable name="unused" units="per_second" interface="public_and_private"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><ci>k</ci><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`

/** Answers like workers/mathCheckWorker.js, with the tests' libCellML; or fails like a worker that can't start. */
class FakeWorker {
  static instances = []
  static fails = false
  constructor(url) {
    this.url = String(url)
    this.messages = []
    FakeWorker.instances.push(this)
  }
  postMessage(message) {
    this.messages.push(message)
    queueMicrotask(() => {
      if (FakeWorker.fails) this.onerror(new Event('error'))
      else this.onmessage({ data: { id: message.id, result: checkModel(getLibCellML(), message.xml) } })
    })
  }
  terminate() {}
}

describe('checkMathInBackground', () => {
  let checkMathInBackground

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(async () => {
    FakeWorker.instances = []
    FakeWorker.fails = false
    vi.stubGlobal('Worker', FakeWorker)
    vi.resetModules() // the client keeps its worker
    // A fresh client imports a fresh utils/cellml, which needs the libCellML the tests loaded for its fallback.
    const { initLibCellML } = await import('../../../../src/utils/cellml.js')
    initLibCellML(getLibCellML())
    ;({ checkMathInBackground } = await import('../../../../src/services/math/mathCheckClient.js'))
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('sends the worker the math with its library units, and resolves with its findings', async () => {
    const result = await checkMathInBackground(MATH, DEFINITIONS)

    expect(result.invalid).toEqual([])
    expect(result.imbalances).toHaveLength(1)
    const [worker] = FakeWorker.instances
    expect(worker.url).toMatch(/workers\/mathCheckWorker\.js/)
    expect(worker.messages[0].xml).toContain('<units name="per_second">')
  })

  it('starts one worker for every check', async () => {
    await Promise.all([checkMathInBackground(MATH, DEFINITIONS), checkMathInBackground(MATH, DEFINITIONS)])
    expect(FakeWorker.instances).toHaveLength(1)
    expect(FakeWorker.instances[0].messages.map(({ id }) => id)).toEqual([1, 2])
  })

  it('checks on the main thread when the worker fails', async () => {
    FakeWorker.fails = true
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const result = await checkMathInBackground(MATH, DEFINITIONS)
    expect(result.imbalances).toHaveLength(1)
  })
})
