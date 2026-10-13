import json
import math
import os
import unittest

from playwright.sync_api import sync_playwright

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH


# Automated browsers skip the isolation service worker unless they opt in (see index.html).
OPT_IN_TO_ISOLATION = "localStorage.setItem('phlynx.isolateUnderAutomation', 'true')"
SIMULATOR_STATE = "({ ...document.querySelector('#app').__vue_app__._context.provides.$libopencor })"
SIMULATOR_STATUS = "document.querySelector('#app')?.__vue_app__?._context?.provides?.$libopencor?.status"
# A cold dev server compiles the app on its first request, which can take a while on CI.
APP_MOUNT_TIMEOUT = 60000

# Whether the page comes from Vite's dev server, which serves the app's source modules.
# Fails an in-page script that hasn't finished in time, rather than letting the test hang.
WITHIN_A_MINUTE = (
    "(script) => Promise.race([script(), new Promise((resolve, reject) =>"
    " setTimeout(() => reject(new Error('The in-page script took over a minute.')), 60000))])"
)


def evaluate_within_a_minute(page, script):
    """Runs an async in-page script, failing it after a minute."""
    return page.evaluate(f"({WITHIN_A_MINUTE})({script})")


IS_DEV_SERVER = (
    "fetch('/@vite/client').then((response) => response.ok"
    " && /javascript/.test(response.headers.get('content-type') ?? ''), () => false)"
)

# A decay model, dx/dt = -k x, solved by the app's simulator, in its worker. It imports source modules, so it needs the
# dev server (as CI uses).
SOLVE_DECAY = """async () => {
  const loader = await import('/src/services/simulation/libopencorLoader.js')
  const cellml = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <component name="decay">
    <variable name="t" units="second"/>
    <variable name="x" units="dimensionless" initial_value="1"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply></apply>
    </math>
  </component>
</model>`
  const simulator = await loader.whenLibOpenCORReady()
  const settings = { initialPoint: 0, startingPoint: 0, endingPoint: 4, pointInterval: 0.1 }
  const result = await simulator.startSimulation({ cellml, settings }).promise
  return { points: result.voi.values.length, tEnd: result.voi.values.at(-1), xEnd: result.variables.get('decay/x').values.at(-1) }
}"""


# Runs the loaded workspace through the scoped build, the engine and the variable mapping, through the app's
# source modules (dev server only).
MAP_WORKSPACE_RESULTS = """async () => {
  const vueFlowUrl = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('@vue-flow_core.js'))
  const { useVueFlow } = await import(vueFlowUrl)
  const { nodes, edges } = useVueFlow('main-flow-editor')
  const { resolveScope, buildScopedModel } = await import('/src/services/simulation/scopedModel.js')
  const { buildVariableMapping, mappingKey } = await import('/src/services/simulation/variableMapping.js')
  const { whenLibOpenCORReady } = await import('/src/services/simulation/libopencorLoader.js')
  const { whenLibCellMLReady } = await import('/src/utils/cellml.js')
  const { useLibraryStore } = await import('/src/stores/libraryStore.js')
  const scope = resolveScope(null, nodes.value, edges.value, [])
  const cellml = await buildScopedModel(scope, useLibraryStore()).text()
  const settings = { initialPoint: 0, startingPoint: 0, endingPoint: 1, pointInterval: 0.1 }
  const results = await (await whenLibOpenCORReady()).startSimulation({ cellml, settings }).promise
  const mapping = buildVariableMapping({ libcellml: await whenLibCellMLReady(), cellml, nodes: scope.nodes, results })
  const soma = scope.nodes.find((node) => node.data.name === 'soma_SN')
  return {
    rows: scope.nodes.reduce((total, node) => total + node.data.variables.length, 0),
    mapped: mapping.size,
    underAnotherName: [...mapping].filter(([key, name]) => {
      const [nodeId, variableName] = key.split('::')
      return name !== scope.nodes.find((node) => node.id === nodeId).data.name + '/' + variableName
    }).length,
    somaCurrentOut: mapping.get(mappingKey(soma.id, 'I_out')),
    somaTime: mapping.get(mappingKey(soma.id, 't')),
  }
}"""

# Runs the loaded workspace twice with the settings in place of __SETTINGS__: in the app, and as web OpenCOR would,
# from the OMEX the export writes, with libOpenCOR reading the archive's own SED-ML. Dev server only.
COMPARE_WITH_EXPORT = """async () => {
  const vueFlowUrl = performance.getEntriesByType('resource').map((entry) => entry.name).find((name) => name.includes('@vue-flow_core.js'))
  const { useVueFlow } = await import(vueFlowUrl)
  const { nodes, edges } = useVueFlow('main-flow-editor')
  const { resolveScope, buildScopedModel } = await import('/src/services/simulation/scopedModel.js')
  const { generateOmexArchive } = await import('/src/services/compress.js')
  const { whenLibOpenCORReady } = await import('/src/services/simulation/libopencorLoader.js')
  const { useLibraryStore } = await import('/src/stores/libraryStore.js')
  const settings = __SETTINGS__
  const scope = resolveScope(null, nodes.value, edges.value, [])
  const blob = buildScopedModel(scope, useLibraryStore())
  const inApp = await (await whenLibOpenCORReady()).startSimulation({ cellml: await blob.text(), settings }).promise

  const omex = await generateOmexArchive({ blob }, '{}', { simulationSettings: settings, plotConfig: {}, parameterScanConfig: {} },
    { extractedData: { voi: null, mappedParameters: {} }, modified: false, cellmlFileName: 'model.cellml' })
  const base = '/libopencor/' + document.querySelector('#app').__vue_app__._context.provides.$libopencor.versionString + '/'
  const loc = await (await import(base + 'libopencor.js')).default({ locateFile: (file) => base + file })
  const file = new loc.File('export.omex')
  file.setContents(new Uint8Array(await omex.arrayBuffer()))
  const document_ = new loc.SedDocument(file)
  const instance = document_.instantiate()
  instance.run()
  const task = instance.task(0)
  let largestDifference = 0
  let compared = 0
  for (let i = 0; i < task.stateCount; i++) {
    const exported = task.state(i)
    const own = inApp.variables.get(task.stateName(i)).values
    for (let j = 0; j < exported.length; j++) largestDifference = Math.max(largestDifference, Math.abs(exported[j] - own[j]))
    compared++
  }
  const finalValues = Array.from({ length: task.stateCount }, (_, i) => task.state(i).at(-1))
  return { points: [task.voi.length, inApp.voi.values.length], states: compared, largestDifference, finalValues }
}"""


class TestSimulator(unittest.TestCase):

    def test_simulator_loads_in_the_background(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context()
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            page.goto(BASE_URL, wait_until="commit")

            # ---------- START -----------
            page.wait_for_function(
                f"['ready', 'error', 'unavailable'].includes({SIMULATOR_STATUS})",
                timeout=APP_MOUNT_TIMEOUT + 90000,
            )
            state = page.evaluate(SIMULATOR_STATE)
            self.assertEqual(state["status"], "ready", state["reason"])
            self.assertRegex(state["versionString"], r"^\d+\.\d+\.\d+$")
            self.assertTrue(page.evaluate("crossOriginIsolated"))
            # ----------- END ------------

            context.close()
            browser.close()

    def test_simulator_solves_a_model(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context()
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            page.goto(BASE_URL, wait_until="commit")

            # ---------- START -----------
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            if not page.evaluate(IS_DEV_SERVER):
                self.skipTest("The app's source modules aren't served here; run against the dev server.")
            result = evaluate_within_a_minute(page, SOLVE_DECAY)
            self.assertEqual(result["points"], 41)
            self.assertAlmostEqual(result["tEnd"], 4)
            self.assertAlmostEqual(result["xEnd"], math.exp(-2), places=5)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_results_map_back_to_every_instance_variable(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context()
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            if not page.evaluate(IS_DEV_SERVER):
                self.skipTest("The app's source modules aren't served here; run against the dev server.")
            page.get_by_text("SN_varicositycell_modules.cellmlvar_SN").wait_for(timeout=APP_MOUNT_TIMEOUT)
            result = evaluate_within_a_minute(page, MAP_WORKSPACE_RESULTS)
            self.assertEqual(result["mapped"], result["rows"])
            self.assertGreater(result["underAnotherName"], 0)
            self.assertEqual(result["somaCurrentOut"], "axon_SN/I")
            # The environment's variable is named after the first ODE's variable of integration.
            self.assertRegex(result["somaTime"], r"^environment/[^/]+$")
            # ----------- END ------------

            context.close()
            browser.close()

    def test_results_match_a_run_of_the_exported_omex(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context()
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            if not page.evaluate(IS_DEV_SERVER):
                self.skipTest("The app's source modules aren't served here; run against the dev server.")
            page.get_by_text("SN_varicositycell_modules.cellmlvar_SN").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(f"{SIMULATOR_STATUS} === 'ready'", timeout=APP_MOUNT_TIMEOUT)
            time_course = {"initialPoint": 0, "startingPoint": 0, "endingPoint": 1, "pointInterval": 0.01}
            final_values = []
            for solver in (
                {},
                {"solver": "CVODE", "tolerance": 1e-9, "maxSteps": 5000, "timeStep": 0.001},
                # This neuron model is stiff: explicit solvers need a step this small to stay finite.
                {"solver": "RungeKutta4", "timeStep": 1e-6, "endingPoint": 0.1},
            ):
                with self.subTest(**solver):
                    settings = json.dumps({**time_course, **solver})
                    result = evaluate_within_a_minute(page, COMPARE_WITH_EXPORT.replace("__SETTINGS__", settings))
                    self.assertEqual(result["points"][0], result["points"][1])
                    self.assertGreater(result["states"], 0)
                    self.assertEqual(result["largestDifference"], 0)
                    final_values.append(result["finalValues"])
            # Each solver setting reached both runs: they don't all give the same results.
            self.assertNotEqual(final_values[1], final_values[0])
            self.assertTrue(all(math.isfinite(value) for value in final_values[2]))
            # ----------- END ------------

            context.close()
            browser.close()

    def test_simulator_is_unavailable_without_isolation(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context()
            page = context.new_page()
            requests = []
            page.on("request", lambda request: "/libopencor/" in request.url and requests.append(request.url))
            page.goto(BASE_URL)

            # ---------- START -----------
            page.wait_for_function(f"{SIMULATOR_STATUS} === 'unavailable'", timeout=APP_MOUNT_TIMEOUT)
            self.assertEqual(requests, [])
            # ----------- END ------------

            context.close()
            browser.close()


if __name__ == '__main__':
    unittest.main()
