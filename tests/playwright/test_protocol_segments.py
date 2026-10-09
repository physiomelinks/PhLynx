"""
Checks what experiment protocols need from libOpenCOR, run through the app's simulator as protocols will run: a
model kept in the worker, rerun one segment at a time with parameter changes, each segment starting from the
states the one before ended with. Dev server only, as the scripts import the app's source modules.
"""
import json
import math
import os
import unittest

from playwright.sync_api import sync_playwright

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
    from .test_simulator import APP_MOUNT_TIMEOUT, IS_DEV_SERVER, OPT_IN_TO_ISOLATION, SIMULATOR_STATUS, evaluate_within_a_minute
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
    from test_simulator import APP_MOUNT_TIMEOUT, IS_DEV_SERVER, OPT_IN_TO_ISOLATION, SIMULATOR_STATUS, evaluate_within_a_minute


# dx/dt = -k x, with x starting from an initialiser variable, as a PhLynx state does: in the same component
# ('local'), or in another component it is connected to ('connected'), as instance_parameters holds them.
DECAY_MODELS = {
    "local": """<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <component name="decay">
    <variable name="t" units="second"/>
    <variable name="x" units="dimensionless" initial_value="x_init"/>
    <variable name="x_init" units="dimensionless" initial_value="1"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply></apply>
    </math>
  </component>
</model>""",
    "connected": """<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <component name="decay">
    <variable name="t" units="second"/>
    <variable name="x" units="dimensionless" initial_value="x_init"/>
    <variable name="x_init" units="dimensionless" interface="public"/>
    <variable name="k" units="per_second" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply></apply>
    </math>
  </component>
  <component name="instance_parameters">
    <variable name="x_init" units="dimensionless" initial_value="1" interface="public"/>
    <variable name="k" units="per_second" initial_value="0.5" interface="public"/>
  </component>
  <connection component_1="decay" component_2="instance_parameters">
    <map_variables variable_1="x_init" variable_2="x_init"/>
    <map_variables variable_1="k" variable_2="k"/>
  </connection>
</model>""",
    # As PhLynx flattens it: time in environment, constants in instance_parameters.
    "flattened": """<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <component name="environment"><variable name="time" units="second" interface="public"/></component>
  <component name="decay">
    <variable name="t" units="second" interface="public"/>
    <variable name="x" units="dimensionless" initial_value="1"/>
    <variable name="k" units="per_second" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply></apply>
    </math>
  </component>
  <component name="instance_parameters"><variable name="k" units="per_second" initial_value="0.5" interface="public"/></component>
  <connection component_1="environment" component_2="decay"><map_variables variable_1="time" variable_2="t"/></connection>
  <connection component_1="decay" component_2="instance_parameters"><map_variables variable_1="k" variable_2="k"/></connection>
</model>""",
}

# Runs the decay model in __CELLML__ as segments, reporting what each check needs.
RUN_DECAY_SEGMENTS = """async () => {
  const loader = await import('/src/services/simulation/libopencorLoader.js')
  const simulator = await loader.whenLibOpenCORReady()
  const cellml = __CELLML__
  const key = 'protocol-probe-' + Math.round(performance.now())
  const accurate = { solver: 'CVODE', tolerance: 1e-10, maxSteps: 5000, timeStep: 0 }
  const window = (from, to) => ({ ...accurate, initialPoint: from, startingPoint: from, endingPoint: to, pointInterval: 0.1 })
  const run = (options) => simulator.startSimulation(options).promise
  const series = (results, name) => results.variables.get(name).values
  const named = (results, kind) => [...results.variables].filter(([, v]) => v.kind === kind).map(([name]) => name)
  const split = (name) => ({ component: name.slice(0, name.indexOf('/')), variable: name.slice(name.indexOf('/') + 1) })

  const whole = await run({ cellml, key, settings: window(0, 4) })
  const x = named(whole, 'state').find((name) => name.endsWith('/x'))
  const xInit = named(whole, 'constant').find((name) => name.endsWith('/x_init'))
  const k = named(whole, 'constant').find((name) => name.endsWith('/k'))

  const first = await run({ key, settings: window(0, 2) })
  const x2 = series(first, x).at(-1)
  const second = await run({ key, settings: window(2, 4), changes: [{ ...split(x), value: x2 }] })
  const restarted = await run({ key, settings: window(0, 2), changes: [{ ...split(x), value: x2 }] })
  const kStep = await run({ key, settings: window(2, 4), changes: [{ ...split(x), value: x2 }, { ...split(k), value: 1 }] })

  const stateSet = await run({ key, settings: window(0, 1), changes: [{ ...split(x), value: 0.3 }] })
  const initSet = await run({ key, settings: window(0, 1), changes: [{ ...split(xInit), value: 2 }] })
  const bothInitFirst = await run({ key, settings: window(0, 1), changes: [{ ...split(xInit), value: 2 }, { ...split(x), value: 0.3 }] })
  const bothStateFirst = await run({ key, settings: window(0, 1), changes: [{ ...split(x), value: 0.3 }, { ...split(xInit), value: 2 }] })
  // Without changes, the kept model is back to its own values.
  const plain = await run({ key, settings: window(0, 1) })

  return {
    names: { x, xInit, k },
    wholeEnd: series(whole, x).at(-1),
    x2,
    secondStart: [second.voi.values[0], series(second, x)[0]],
    secondEnd: [second.voi.values.at(-1), series(second, x).at(-1)],
    secondPoints: second.voi.values.length,
    restartedTime: [restarted.voi.values[0], restarted.voi.values.at(-1)],
    restartedEnd: series(restarted, x).at(-1),
    kStepEnd: series(kStep, x).at(-1),
    stateSetStart: series(stateSet, x)[0],
    initSetStart: series(initSet, x)[0],
    bothInitFirstStart: series(bothInitFirst, x)[0],
    bothStateFirstStart: series(bothStateFirst, x)[0],
    plainStart: series(plain, x)[0],
  }
}"""

# Chains __COUNT__ segments of 0.01 s each on the 'local' decay model, carrying x, and times them.
CHAIN_SEGMENTS = """async () => {
  const loader = await import('/src/services/simulation/libopencorLoader.js')
  const simulator = await loader.whenLibOpenCORReady()
  const key = 'protocol-chain-' + Math.round(performance.now())
  const count = __COUNT__
  // One point interval per segment, taken from the window itself: rounding can make (from + 0.01) - from fall
  // short of 0.01, which the simulator refuses as an interval longer than the window.
  const settings = (from) => {
    const to = from + 0.01
    return { solver: 'CVODE', tolerance: 1e-10, maxSteps: 5000, timeStep: 0, initialPoint: from, startingPoint: from, endingPoint: to, pointInterval: to - from }
  }
  const started = performance.now()
  let results = await simulator.startSimulation({ cellml: __CELLML__, key, settings: settings(0) }).promise
  const coldMs = performance.now() - started
  for (let i = 1; i < count; i++) {
    const value = results.variables.get('decay/x').values.at(-1)
    results = await simulator.startSimulation({ key, settings: settings(i * 0.01), changes: [{ component: 'decay', variable: 'x', value }] }).promise
  }
  return { coldMs, totalMs: performance.now() - started, tEnd: results.voi.values.at(-1), xEnd: results.variables.get('decay/x').values.at(-1) }
}"""

# dx/dt = u(t), u a linear interpolation of sin over __POINTS__ points on [0, 10], written as a piecewise: as a
# balanced tree of nested piecewises (__BALANCED__ true), or as one piecewise with a piece per interval.
PIECEWISE_INPUT = """async () => {
  const points = __POINTS__
  const ts = Array.from({ length: points }, (_, i) => (10 * i) / (points - 1))
  const vs = ts.map(Math.sin)
  const cn = (value) => `<cn cellml:units="dimensionless">${value}</cn>`
  const piece = (i) => `<apply><plus/>${cn(vs[i])}<apply><times/>${cn((vs[i + 1] - vs[i]) / (ts[i + 1] - ts[i]))}<apply><minus/><ci>t_</ci>${cn(ts[i])}</apply></apply></apply>`
  const tree = (lo, hi) => {
    if (hi - lo === 1) return piece(lo)
    const mid = (lo + hi) >> 1
    return `<piecewise><piece>${tree(lo, mid)}<apply><lt/><ci>t_</ci>${cn(ts[mid])}</apply></piece><otherwise>${tree(mid, hi)}</otherwise></piecewise>`
  }
  const flat = () => `<piecewise>${ts.slice(0, -1).map((_, i) => `<piece>${piece(i)}<apply><lt/><ci>t_</ci>${cn(ts[i + 1])}</apply></piece>`).join('')}<otherwise>${cn(vs.at(-1))}</otherwise></piecewise>`
  const cellml = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" xmlns:cellml="http://www.cellml.org/cellml/2.0#" name="input">
  <component name="input">
    <variable name="t" units="dimensionless"/>
    <variable name="t_" units="dimensionless"/>
    <variable name="u" units="dimensionless"/>
    <variable name="x" units="dimensionless" initial_value="0"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>t_</ci><ci>t</ci></apply>
      <apply><eq/><ci>u</ci>${__BALANCED__ ? tree(0, points - 1) : flat()}</apply>
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><ci>u</ci></apply>
    </math>
  </component>
</model>`
  const loader = await import('/src/services/simulation/libopencorLoader.js')
  const simulator = await loader.whenLibOpenCORReady()
  const settings = { solver: 'CVODE', tolerance: 1e-9, maxSteps: 50000, timeStep: 0, initialPoint: 0, startingPoint: 0, endingPoint: 10, pointInterval: 0.5 }
  try {
    const results = await simulator.startSimulation({ cellml, settings }).promise
    return { ok: true, bytes: cellml.length, xEnd: results.variables.get('input/x').values.at(-1) }
  } catch (error) {
    return { ok: false, bytes: cellml.length, message: error.message, issues: (error.issues ?? []).slice(0, 3).map((issue) => issue.description) }
  }
}"""

# Runs the loaded workspace over [0, 1] in one go and as [0, 0.5] then [0.5, 1], the second carrying every state
# over, and compares the two at 1.
CARRY_WORKSPACE_STATES = """async () => {
  const vueFlowUrl = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('@vue-flow_core.js'))
  const { useVueFlow } = await import(vueFlowUrl)
  const { nodes, edges } = useVueFlow('main-flow-editor')
  const { resolveScope, buildScopedModel } = await import('/src/services/simulation/scopedModel.js')
  const { whenLibOpenCORReady } = await import('/src/services/simulation/libopencorLoader.js')
  const { useLibraryStore } = await import('/src/stores/libraryStore.js')
  const scope = resolveScope(null, nodes.value, edges.value, [])
  const cellml = await buildScopedModel(scope, useLibraryStore()).text()
  const simulator = await whenLibOpenCORReady()
  const key = 'protocol-carry-' + Math.round(performance.now())
  const window = (from, to) => ({ solver: 'CVODE', tolerance: 1e-10, maxSteps: 50000, timeStep: 0, initialPoint: from, startingPoint: from, endingPoint: to, pointInterval: 0.01 })
  const whole = await simulator.startSimulation({ cellml, key, settings: window(0, 1) }).promise
  const first = await simulator.startSimulation({ key, settings: window(0, 0.5) }).promise
  const states = [...first.variables].filter(([, v]) => v.kind === 'state')
  const changes = states.map(([name, v]) => ({ component: name.slice(0, name.indexOf('/')), variable: name.slice(name.indexOf('/') + 1), value: v.values.at(-1) }))
  const second = await simulator.startSimulation({ key, settings: window(0.5, 1), changes }).promise
  let largestRelative = 0
  let worst = null
  for (const [name] of states) {
    const a = whole.variables.get(name).values.at(-1)
    const b = second.variables.get(name).values.at(-1)
    const relative = Math.abs(a - b) / Math.max(Math.abs(a), 1e-6)
    if (relative > largestRelative) [largestRelative, worst] = [relative, { name, whole: a, carried: b }]
  }
  // Each carried state starts the second segment at the value the first ended with.
  const notCarried = changes.filter(({ component, variable, value }) => second.variables.get(component + '/' + variable).values[0] !== value).length
  const initialisedFromVariables = (cellml.match(/initial_value="[A-Za-z_]/g) ?? []).length
  return { states: states.length, initialisedFromVariables, notCarried, largestRelative, worst }
}"""

# Runs a protocol on the 'connected' decay model through the app's worker: a warm-up of 1 s, then k = 0.5 for 2 s and
# k = 1 for 2 s, as CA would run the same protocol_info.
RUN_PROTOCOL = """async () => {
  const { whenLibOpenCORReady } = await import('/src/services/simulation/libopencorLoader.js')
  const { validateProtocolInfo } = await import('/src/services/protocol/protocolValidation.js')
  const { readProtocolInfo } = await import('/src/services/protocol/protocolModel.js')
  const { compileProtocolPlan } = await import('/src/services/protocol/libopencorEngine/protocolPlan.js')
  const simulator = await whenLibOpenCORReady()
  const key = 'protocol-run-' + Math.round(performance.now())
  const described = await simulator.describeModel({ cellml: __CELLML__, key })
  const { protocolInfo } = validateProtocolInfo({ pre_times: [1], sim_times: [[2, 2]], params_to_change: { 'decay/k': [[0.5, 1]] } })
  const plan = compileProtocolPlan({ view: readProtocolInfo(protocolInfo), pointInterval: 0.5 })
  const settings = { solver: 'CVODE', tolerance: 1e-10, maxSteps: 5000, timeStep: 0 }
  const results = await simulator.startProtocol({ key, settings, plan, targets: new Map([['decay/k', 'instance_parameters/k']]) }).promise
  const [experiment] = results.experiments
  return {
    described: [...described.variables].map(([name, { kind }]) => name + ':' + kind).sort(),
    time: [...experiment.voi.values],
    x: [...experiment.variables.get('decay/x').values],
    k: [...experiment.variables.get('instance_parameters/k').values],
    subs: experiment.subs,
  }
}"""

# A pulse of k = 100 lasting 0.01 s in 10 s of decay at k = 0: x must fall by exactly e^-1, however brief the pulse.
RUN_SHORT_PULSE = """async () => {
  const { whenLibOpenCORReady } = await import('/src/services/simulation/libopencorLoader.js')
  const { validateProtocolInfo } = await import('/src/services/protocol/protocolValidation.js')
  const { readProtocolInfo } = await import('/src/services/protocol/protocolModel.js')
  const { compileProtocolPlan } = await import('/src/services/protocol/libopencorEngine/protocolPlan.js')
  const simulator = await whenLibOpenCORReady()
  const key = 'protocol-pulse-' + Math.round(performance.now())
  await simulator.describeModel({ cellml: __CELLML__, key })
  const { protocolInfo } = validateProtocolInfo({
    pre_times: [0], sim_times: [[10]], params_to_change: { 'decay/k': [['kick']] },
    protocol_shapes: { kick: { baseline: 0, events: [{ level: 100, start: 6.37, length: 0.01 }] } },
  })
  const plan = compileProtocolPlan({ view: readProtocolInfo(protocolInfo), pointInterval: 0.01 })
  const settings = { solver: 'CVODE', tolerance: 1e-10, maxSteps: 5000, timeStep: 0 }
  const results = await simulator.startProtocol({ key, settings, plan, targets: new Map([['decay/k', 'instance_parameters/k']]) }).promise
  const x = results.experiments[0].variables.get('decay/x').values
  return { segments: plan.experiments[0].segments.length, before: x[637], after: x[638], end: x.at(-1) }
}"""

# A ramp of k from 0 to 1 over 2 s, written into the model as a driver: x = exp(-t^2 / 4).
RUN_RAMP = """async () => {
  const { whenLibOpenCORReady } = await import('/src/services/simulation/libopencorLoader.js')
  const { whenLibCellMLReady } = await import('/src/utils/cellml.js')
  const { validateProtocolInfo } = await import('/src/services/protocol/protocolValidation.js')
  const { readProtocolInfo } = await import('/src/services/protocol/protocolModel.js')
  const { compileProtocolPlan } = await import('/src/services/protocol/libopencorEngine/protocolPlan.js')
  const { planDrivers, findShortestFeature } = await import('/src/services/protocol/libopencorEngine/protocolDrivers.js')
  const { addProtocolDrivers } = await import('/src/services/simulation/protocolDriverModel.js')
  const { protocolInfo } = validateProtocolInfo({
    pre_times: [0], sim_times: [[2]], params_to_change: { 'decay/k': [['up']] },
    protocol_shapes: { up: { type: 'ramp', from: 0, to: 1 } },
  })
  const view = readProtocolInfo(protocolInfo)
  const drivers = planDrivers(view)
  const { cellml, errors } = addProtocolDrivers({ libcellml: await whenLibCellMLReady(), cellml: __CELLML__, drivers })
  const simulator = await whenLibOpenCORReady()
  const key = 'protocol-ramp-' + Math.round(performance.now())
  const described = await simulator.describeModel({ cellml, key })
  const driven = new Map([['decay/k', { selectorParameter: 'protocol_drivers/driver_1_selector', valueParameter: 'protocol_drivers/driver_1_value', selectors: drivers[0].selectors }]])
  const plan = compileProtocolPlan({ view, pointInterval: 0.1, drivers: driven })
  const targets = new Map([['protocol_drivers/driver_1_selector', 'protocol_drivers/driver_1_selector'], ['protocol_drivers/driver_1_value', 'protocol_drivers/driver_1_value']])
  const settings = { solver: 'CVODE', tolerance: 1e-10, maxSteps: 5000, timeStep: findShortestFeature(drivers) }
  const results = await simulator.startProtocol({ key, settings, plan, targets }).promise
  const [experiment] = results.experiments
  return {
    errors, planErrors: plan.errors,
    kKind: described.variables.get('instance_parameters/k')?.kind,
    time: [...experiment.voi.values],
    x: [...experiment.variables.get('decay/x').values],
  }
}"""


class TestProtocolSegments(unittest.TestCase):

    def open_page(self, browser, url=BASE_URL):
        context = browser.new_context()
        context.add_init_script(OPT_IN_TO_ISOLATION)
        page = context.new_page()
        page.goto(url, wait_until="commit")
        page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
        if not page.evaluate(IS_DEV_SERVER):
            context.close()
            self.skipTest("The app's source modules aren't served here; run against the dev server.")
        return context, page

    def test_segments_carry_states_and_take_changes(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)
            context, page = self.open_page(browser)

            # ---------- START -----------
            for name in ("local", "connected"):
                cellml = DECAY_MODELS[name]
                with self.subTest(model=name):
                    r = evaluate_within_a_minute(page, RUN_DECAY_SEGMENTS.replace("__CELLML__", json.dumps(cellml)))
                    print(f"\n[{name}] {json.dumps(r)}")
                    # A state's change wins over its initialiser variable, whichever order they come in.
                    self.assertAlmostEqual(r["stateSetStart"], 0.3, places=12)
                    self.assertAlmostEqual(r["bothInitFirstStart"], 0.3, places=12)
                    self.assertAlmostEqual(r["bothStateFirstStart"], 0.3, places=12)
                    # Changing the initialiser alone moves the state's initial value.
                    self.assertAlmostEqual(r["initSetStart"], 2, places=12)
                    self.assertAlmostEqual(r["plainStart"], 1, places=12)
                    # [0, 2] then [2, 4], carrying x, is [0, 4].
                    self.assertAlmostEqual(r["secondStart"][0], 2, places=12)
                    self.assertEqual(r["secondStart"][1], r["x2"])
                    self.assertAlmostEqual(r["secondEnd"][0], 4, places=12)
                    self.assertEqual(r["secondPoints"], 21)
                    self.assertAlmostEqual(r["secondEnd"][1], math.exp(-2), places=7)
                    self.assertAlmostEqual(r["secondEnd"][1], r["wholeEnd"], places=7)
                    # The clock can restart at 0 for each segment (as CA's does); this model doesn't use time.
                    self.assertEqual(r["restartedTime"], [0, 2])
                    self.assertAlmostEqual(r["restartedEnd"], r["wholeEnd"], places=7)
                    # A constant changed between segments: x carries on, decaying faster.
                    self.assertAlmostEqual(r["kStepEnd"], r["x2"] * math.exp(-2), places=7)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_a_protocol_runs_in_the_worker(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)
            context, page = self.open_page(browser)

            # ---------- START -----------
            r = evaluate_within_a_minute(page, RUN_PROTOCOL.replace("__CELLML__", json.dumps(DECAY_MODELS["connected"])))
            self.assertIn("decay/x:state", r["described"])
            self.assertIn("instance_parameters/k:constant", r["described"])
            self.assertEqual(r["time"], [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4])
            self.assertEqual(r["k"], [0.5] * 5 + [1] * 4)
            self.assertEqual([[sub["startIndex"], sub["endIndex"]] for sub in r["subs"]], [[0, 4], [4, 8]])
            # The warm-up decays x before the first point; the second sub-experiment decays it twice as fast.
            for t, x in zip(r["time"], r["x"]):
                expected = math.exp(-0.5 * (1 + t)) if t <= 2 else math.exp(-1.5 - (t - 2))
                self.assertAlmostEqual(x, expected, places=7)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_a_short_pulse_is_never_stepped_over(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)
            context, page = self.open_page(browser)

            # ---------- START -----------
            r = evaluate_within_a_minute(page, RUN_SHORT_PULSE.replace("__CELLML__", json.dumps(DECAY_MODELS["connected"])))
            self.assertEqual(r["segments"], 3)
            self.assertAlmostEqual(r["before"], 1, places=9)
            self.assertAlmostEqual(r["after"], math.exp(-1), places=7)
            self.assertAlmostEqual(r["end"], math.exp(-1), places=7)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_a_ramp_runs_as_a_driver_the_model_computes(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)
            context, page = self.open_page(browser)

            # ---------- START -----------
            r = evaluate_within_a_minute(page, RUN_RAMP.replace("__CELLML__", json.dumps(DECAY_MODELS["flattened"])))
            self.assertEqual([r["errors"], r["planErrors"]], [[], []])
            self.assertNotEqual(r["kKind"], "constant")
            self.assertEqual(len(r["time"]), 21)
            for t, x in zip(r["time"], r["x"]):
                self.assertAlmostEqual(x, math.exp(-t * t / 4), places=6)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_a_long_chain_of_segments(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)
            context, page = self.open_page(browser)

            # ---------- START -----------
            script = CHAIN_SEGMENTS.replace("__CELLML__", json.dumps(DECAY_MODELS["local"])).replace("__COUNT__", "200")
            r = evaluate_within_a_minute(page, script)
            print(f"\n[chain of 200] {json.dumps(r)}")
            self.assertAlmostEqual(r["tEnd"], 2, places=9)
            self.assertAlmostEqual(r["xEnd"], math.exp(-1), places=7)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_piecewise_inputs_of_time(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)
            context, page = self.open_page(browser)

            # ---------- START -----------
            # A flat piecewise of 2000 pieces overflows the stack while the model is read, so long traces need the tree.
            for points, balanced in ((10001, True), (200, False)):
                with self.subTest(points=points, balanced=balanced):
                    script = PIECEWISE_INPUT.replace("__POINTS__", str(points)).replace("__BALANCED__", "true" if balanced else "false")
                    r = evaluate_within_a_minute(page, script)
                    print(f"\n[piecewise {points} {'balanced' if balanced else 'flat'}] {json.dumps(r)}")
                    self.assertTrue(r["ok"], r)
                    self.assertAlmostEqual(r["xEnd"], 1 - math.cos(10), places=3 if not balanced else 4)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_a_workspace_carries_every_state(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            context, page = self.open_page(browser, BASE_URL + f"?open=workspace_json#{workspace_json}")

            # ---------- START -----------
            page.get_by_text("SN_varicositycell_modules.cellmlvar_SN").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(f"{SIMULATOR_STATUS} === 'ready'", timeout=APP_MOUNT_TIMEOUT)
            r = evaluate_within_a_minute(page, CARRY_WORKSPACE_STATES)
            print(f"\n[workspace carry] {json.dumps(r)}")
            self.assertGreater(r["states"], 0)
            self.assertGreater(r["initialisedFromVariables"], 0)
            self.assertEqual(r["notCarried"], 0)
            self.assertLess(r["largestRelative"], 1e-4, r["worst"])
            # ----------- END ------------

            context.close()
            browser.close()


if __name__ == '__main__':
    unittest.main()
