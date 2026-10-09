"""
Checks that PhLynx runs a protocol as circulatory autogen (and so CUFLynx) does: each case in
tests/resources/protocols/parity/cases.json runs through the app's own services on libOpenCOR, and its experiments are
compared with CA's runs of the same model and protocol on Myokit (ca-references.json, written by
scripts/protocol-parity/generate_ca_references.py). Dev server only, as the scripts import the app's source modules.
"""
import json
import os
import unittest

from playwright.sync_api import sync_playwright

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
    from .test_simulator import APP_MOUNT_TIMEOUT, IS_DEV_SERVER, OPT_IN_TO_ISOLATION, evaluate_within_a_minute
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
    from test_simulator import APP_MOUNT_TIMEOUT, IS_DEV_SERVER, OPT_IN_TO_ISOLATION, evaluate_within_a_minute

PARITY = os.path.join(RESOURCE_PATH, "protocols", "parity")

# Runs __CASE__ on the model __CELLML__ as the Simulation tab runs a protocol, with the tolerance __TOLERANCE__.
RUN_CASE = """async () => {
  const spec = __CASE__
  const { whenLibOpenCORReady } = await import('/src/services/simulation/libopencorLoader.js')
  const { whenLibCellMLReady } = await import('/src/utils/cellml.js')
  const { validateProtocolInfo } = await import('/src/services/protocol/protocolValidation.js')
  const { readProtocolInfo } = await import('/src/services/protocol/protocolModel.js')
  const { planDrivers } = await import('/src/services/protocol/libopencorEngine/protocolDrivers.js')
  const { addProtocolDrivers } = await import('/src/services/simulation/protocolDriverModel.js')
  const { prepareProtocolRun } = await import('/src/services/simulation/protocolRun.js')
  const checked = validateProtocolInfo(spec.protocol_info)
  if (checked.errors.length) return { errors: checked.errors }
  const view = readProtocolInfo(checked.protocolInfo)
  const drivers = planDrivers(view)
  let cellml = __CELLML__
  if (drivers.length) {
    const added = addProtocolDrivers({ libcellml: await whenLibCellMLReady(), cellml, drivers })
    if (added.errors.length) return { errors: added.errors }
    cellml = added.cellml
  }
  const simulator = await whenLibOpenCORReady()
  const key = 'parity-' + Math.round(performance.now())
  const described = await simulator.describeModel({ cellml, key })
  const settings = { solver: 'CVODE', tolerance: __TOLERANCE__, maxSteps: 50000, timeStep: spec.maximumStep, pointInterval: spec.pointInterval }
  const prepared = prepareProtocolRun({ view, drivers, nodes: [], mapping: new Map(), variables: described.variables, settings })
  if (prepared.errors.length) return { errors: prepared.errors }
  const results = await simulator.startProtocol({ key, settings: prepared.settings, plan: prepared.plan, targets: prepared.targets }).promise
  return {
    errors: [],
    experiments: results.experiments.map((experiment) => ({
      t: [...experiment.voi.values],
      values: Object.fromEntries(spec.variables.map((name) => [name, [...experiment.variables.get(name).values]])),
    })),
  }
}"""


class TestProtocolParity(unittest.TestCase):

    def test_protocols_run_as_circulatory_autogen_runs_them(self):
        with open(os.path.join(PARITY, "cases.json")) as f:
            spec = json.load(f)
        with open(os.path.join(PARITY, "ca-references.json")) as f:
            references = json.load(f)["cases"]

        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)
            context = browser.new_context()
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            page.goto(BASE_URL, wait_until="commit")
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            if not page.evaluate(IS_DEV_SERVER):
                context.close()
                self.skipTest("The app's source modules aren't served here; run against the dev server.")

            # ---------- START -----------
            for case in spec["cases"]:
                with self.subTest(case=case["name"]):
                    with open(os.path.join(PARITY, case["model"])) as f:
                        cellml = f.read()
                    script = (
                        RUN_CASE.replace("__CASE__", json.dumps(case))
                        .replace("__CELLML__", json.dumps(cellml))
                        .replace("__TOLERANCE__", json.dumps(spec["solver"]["tolerance"]))
                    )
                    run = evaluate_within_a_minute(page, script)
                    self.assertEqual(run["errors"], [])
                    expected = references[case["name"]]
                    self.assertEqual(len(run["experiments"]), len(expected))
                    for e, (ours, theirs) in enumerate(zip(run["experiments"], expected)):
                        # The same time points, CA's own.
                        self.assertEqual(len(ours["t"]), len(theirs["t"]), f"experiment {e + 1}")
                        self.assertLess(max(abs(a - b) for a, b in zip(ours["t"], theirs["t"])), 1e-9, f"experiment {e + 1}")
                        for name in case["variables"]:
                            scale = max(1.0, max(abs(value) for value in theirs["values"][name]))
                            gap = max(abs(a - b) for a, b in zip(ours["values"][name], theirs["values"][name])) / scale
                            print(f"\n[{case['name']}] experiment {e + 1}, {name}: largest difference {gap:.2e} (allowed {case['tolerance']})")
                            self.assertLess(gap, case["tolerance"], f"{name}, experiment {e + 1}")
            # ----------- END ------------

            context.close()
            browser.close()


if __name__ == '__main__':
    unittest.main()
