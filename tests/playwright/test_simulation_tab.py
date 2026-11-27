import io
import json
import os
import re
import unittest
import zipfile

from playwright.sync_api import expect, sync_playwright

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
    from .fixtures import node, use_default_timeouts, workspace_url
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
    from fixtures import node, use_default_timeouts, workspace_url


# Automated browsers skip the isolation service worker unless they opt in (see index.html).
OPT_IN_TO_ISOLATION = "localStorage.setItem('phlynx.isolateUnderAutomation', 'true')"
# A short simulation, so the test doesn't wait on the default 10 s of model time.
SHORTEN_SIMULATION = (
    "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
    ".get('simulationSettings').setSimulationSettings({ endingPoint: 1, pointInterval: 0.01 })"
)
APP_MOUNT_TIMEOUT = 60000
SIMULATOR_READY = "document.querySelector('#app').__vue_app__._context.provides.$libopencor.status === 'ready'"
RESULTS_STORE = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulationResults')"
# source's x at the end of the shown run. source is the chain's first node.
FINAL_SOURCE_X = (
    f"(() => {{ const store = {RESULTS_STORE}; const name = store.mapping.get('dndnode_0::x');"
    " return store.results.variables.get(name).values.at(-1) })()"
)

# Gives the workspace an obs_data file as CUFLynx sends one: a warm-up, then two sub-experiments, the second
# experiment with source's rate doubled. relay's relaxation time stays at its model value throughout.
ADD_PROTOCOL = """(() => {
  const protocol = {
    pre_times: [0.05, 0.05],
    sim_times: [[0.1, 0.1], [0.1, 0.1]],
    params_to_change: { 'relay/T_relax': [[1, 1], [1, 1]], 'source/k': [[2, 2], [4, 4]] },
    experiment_labels: ['slow', 'fast'],
  }
  const payload = new TextEncoder().encode(JSON.stringify({ protocol_info: protocol, data_items: [] })).buffer
  document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('omex')
    .setArchive({ extras: [{ location: 'chain_obs_data.json', format: 'application/json', payload }] })
})()"""
# The values of source's k the shown experiment ran with, and how many experiments ran.
SHOWN_K = (
    f"(() => {{ const store = {RESULTS_STORE}; const name = store.mapping.get('dndnode_0::k');"
    " return { experiments: store.protocolResults.experiments.length, values: [...new Set(store.results.variables.get(name).values)] } })()"
)

# A ramp of source's rate, a constant of the model, which the protocol makes a driver it computes.
ADD_RAMP_PROTOCOL = ADD_PROTOCOL.replace(
    """    pre_times: [0.05, 0.05],
    sim_times: [[0.1, 0.1], [0.1, 0.1]],
    params_to_change: { 'relay/T_relax': [[1, 1], [1, 1]], 'source/k': [[2, 2], [4, 4]] },
    experiment_labels: ['slow', 'fast'],""",
    """    pre_times: [0],
    sim_times: [[0.2]],
    params_to_change: { 'source/k': [['up']] },
    protocol_shapes: { up: { type: 'ramp', from: 0, to: 0.02 } },""",
)
# source's rate as the ramp ran it: at the start, halfway and the end.
SHOWN_RAMP = (
    f"(() => {{ const store = {RESULTS_STORE}; const values = store.results.variables.get(store.protocolInputs.get('source/k').name).values;"
    " return [values[0], values[10], values.at(-1)] })()"
)

# source/k's value once its slider has moved 300 steps right from the model's 2.
SLIDER_MOVED_K = "2.12 per_second"

# Downloads go to the browser's save, not the File System Access picker, which Playwright can't answer.
USE_DOWNLOADS = "delete window.showSaveFilePicker"
# The prediction items added in Edit obs_data for ADD_PROTOCOL's experiments: relay's level in the second
# sub-experiment of the first, its trace and its mean.
PREDICTION_ITEMS = [
    {"data_item_name": "relay/y", "operands": ["relay/y"], "unit": "mM", "experiment_idx": 0, "subexperiment_idx": 1},
    {"data_item_name": "relay/y_2", "operands": ["relay/y"], "unit": "mM", "operation": "mean", "experiment_idx": 0, "subexperiment_idx": 1},
]
# ADD_PROTOCOL's protocol, its first experiment's first sub-experiment shortened to 0.08 s in the editor.
SAVED_PROTOCOL_INFO = {
    "pre_times": [0.05, 0.05],
    "sim_times": [[0.08, 0.1], [0.1, 0.1]],
    "params_to_change": {"relay/T_relax": [[1, 1], [1, 1]], "source/k": [[2, 2], [4, 4]]},
    "experiment_labels": ["slow", "fast"],
}
# The workspace's obs_data, as saved.
SAVED_OBS_DATA = (
    "(() => { const extras = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('omex').preservedExtras;"
    " return JSON.parse(new TextDecoder().decode(extras.find(({ location }) => location === 'chain_obs_data.json').payload)) })()"
)
# ADD_PROTOCOL's obs_data with data items as CUFLynx writes them: relay's peak level in the second sub-experiment
# of each experiment, with what a calibration fits it with.
ADD_DATA_ITEMS_PROTOCOL = ADD_PROTOCOL.replace(
    "data_items: []",
    "data_items: "
    + json.dumps([
        {"data_item_name": f"y_peak_{label}", "operands": ["relay/y"], "unit": "mM", "operation": "max",
         "data_type": "constant", "value": 0.2, "std": 0.02, "weight": 1, "experiment_idx": e, "subexperiment_idx": 1}
        for e, label in enumerate(["slow", "fast"])
    ]),
)

# The one test on a real model: PhLynx's protocol features against circulatory autogen's for the SN model, which
# needs that model. The SN features case of the protocol parity checks (tests/resources/protocols/parity/features.json), whose model the
# workspace's SN model is, with CA's values for it, and a data item measuring what its V_peak_e1 computes: V's max in
# the first experiment's second sub-experiment.
PARITY = os.path.join(RESOURCE_PATH, "protocols", "parity")
with open(os.path.join(PARITY, "features.json")) as _features:
    _spec = json.load(_features)
FEATURES_CASE = _spec["cases"][0]
FEATURES_SETTINGS = (
    "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulationSettings')"
    f".setSimulationSettings({{ pointInterval: {FEATURES_CASE['pointInterval']}, timeStep: {FEATURES_CASE['maximumStep']},"
    f" relativeTolerance: {_spec['solver']['tolerance']}, maxSteps: 50000 }})"
)
with open(os.path.join(PARITY, "ca-features.json")) as _references:
    CA_FEATURES = json.load(_references)["cases"][FEATURES_CASE["name"]]
FEATURES_OBS_DATA = {
    **FEATURES_CASE["obs_data"],
    "data_items": [
        {"data_item_name": "V_peak_obs", "operands": ["soma_SN/V"], "unit": "milliV", "operation": "max", "data_type": "constant",
         "plot_type": "horizontal", "value": -60, "std": 1, "weight": 1, "experiment_idx": 0, "subexperiment_idx": 1},
    ],
}
ADD_FEATURES_PROTOCOL = (
    "(() => { const payload = new TextEncoder().encode(" + json.dumps(json.dumps(FEATURES_OBS_DATA)) + ").buffer;"
    " document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('omex')"
    ".setArchive({ extras: [{ location: 'SN_simple_obs_data.json', format: 'application/json', payload }] }) })()"
)


def simulate_selection(page):
    """Switches the Simulation tab to the selection, then presses play."""
    page.get_by_role("switch", name="Simulate the whole model, not the selection").uncheck()
    page.get_by_role("button", name=re.compile(r"^Simulate the selection")).click()


def simulate_whole_model(page):
    """Switches the Simulation tab to the whole model, then presses play."""
    page.get_by_role("switch", name="Simulate the whole model, not the selection").check()
    page.get_by_role("button", name="Simulate the whole model").click()


def pick_path(page, box_name, path, within=None):
    """Searches for an instance/variable path in a Simulation tab search box and picks it."""
    scope = within or page
    query = path.replace("/", " ")
    scope.get_by_role("combobox", name=box_name).fill(query)
    # The box lists every path as soon as it has focus and only filters 120 ms after typing, so wait for the
    # filtered list: a row picked from the unfiltered one can be replaced under the click.
    page.wait_for_function(
        """(words) => {
            const options = [...document.querySelectorAll('.p-autocomplete-option')]
            return options.length > 0
                && options.every((o) => words.every((w) => (o.getAttribute('aria-label') ?? '').toLowerCase().includes(w)))
        }""",
        arg=query.lower().split(),
    )
    option =page.locator(".path-option").filter(has=page.locator(".path-text", has_text=re.compile(rf"^{re.escape(path)}$")))
    option.first.click()


def plot_variable(page, path, within=None):
    """Plots a variable by its instance/variable path."""
    pick_path(page, "Add a variable to plot", path, within)


def click_math_variable(page, dialog, name):
    """Clicks a variable's name where an instance editor's CellML Text solves for it, as in `ode(V, t)`."""
    point = dialog.locator(".cm-content").evaluate(
        r"""(content, name) => {
          const pattern = new RegExp(`\\bode\\(\\s*${name}\\b`)
          for (const line of content.querySelectorAll('.cm-line')) {
            const match = pattern.exec(line.textContent)
            if (!match) continue
            // The line's text is split across its tokens' text nodes: find the one the name starts in.
            let offset = match.index + match[0].length - name.length
            const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
            for (let node = walker.nextNode(); node; node = walker.nextNode()) {
              if (offset >= node.textContent.length) {
                offset -= node.textContent.length
                continue
              }
              const range = document.createRange()
              range.setStart(node, offset)
              range.setEnd(node, Math.min(offset + name.length, node.textContent.length))
              const rect = range.getBoundingClientRect()
              return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
            }
          }
          return null
        }""",
        name,
    )
    assert point is not None, f"No ode({name}, ...) in the CellML Text to click"
    page.mouse.click(point["x"], point["y"])


def add_slider(page, path, within=None):
    """Adds a slider for a parameter by its instance/variable path, from the Sliders view."""
    scope = within or page
    scope.get_by_role("button", name=re.compile(r"^Sliders \(")).click()
    open_slider_search(scope)
    pick_path(page, "Add a slider", path, within)


def open_slider_search(scope):
    """Shows the slider search, which tucks away once there are sliders."""
    if not scope.get_by_role("combobox", name="Add a slider").is_visible():
        scope.get_by_role("button", name="Add slider", exact=True).click()


class TestSimulationTab(unittest.TestCase):

    def test_simulate_a_selected_instance_and_plot_a_variable(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            source = node(page, "source")
            source.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            source.click(button="right")
            expect(page.get_by_text("Simulate Instance")).to_be_visible()
            page.keyboard.press("Escape")
            source.click()

            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_selection(page)

            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            plot_variable(page, "source/x")
            expect(page.locator(".simulation-plot canvas")).to_have_count(1)
            expect(page.locator(".simulation-plot .plot-title")).to_have_text("source/x")
            expect(page.locator(".instance-node--simulated")).to_have_count(1)

            # A variable in another unit gets its own chart, which the tab scrolls to.
            plot_variable(page, "source/k")
            expect(page.locator(".simulation-plot")).to_have_count(2)
            second_chart = page.locator(".simulation-plot").nth(1)
            second_chart.scroll_into_view_if_needed()
            expect(second_chart).to_be_in_viewport()
            # ----------- END ------------

            context.close()
            browser.close()


    def test_slider_tries_a_parameter_value_and_applies_it(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            source = node(page, "source")
            source.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            source.click()
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_selection(page)
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            before = page.evaluate(FINAL_SOURCE_X)

            add_slider(page, "source/k")
            page.get_by_role("slider", name="k value").focus()
            for _ in range(300):
                page.keyboard.press("ArrowRight")
            expect(page.locator(".slider-value--changed")).to_have_text(SLIDER_MOVED_K)
            # The slider asks for a run, which gives a different end value.
            page.wait_for_function(
                f"{RESULTS_STORE}.status === 'done' && {FINAL_SOURCE_X} !== {before!r}",
                timeout=120000,
            )

            page.get_by_role("button", name="More for k").click()
            page.get_by_role("menuitem", name="Apply this value to the model").click()
            expect(page.locator(".slider-value--changed")).to_have_count(0)
            expect(page.locator(".slider-value")).to_have_text(SLIDER_MOVED_K)
            expect(page.get_by_text("The model or settings have changed since this run.")).to_have_count(0)
            # Its range opens from its menu, and changes as typed.
            page.get_by_role("button", name="More for k").click()
            page.get_by_role("menuitem", name="Edit range…").click()
            page.get_by_label("Maximum").fill("3")
            page.get_by_label("Maximum").press("Tab")
            page.wait_for_function(
                "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulationSettings')"
                ".parameterScanConfig.selections[0].max === 3"
            )
            page.keyboard.press("Escape")
            # ----------- END ------------

            context.close()
            browser.close()


    def test_sweeps_a_parameter_of_a_model_with_odes(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            source = node(page, "source")
            source.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            source.click()
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_selection(page)
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            plot_variable(page, "source/x")

            # The sweep is set in its view, then played with the Sweep run mode.
            page.get_by_role("button", name=re.compile(r"^Sweep \(")).click()
            page.get_by_role("button", name="Sweep a parameter").click()
            pick_path(page, "Choose a parameter to sweep", "source/k")
            page.get_by_test_id("sim-sweep-points").fill("3")
            page.get_by_test_id("sim-sweep-points").press("Tab")
            page.get_by_test_id("sim-sweep-mode").click()

            page.wait_for_function(f"{RESULTS_STORE}.status === 'done' && {RESULTS_STORE}.results.isSweep", timeout=120000)
            results = page.evaluate(
                f"(() => {{ const store = {RESULTS_STORE}; const name = store.mapping.get('dndnode_0::x');"
                " return { readout: store.results.readout, isSteadyState: store.results.isSteadyState,"
                " points: store.results.voi.values.length, values: store.results.variables.get(name).values.length } })()"
            )
            self.assertEqual(results, {"readout": "end", "isSteadyState": False, "points": 3, "values": 3})
            expect(page.get_by_text(re.compile(r"at 3 values of source/k.*reading the end of each time course"))).to_be_visible()
            expect(page.locator(".simulation-plot .plot-title-against")).to_have_text(" vs source/k (end of each run)")

            # Another reading, saved with the sweep, reads each time course again.
            page.get_by_test_id("sim-sweep-readout").get_by_text("Min", exact=True).click()
            page.keyboard.press("F9")
            page.wait_for_function(f"{RESULTS_STORE}.status === 'done' && {RESULTS_STORE}.results.readout === 'min'", timeout=120000)
            expect(page.locator(".simulation-plot .plot-title-against")).to_have_text(" vs source/k (min of each run)")

            # Back on the time course, play runs it again.
            page.get_by_test_id("sim-run-mode").click()
            page.wait_for_function(f"{RESULTS_STORE}.status === 'done' && !{RESULTS_STORE}.results.isSweep", timeout=120000)
            # ----------- END ------------

            context.close()
            browser.close()


    def test_sweeps_a_curve_for_each_value_of_a_second_parameter(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            source = node(page, "source")
            source.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            source.click()
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_selection(page)
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            plot_variable(page, "source/x")
            plot_variable(page, "source/k")

            page.get_by_role("button", name=re.compile(r"^Sweep \(")).click()
            page.get_by_role("button", name="Sweep a parameter").click()
            pick_path(page, "Choose a parameter to sweep", "source/k")
            page.get_by_test_id("sim-sweep-points").fill("3")
            page.get_by_test_id("sim-sweep-points").press("Tab")
            page.get_by_role("button", name="More for the k sweep").click()
            page.get_by_role("menuitem", name="Add a curve for each value of…").click()
            pick_path(page, "Choose a parameter for the curves", "source/x_init")
            page.get_by_test_id("sim-sweep-family-values").fill("1, 2")
            page.get_by_test_id("sim-sweep-family-values").press("Enter")
            expect(page.get_by_test_id("sim-sweep-cost")).to_contain_text("3 × 2 = 6 time courses")
            expect(page.get_by_role("button", name="Sweep (2)")).to_be_visible()
            page.get_by_test_id("sim-sweep-mode").click()

            page.wait_for_function(f"{RESULTS_STORE}.status === 'done' && {RESULTS_STORE}.results.family?.curves?.length === 2", timeout=120000)
            # A chart per variable, a curve per value of x_init in its own colour, keyed by the value.
            expect(page.locator(".simulation-plot")).to_have_count(2)
            first = page.locator(".simulation-plot").first
            expect(first.locator(".plot-key .plot-key-toggle")).to_have_text(["source/x_init = 1 mM", "source/x_init = 2 mM"])
            expect(page.get_by_text(re.compile(r"a curve for each of 2 values of source/x_init"))).to_be_visible()
            # ----------- END ------------

            context.close()
            browser.close()


    def test_tracked_run_stays_on_the_chart_as_a_slider_moves(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            source = node(page, "source")
            source.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            source.click()
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_selection(page)
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            plot_variable(page, "source/x")
            add_slider(page, "source/k")
            page.wait_for_function(f"{RESULTS_STORE}.status === 'done'", timeout=120000)

            page.get_by_role("button", name=re.compile(r"^Runs \(0\)")).click()
            expect(page.get_by_text("Track a run from the toolbar to keep its lines on the charts")).to_be_visible()
            page.get_by_role("button", name="Track this run", exact=True).click()
            expect(page.get_by_role("button", name=re.compile(r"^Runs \(1\)"))).to_be_visible()
            expect(page.get_by_text("Run #1")).to_be_visible()
            # The chart says which run each line is from: the live run solid, the tracked run dashed.
            run_key = page.locator(".simulation-plot .plot-key[aria-label=Runs] li")
            expect(run_key).to_have_text(["Live", "#1"])

            before = page.evaluate(FINAL_SOURCE_X)
            page.get_by_role("button", name=re.compile(r"^Sliders \(")).click()
            page.get_by_role("slider", name="k value").focus()
            for _ in range(300):
                page.keyboard.press("ArrowRight")
            page.wait_for_function(
                f"{RESULTS_STORE}.status === 'done' && {FINAL_SOURCE_X} !== {before!r}",
                timeout=120000,
            )
            # The tracked run keeps its own values, which decay slower than the larger k's.
            tracked, largest_difference = page.evaluate(
                f"(() => {{ const store = {RESULTS_STORE}; const run = store.trackedRuns[0];"
                " const read = (results, mapping) => results.variables.get(mapping.get('dndnode_0::x')).values;"
                " const tracked = read(run.results, run.mapping); const live = read(store.results, store.mapping);"
                " let largest = 0; for (let i = 0; i < tracked.length; i++) largest = Math.max(largest, Math.abs(tracked[i] - live[i]));"
                " return [tracked.at(-1), largest] })()"
            )
            self.assertEqual(tracked, before)
            self.assertGreater(largest_difference, 0.01)
            expect(run_key).to_have_text(["Live", "#1"])

            page.get_by_role("button", name=re.compile(r"^Runs \(1\)")).click()
            expect(page.locator(".run-item").nth(1)).to_contain_text("The model’s values")
            expect(page.locator(".run-item").nth(0)).to_contain_text(f"source/k = {SLIDER_MOVED_K}")
            # A tracked run named in the list goes by its name on the chart.
            page.locator(".run-name--editable").click()
            page.get_by_role("textbox", name="Run name").fill("Fast decay")
            page.keyboard.press("Enter")
            expect(run_key).to_have_text(["Live", "Fast decay"])
            page.get_by_role("button", name="Hide Fast decay", exact=True).click()
            expect(run_key).to_have_count(0)
            page.get_by_role("button", name="Show Fast decay", exact=True).click()
            expect(run_key).to_have_text(["Live", "Fast decay"])
            page.get_by_role("button", name="Stop tracking Fast decay", exact=True).click()
            expect(page.get_by_role("button", name=re.compile(r"^Runs \(0\)"))).to_be_visible()
            expect(run_key).to_have_count(0)
            # ----------- END ------------

            context.close()
            browser.close()


    def test_plots_variables_of_two_instances_on_one_chart(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            source = node(page, "source")
            relay = node(page, "relay")
            source.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            source.click()
            relay.click(modifiers=["ControlOrMeta"])
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_selection(page)
            expect(page.get_by_text("Simulated 2 instances on their own")).to_be_visible(timeout=120000)

            for path in ("source/x", "relay/y"):
                plot_variable(page, path)

            # Same plot and unit, so both lines share a chart, named by instance.
            expect(page.locator(".simulation-plot")).to_have_count(1)
            expect(page.locator(".simulation-plot .plot-title")).to_have_text("source/x, relay/y")

            # Clicking a line's name hides it, leaving it out of the hover readout, and clicking it again shows it.
            chart = page.locator(".simulation-plot")
            relay_toggle = chart.get_by_role("button", name="relay/y", exact=True)
            box = chart.locator(".u-over").bounding_box()
            hover = (box["x"] + box["width"] * 0.6, box["y"] + box["height"] / 2)
            relay_toggle.click()
            expect(relay_toggle).to_have_attribute("aria-pressed", "false")
            page.mouse.move(*hover)
            expect(chart.locator(".plot-readout-row")).to_have_count(1)
            expect(chart.locator(".plot-readout-label")).to_have_text("source/x")
            relay_toggle.click()
            expect(relay_toggle).to_have_attribute("aria-pressed", "true")
            page.mouse.move(*hover)
            expect(chart.locator(".plot-readout-row")).to_have_count(2)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_simulation_page_syncs_cursors_and_downloads(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            source = node(page, "source")
            source.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            source.click()
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_selection(page)
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            plot_variable(page, "source/x")

            page.get_by_role("link", name="Simulation", exact=True).click()
            expect(page).to_have_url(re.compile(r"/simulation$"))
            sim_page = page.locator(".simulation-view")
            charts = sim_page.locator(".simulation-plot")
            expect(charts).to_have_count(1)
            # Variables can be plotted from beside the charts too.
            plot_variable(page, "source/k", within=sim_page)
            expect(charts).to_have_count(2)

            # So can sliders be added and moved, rerunning the simulation.
            add_slider(page, "source/k", within=sim_page)
            page.evaluate(f"window.__shownResults = {RESULTS_STORE}.results")
            sim_page.locator(".p-slider-handle").first.focus()
            for _ in range(10):
                page.keyboard.press("ArrowRight")
            page.wait_for_function(
                f"{RESULTS_STORE}.results !== window.__shownResults && {RESULTS_STORE}.status === 'done'", timeout=60000
            )

            # Hovering one chart shows the cursor at the same time on the other.
            box = charts.first.locator(".u-over").bounding_box()
            page.mouse.move(box["x"] + box["width"] * 0.6, box["y"] + box["height"] / 2)
            times = charts.locator(".plot-readout-time")
            expect(times).to_have_count(2)
            expect(times.nth(1)).to_have_text(times.nth(0).inner_text())

            with page.expect_download() as download:
                sim_page.get_by_test_id("sim-export").click()
            with open(download.value.path()) as f:
                lines = f.read().splitlines()
            # The first column is the variable of integration, named after the model's first ODE's: t.
            self.assertEqual(lines[0], "t (second),source/x (mM),source/k (per_second)")
            self.assertEqual(len(lines), 1 + 101)
            self.assertEqual(lines[1].split(",")[0], "0")

            with page.expect_download() as download:
                sim_page.get_by_role("button", name="Choose what to download").click()
                page.get_by_role("menuitem", name="PNG").click()
            with open(download.value.path(), "rb") as f:
                self.assertEqual(f.read(8), b"\x89PNG\r\n\x1a\n")

            # Back on the workspace, the sidebar shows both charts too.
            page.get_by_role("link", name="Workspace", exact=True).click()
            expect(page).not_to_have_url(re.compile(r"/simulation$"))
            expect(page.locator(".simulation-panel .simulation-plot")).to_have_count(2)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_runs_a_protocol_from_cuflynx_and_shows_each_experiment(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            node(page, "source").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            protocol_button = page.locator(".simulation-panel").get_by_test_id("sim-protocol-mode")
            # Shown before there is a protocol, disabled, saying why.
            expect(protocol_button).to_have_attribute("aria-disabled", "true")
            # A slider tried out before the protocol turns on, on a parameter the protocol doesn't set.
            add_slider(page, "sink/k")
            slider = page.get_by_role("slider", name="k value")
            slider.focus()
            for _ in range(10):
                page.keyboard.press("ArrowRight")
            slider_value = page.locator(".slider-value")
            expect(page.locator(".slider-value--changed")).to_have_count(1)
            tried_value = slider_value.inner_text()
            slider_note = page.get_by_text("Sliders are off while the protocol runs. Switch to the time course to use them.")
            expect(slider_note).to_have_count(0)

            # A protocol appears with the obs_data file, and turning it on runs it.
            page.evaluate(ADD_PROTOCOL)
            protocol_button.click()
            expect(protocol_button).to_have_attribute("aria-pressed", "true")
            page.wait_for_function(f"['done', 'error', 'blocked'].includes({RESULTS_STORE}.status)", timeout=120000)
            self.assertEqual(page.evaluate(f"{RESULTS_STORE}.status"), "done", page.evaluate(f"JSON.stringify([{RESULTS_STORE}.report, {RESULTS_STORE}.error])"))
            self.assertEqual(page.evaluate(SHOWN_K), {"experiments": 2, "values": [2]})
            # The protocol runs the model as it is: the sliders are off, and keys don't move them or run anything.
            expect(slider_note).to_be_visible()
            expect(slider).to_have_attribute("aria-disabled", "true")
            expect(slider).to_have_attribute("tabindex", "-1")
            page.evaluate(f"window.__shownResults = {RESULTS_STORE}.results")
            slider.focus()
            page.keyboard.press("ArrowRight")
            # Its value waits for the time course, not shown as changed, as the protocol ran without it.
            expect(slider_value).to_have_text(tried_value)
            expect(page.locator(".slider-value--changed")).to_have_count(0)
            self.assertTrue(page.evaluate(f"{RESULTS_STORE}.results === window.__shownResults && {RESULTS_STORE}.status === 'done'"))
            page.get_by_role("button", name=re.compile(r"^Plots \(")).click()
            self.assertEqual(page.evaluate(f"{RESULTS_STORE}.results.voi.values.length"), 21)
            expect(page.get_by_text("Ran 2 protocol experiments on the whole model")).to_be_visible()
            # The values it set are plotted only when asked for, after the results (none are plotted here).
            titles = page.locator(".simulation-plot .plot-title")
            expect(titles).to_have_count(0)
            page.get_by_role("button", name="Show the values the protocol set").first.click()
            expect(titles.last).to_have_text(re.compile(r"relay/T_relax|source/k"))

            # The second experiment ran with source's rate doubled.
            page.get_by_role("combobox", name="Experiment to show").click()
            page.get_by_role("option", name="fast").click()
            self.assertEqual(page.evaluate(SHOWN_K), {"experiments": 2, "values": [4]})

            # The simulation page switches between them too, once the sidebar's list has gone.
            expect(page.get_by_role("listbox")).to_have_count(0)
            page.get_by_role("link", name="Simulation", exact=True).click()
            sim_page = page.locator(".simulation-view")
            sim_page.get_by_role("combobox", name="Experiment to show").click()
            page.get_by_role("option", name="slow", exact=True).click()
            self.assertEqual(page.evaluate(SHOWN_K), {"experiments": 2, "values": [2]})
            # It switches between the time course and the protocol too, running each at once.
            run_mode = sim_page.get_by_role("group", name="What play runs")
            page_protocol = run_mode.get_by_role("button", name="Protocol")
            run_mode.get_by_role("button", name="Time course").click()
            expect(page_protocol).to_have_attribute("aria-pressed", "false")
            page.wait_for_function(f"{RESULTS_STORE}.status === 'done' && !{RESULTS_STORE}.protocolResults", timeout=120000)
            expect(sim_page.get_by_role("combobox", name="Experiment to show")).to_have_count(0)
            page_protocol.click()
            expect(page_protocol).to_have_attribute("aria-pressed", "true")
            page.wait_for_function(f"{RESULTS_STORE}.status === 'done' && !!{RESULTS_STORE}.protocolResults", timeout=120000)
            expect(sim_page.get_by_role("combobox", name="Experiment to show")).to_be_visible()
            page.get_by_role("link", name="Workspace", exact=True).click()
            expect(sim_page).to_have_count(0)

            # Back to the time course, the slider is on again with the value it was left at.
            page.locator(".simulation-panel").get_by_test_id("sim-run-mode").click()
            expect(protocol_button).to_have_attribute("aria-pressed", "false")
            page.get_by_role("button", name=re.compile(r"^Sliders \(")).click()
            expect(slider_note).to_have_count(0)
            expect(slider).to_have_attribute("tabindex", "0")
            expect(slider_value).to_have_text(tried_value)
            expect(page.locator(".slider-value--changed")).to_have_count(1)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_runs_a_protocol_ramp_as_an_input_the_model_computes(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            node(page, "source").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()

            page.evaluate(ADD_RAMP_PROTOCOL)
            page.locator(".simulation-panel").get_by_test_id("sim-protocol-mode").click()
            page.wait_for_function(f"['done', 'error', 'blocked'].includes({RESULTS_STORE}.status)", timeout=120000)
            self.assertEqual(page.evaluate(f"{RESULTS_STORE}.status"), "done", page.evaluate(f"JSON.stringify([{RESULTS_STORE}.report, {RESULTS_STORE}.error])"))
            start, middle, end = page.evaluate(SHOWN_RAMP)
            self.assertAlmostEqual(start, 0, places=9)
            self.assertAlmostEqual(middle, 0.01, places=9)
            self.assertAlmostEqual(end, 0.02, places=9)
            page.get_by_role("button", name="Show the values the protocol set").first.click()
            expect(page.locator(".simulation-plot .plot-title").last).to_have_text("source/k")
            # ----------- END ------------

            context.close()
            browser.close()

    def test_writes_a_protocol_and_runs_it(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            node(page, "source").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()

            # A protocol of two sub-experiments, the second doubling source's rate, then a copy of it.
            page.get_by_role("button", name="Edit protocol", exact=True).click()
            dialog = page.get_by_role("dialog", name="Edit obs_data")
            dialog.get_by_role("button", name="Add protocol_info").click()
            dialog.get_by_role("button", name="Add parameter to set").click()
            pick_path(page, "Add a parameter for the protocol to set", "source/k", within=dialog)
            dialog.get_by_role("button", name=re.compile(r"^Edit sub-experiment 1 length")).click()
            dialog.get_by_label("Sub-experiment 1 length", exact=True).fill("0.1")
            dialog.get_by_label("Sub-experiment 1 length", exact=True).press("Enter")
            dialog.get_by_role("button", name="Add a sub-experiment").click()
            dialog.get_by_role("button", name="Change how source/k varies in sub-experiment 2").click()
            page.locator(".cell-editor").get_by_label("Value").fill("4")
            page.locator(".cell-editor").get_by_label("Value").press("Enter")
            expect(dialog.get_by_role("button", name="How source/k varies in sub-experiment 2: Number")).to_contain_text("4")
            dialog.get_by_role("button", name="More for Experiment 1").click()
            page.get_by_role("menuitem", name="Duplicate").click()
            expect(dialog.get_by_role("button", name="Experiment 2", exact=True)).to_have_attribute("aria-pressed", "true")
            dialog.get_by_role("button", name="Save").click()
            expect(dialog).to_be_hidden()

            # Saved as the workspace's obs_data, the protocol now runs.
            page.locator(".simulation-panel").get_by_test_id("sim-protocol-mode").click()
            page.wait_for_function(f"['done', 'error', 'blocked'].includes({RESULTS_STORE}.status)", timeout=120000)
            self.assertEqual(page.evaluate(f"{RESULTS_STORE}.status"), "done", page.evaluate(f"JSON.stringify([{RESULTS_STORE}.report, {RESULTS_STORE}.error])"))
            expect(page.get_by_text("Ran 2 protocol experiments on the whole model")).to_be_visible()
            self.assertEqual(page.evaluate(SHOWN_K), {"experiments": 2, "values": [2, 4]})
            # ----------- END ------------

            context.close()
            browser.close()

    def test_sets_a_pulse_and_a_trace_and_runs_them(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            node(page, "source").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()

            page.get_by_role("button", name="Edit protocol", exact=True).click()
            dialog = page.get_by_role("dialog", name="Edit obs_data")
            dialog.get_by_role("button", name="Add protocol_info").click()
            dialog.get_by_role("button", name=re.compile(r"^Edit sub-experiment 1 length")).click()
            dialog.get_by_label("Sub-experiment 1 length", exact=True).fill("0.1")
            dialog.get_by_label("Sub-experiment 1 length", exact=True).press("Enter")
            dialog.get_by_role("button", name="Add parameter to set").click()
            pick_path(page, "Add a parameter for the protocol to set", "source/k", within=dialog)
            dialog.get_by_role("button", name="Add parameter to set").click()
            pick_path(page, "Add a parameter for the protocol to set", "sink/k", within=dialog)

            # source's k doubles from 0.02 to 0.06 into the sub-experiment.
            # Its segment's chip says what it is, and picks another kind.
            chip = dialog.get_by_role("button", name="How source/k varies in sub-experiment 1: Number")
            chip.click()
            page.get_by_role("menuitem", name="Pulse").click()
            cell = page.locator(".cell-editor")
            expect(cell.locator(".p-togglebutton-checked")).to_have_text("Pulse")
            expect(cell.get_by_label("Pulse starts", exact=True)).to_be_visible()
            for label, value in (("Baseline value", "2"), ("Pulse value", "4"), ("Pulse starts", "0.02"), ("Pulse ends", "0.06")):
                cell.get_by_label(label, exact=True).fill(value)
                cell.get_by_label(label, exact=True).press("Tab")
            cell.get_by_role("button", name="Apply").click()
            expect(dialog.get_by_role("button", name="How source/k varies in sub-experiment 1: Pulse")).to_be_visible()

            # sink's rate follows a recorded trace.
            dialog.get_by_role("button", name="Change how sink/k varies in sub-experiment 1").click()
            cell.get_by_text("Trace", exact=True).click()
            cell.locator("input[type=file]").set_input_files(os.path.join(RESOURCE_PATH, "protocols", "input_trace.csv"))
            expect(cell.get_by_text("3 points from 0 to 0.1")).to_be_visible()
            cell.get_by_role("button", name="Apply").click()
            expect(dialog.get_by_role("button", name="How sink/k varies in sub-experiment 1: Trace")).to_be_visible()
            dialog.get_by_role("button", name="Save").click()

            page.locator(".simulation-panel").get_by_test_id("sim-protocol-mode").click()
            page.wait_for_function(f"['done', 'error', 'blocked'].includes({RESULTS_STORE}.status)", timeout=120000)
            self.assertEqual(page.evaluate(f"{RESULTS_STORE}.status"), "done", page.evaluate(f"JSON.stringify([{RESULTS_STORE}.report, {RESULTS_STORE}.error])"))
            inputs = page.evaluate(
                f"(() => {{ const store = {RESULTS_STORE}; const read = (name) => [...store.results.variables.get(store.protocolInputs.get(name).name).values];"
                " return { pulse: read('source/k'), trace: read('sink/k') } })()"
            )
            self.assertEqual(inputs["pulse"][1], 2)
            self.assertEqual(inputs["pulse"][4], 4)
            self.assertEqual(inputs["pulse"][7], 2)
            self.assertAlmostEqual(inputs["trace"][5], 0.01, places=9)
            self.assertAlmostEqual(inputs["trace"][10], 0, places=9)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_edits_prediction_items_and_downloads_the_run_as_sedml(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
            context.add_init_script(OPT_IN_TO_ISOLATION)
            context.add_init_script(USE_DOWNLOADS)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            node(page, "source").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()

            page.evaluate(ADD_PROTOCOL)
            page.get_by_role("button", name="Edit protocol", exact=True).click()
            dialog = page.get_by_role("dialog", name="Edit obs_data")
            # With no data items, there are none to list, and the footer counts none.
            expect(dialog.get_by_role("region", name="prediction_items")).to_be_visible()
            expect(dialog.get_by_role("region", name="data_items")).to_contain_text("No data_items")
            expect(dialog.get_by_text("0 data item(s)")).to_be_visible()
            # relay's relaxation time, at its model value throughout, is tucked away until asked for.
            show = dialog.get_by_role("button", name="Show 1 parameter at its model value")
            expect(dialog.get_by_text("1 parameter at its model value", exact=True)).to_be_visible()
            expect(dialog.get_by_role("button", name="Stop setting relay/T_relax")).to_have_count(0)
            expect(dialog.get_by_role("button", name="Stop setting source/k")).to_be_visible()
            expect(show).to_have_attribute("aria-expanded", "false")
            show.click()
            hide = dialog.get_by_role("button", name="Hide 1 parameter at its model value")
            expect(hide).to_have_attribute("aria-expanded", "true")
            expect(dialog.get_by_role("button", name="Stop setting relay/T_relax")).to_be_visible()
            hide.click()
            expect(dialog.get_by_role("button", name="Stop setting relay/T_relax")).to_have_count(0)
            dialog.get_by_role("button", name=re.compile(r"^Edit sub-experiment 1 length")).click()
            dialog.get_by_label("Sub-experiment 1 length", exact=True).fill("0.08")
            dialog.get_by_label("Sub-experiment 1 length", exact=True).press("Enter")

            # Two prediction items, a row each: relay's level in the second sub-experiment, and its mean there.
            section = dialog.get_by_role("region", name="prediction_items")
            rows = section.get_by_test_id("od-prediction-row")
            for position, operation in ((0, ""), (1, "mean")):
                section.get_by_role("button", name="Add prediction").click()
                row = rows.nth(position)
                row.get_by_role("button", name="variable").click()
                pick_path(page, "variable", "relay/y", within=row)
                expect(row.get_by_role("button", name="variable")).to_have_text("relay/y")
                expect(row.get_by_label("unit", exact=True)).to_have_value("mM")
                row.get_by_label("sub", exact=True).select_option("1")
                if operation:
                    row.get_by_label("operation", exact=True).select_option(operation)
            expect(rows).to_have_count(2)
            # Its name follows the variable's, apart from the first's.
            expect(rows.nth(1).get_by_label("name", exact=True)).to_have_value("relay/y_2")
            # An undo takes the operation back, and a redo brings it again.
            dialog.get_by_role("button", name="Undo").click()
            expect(rows.nth(1).get_by_label("operation", exact=True)).to_have_value("")
            dialog.get_by_role("button", name="Redo").click()
            expect(rows.nth(1).get_by_label("operation", exact=True)).to_have_value("mean")
            dialog.get_by_role("button", name="Save").click()
            expect(dialog).to_be_hidden()
            saved = page.evaluate(SAVED_OBS_DATA)
            # The protocol as it was but the length changed, relay's relaxation time at its model value included.
            self.assertEqual(saved["protocol_info"], SAVED_PROTOCOL_INFO)
            self.assertEqual(saved["prediction_items"], PREDICTION_ITEMS)

            page.locator(".simulation-panel").get_by_test_id("sim-protocol-mode").click()
            page.wait_for_function(f"['done', 'error', 'blocked'].includes({RESULTS_STORE}.status)", timeout=120000)
            self.assertEqual(page.evaluate(f"{RESULTS_STORE}.status"), "done", page.evaluate(f"JSON.stringify([{RESULTS_STORE}.report, {RESULTS_STORE}.error])"))
            page.get_by_role("button", name=re.compile(r"^Plots \(")).click()
            plot_variable(page, "relay/y")
            page.get_by_role("link", name="Simulation", exact=True).click()
            results = page.locator(".simulation-view")
            with page.expect_download() as download:
                results.get_by_role("button", name="Choose what to download").click()
                page.get_by_role("menuitem", name="SED-ML").click()

            # The zip holds the SED-ML and the model it runs, with the protocol's clock written in.
            with open(download.value.path(), "rb") as f:
                bundle = zipfile.ZipFile(io.BytesIO(f.read()))
            self.assertEqual(sorted(bundle.namelist()), ["manifest.xml", "protocol.sedml", "protocol_model.cellml"])
            self.assertIn("protocol_clock", bundle.read("protocol_model.cellml").decode())
            sedml = bundle.read("protocol.sedml").decode()
            self.assertIn('source="protocol_model.cellml"', sedml)
            self.assertIn("relay", sedml)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_lists_the_data_items_read_only_unless_the_settings_hide_them(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            node(page, "source").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            page.evaluate(ADD_DATA_ITEMS_PROTOCOL)
            saved = page.evaluate(SAVED_OBS_DATA)

            # A row each, without what a calibration needs or a way to edit them.
            page.get_by_role("button", name="Edit protocol", exact=True).click()
            dialog = page.get_by_role("dialog", name="Edit obs_data")
            section = dialog.get_by_role("region", name="data_items")
            rows = section.get_by_test_id("od-data-row")
            expect(rows).to_have_count(2)
            expect(rows.first).to_contain_text("y_peak_slow")
            expect(rows.first).to_contain_text("max")
            expect(rows.nth(1)).to_contain_text("y_peak_fast")
            expect(section.locator("input, select")).to_have_count(0)
            expect(section.get_by_role("button", name="remove")).to_have_count(0)
            expect(dialog.get_by_text("2 data item(s)")).to_be_visible()
            # Its details show its operands, but not its weight.
            rows.first.get_by_role("button", name="details").click()
            expect(rows.first).to_contain_text("relay/y")
            expect(rows.first).not_to_contain_text("weight")
            expect(section.locator("input, select")).to_have_count(0)
            # Listing them changes nothing to save.
            expect(dialog.get_by_role("button", name="Save")).to_be_disabled()
            dialog.get_by_role("button", name="Cancel").click()
            expect(dialog).to_be_hidden()

            # Turned off in Settings, the section goes; the obs_data is as it was.
            page.get_by_role("button", name="Settings", exact=True).click()
            settings = page.get_by_role("dialog", name="Settings")
            settings.get_by_role("tab", name="Simulation", exact=True).click()
            show_data_items = page.get_by_role("switch", name="Show data items")
            expect(show_data_items).to_be_checked()
            show_data_items.uncheck()
            settings.get_by_role("button", name="Done").click()
            page.get_by_role("button", name="Edit protocol", exact=True).click()
            expect(dialog.get_by_role("region", name="prediction_items")).to_be_visible()
            expect(dialog.get_by_role("region", name="data_items")).to_have_count(0)
            dialog.get_by_role("button", name="Cancel").click()
            self.assertEqual(page.evaluate(SAVED_OBS_DATA), saved)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_plots_the_obs_data_items_and_prediction_plots_of_a_protocol_run(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            page.get_by_text("SN_somacell_modules.cellmlsoma_SN").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(FEATURES_SETTINGS)
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            page.evaluate(ADD_FEATURES_PROTOCOL)
            page.locator(".simulation-panel").get_by_test_id("sim-protocol-mode").click()
            page.wait_for_function(f"['done', 'error', 'blocked'].includes({RESULTS_STORE}.status)", timeout=120000)
            self.assertEqual(page.evaluate(f"{RESULTS_STORE}.status"), "done", page.evaluate(f"JSON.stringify([{RESULTS_STORE}.report, {RESULTS_STORE}.error])"))

            # A plot per variable the obs_data names, after the plotted ones (none here).
            panel = page.locator(".panel-figures")
            titles = panel.locator(".simulation-plot .plot-title")
            expect(titles).to_have_text(["soma_SN/i_M", "soma_SN/V", "instance_parameters/g_M"])
            voltage = panel.locator(".simulation-plot").filter(has=page.locator(".plot-title", has_text=re.compile(r"^soma_SN/V$")))
            # The data item's measurement dashed and the run's value solid, beside the prediction item's feature.
            obs = voltage.get_by_role("button", name="V_peak_obs (obs max)")
            calc = voltage.get_by_role("button", name="V_peak_obs (calc max)")
            expect(obs.locator(".plot-key-swatch")).to_have_class(re.compile(r"is-dashed"))
            expect(calc.locator(".plot-key-swatch")).not_to_have_class(re.compile(r"is-dashed"))
            self.assertEqual(float(obs.get_attribute("data-value")), -60)
            # The run's value is CA's, as V_peak_e1 computes the same.
            calc_value = float(calc.get_attribute("data-value"))
            gap = abs(calc_value - CA_FEATURES["V_peak_e1"]) / abs(CA_FEATURES["V_peak_e1"])
            print(f"\nV_peak_obs (calc max): PhLynx {calc_value!r}, CA {CA_FEATURES['V_peak_e1']!r}, relative difference {gap:.2e}")
            self.assertLess(gap, 1e-12)
            self.assertEqual(calc_value, page.evaluate(f"{RESULTS_STORE}.dataItemFeatures[0].value"))
            current = panel.locator(".simulation-plot").filter(has=page.locator(".plot-title", has_text="soma_SN/i_M"))
            peak = current.get_by_role("button", name="i_M peak at the step (calc max_in_range)")
            self.assertLess(abs(float(peak.get_attribute("data-value")) - CA_FEATURES["iM_step_peak_e1"]) / CA_FEATURES["iM_step_peak_e1"], FEATURES_CASE["tolerance"])
            # Clicking a line's name hides it, and again shows it.
            calc.click()
            expect(calc).to_have_attribute("aria-pressed", "false")
            calc.click()
            expect(calc).to_have_attribute("aria-pressed", "true")

            # The obs_data's prediction plots after them: i_M's peak against the g_M each experiment set.
            prediction_plots = panel.get_by_role("region", name="Prediction plots")
            expect(prediction_plots.locator(".feature-plot .plot-title")).to_have_text(["i_M peak at the step vs g_M", "V peak vs i_M peak"])
            expect(prediction_plots.locator(".feature-plot").first.locator(".plot-key")).to_contain_text("g_M doubled")

            # The second experiment has no data item; every experiment at once draws each in its own colour.
            picker = page.get_by_role("combobox", name="Experiment to show")
            picker.click()
            page.get_by_role("option", name="g_M tripled").click()
            expect(voltage.get_by_role("button", name="V_peak_obs (obs max)")).to_have_count(0)
            expect(voltage.get_by_role("button", name="V peak (calc max)")).to_have_count(1)
            picker.click()
            page.get_by_role("option", name="All experiments").click()
            expect(voltage.get_by_role("button", name="V_peak_obs (obs max)")).to_have_count(1)
            expect(voltage.get_by_role("button", name="V peak (calc max)")).to_have_count(2)
            expect(voltage.locator(".plot-key")).to_contain_text("g_M doubled")

            # The simulation page shows them too.
            page.get_by_role("link", name="Simulation", exact=True).click()
            sim_page = page.locator(".simulation-view")
            expect(sim_page.locator(".simulation-plot .plot-title")).to_have_text(["soma_SN/i_M", "soma_SN/V", "instance_parameters/g_M"])
            expect(sim_page.get_by_role("button", name="V_peak_obs (calc max)")).to_be_visible()
            expect(sim_page.get_by_role("region", name="Prediction plots").locator(".feature-plot")).to_have_count(2)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_toolbar_plays_with_f9_and_opens_the_solver_settings(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            source = node(page, "source")
            source.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()

            # The cog opens Simulation Settings on its solver and time settings.
            page.get_by_role("button", name="Simulation settings", exact=True).click()
            expect(page.get_by_role("heading", name="Solver")).to_be_in_viewport()
            page.get_by_role("dialog").get_by_role("button", name="Cancel").click()

            # Selection mode with nothing selected can't play; the whole model can, with F9 too.
            switch = page.get_by_role("switch", name="Simulate the whole model, not the selection")
            switch.uncheck()
            expect(page.get_by_role("button", name=re.compile(r"^Simulate the selection"))).to_be_disabled()
            switch.check()
            # Play is off until the simulator has loaded, and F9 with it: a key press, unlike a click, doesn't wait.
            play = page.get_by_role("button", name="Simulate the whole model")
            expect(play).to_be_enabled(timeout=APP_MOUNT_TIMEOUT)
            play.focus()
            page.keyboard.press("F9")
            expect(page.get_by_text("Simulated the whole model")).to_be_visible(timeout=120000)

            # The context menu simulates the instance on its own, switching to the selection. relay, as the open
            # sidebar covers source.
            node(page, "relay").click(button="right")
            page.get_by_text("Simulate Instance").click()
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            expect(switch).not_to_be_checked()
            # ----------- END ------------

            context.close()
            browser.close()

    def test_instance_editor_simulates_its_instance_and_applies_without_closing(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            source = node(page, "source")
            source.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            source.dblclick()
            page.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            dialog = page.get_by_role("dialog")

            # The Plot tab runs the whole model, with no floating viewer to open.
            expect(dialog.get_by_role("button", name="Float the results over the canvas")).to_have_count(0)
            dialog.get_by_role("button", name="Simulate the whole model").click()
            expect(dialog.get_by_text("Simulated the whole model")).to_be_visible(timeout=120000)
            plot_variable(page, "source/x", within=dialog)
            expect(dialog.locator(".simulation-plot .plot-title")).to_have_text("source/x")
            expect(dialog.get_by_role("tab", name="Plot (1)")).to_be_visible()

            # Clicking a variable in the math plots it in place of what the plot showed.
            dialog.locator(".plot-variable .remove-button").click()
            expect(dialog.get_by_role("tab", name="Plot (0)")).to_be_visible()
            click_math_variable(page, dialog, "x")
            expect(dialog.locator(".simulation-plot .plot-title")).to_have_text("source/x")

            # Apply saves and keeps the editor open, on the Plot tab.
            page.get_by_role("button", name="Apply").click()
            expect(page.get_by_text("CellML Updated")).to_be_visible()
            expect(dialog.get_by_role("button", name="Simulate the whole model")).to_be_visible()
            expect(dialog.get_by_role("tab", name="Plot (1)")).to_be_visible()
            # ----------- END ------------

            context.close()
            browser.close()

    def test_instance_editor_plots_a_variable_clicked_in_the_math_editor(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            relay = node(page, "relay")
            relay.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            relay.dblclick()
            dialog = page.get_by_role("dialog")
            dialog.get_by_role("tab", name="Math Editor").click()
            dialog.get_by_role("tab", name=re.compile(r"Plot \(")).click()
            dialog.get_by_role("button", name="Simulate the whole model").click()
            expect(dialog.get_by_text("Simulated the whole model")).to_be_visible(timeout=120000)

            # A typeset name in the Math Editor plots the variable it names.
            name = dialog.locator("[data-name]").filter(has_text=re.compile(r"^uin")).first
            name.scroll_into_view_if_needed()
            name.click()
            expect(dialog.locator(".simulation-plot .plot-title")).to_have_text("relay/u_in")
            expect(dialog.get_by_role("tab", name="Plot (1)")).to_be_visible()

            # A single-letter name isn't wrapped as a name, but its letter still plots it.
            letter = dialog.locator("[data-atom]:not([data-name] [data-atom])").filter(has_text=re.compile(r"^y$")).first
            letter.scroll_into_view_if_needed()
            letter.click()
            expect(dialog.locator(".simulation-plot .plot-title")).to_have_text("relay/y")

            # A name in a denominator is clicked too, and a constant plots like any variable.
            denominator = dialog.locator('[data-row$=".den"] [data-name]').filter(has_text=re.compile(r"^Trelax")).first
            denominator.scroll_into_view_if_needed()
            denominator.click()
            expect(dialog.locator(".simulation-plot .plot-title")).to_have_text("relay/T_relax")
            # ----------- END ------------

            context.close()
            browser.close()

    def test_floating_viewer_stays_over_the_canvas_with_the_sidebar_closed(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            node(page, "source").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_whole_model(page)
            expect(page.get_by_text("Simulated the whole model")).to_be_visible(timeout=120000)
            plot_variable(page, "source/x")

            add_slider(page, "source/k")

            # Floating the results closes the sidebar, leaving the viewer up, and its sliders still rerun the model.
            page.get_by_role("button", name="Float the results over the canvas").click()
            viewer = page.locator(".simulation-floating-viewer")
            expect(viewer.locator(".simulation-plot .plot-title")).to_have_text("source/x")
            expect(page.locator(".context-panel.resizable-library-panel--collapsed")).to_have_count(1)
            expect(viewer).to_be_visible()
            # Showing the sliders makes the window taller rather than squeezing the plot.
            height_before = viewer.bounding_box()["height"]
            viewer.get_by_role("button", name="Show the sliders").click()
            expect(viewer.locator(".slider-row")).to_have_count(1)
            self.assertGreater(viewer.bounding_box()["height"], height_before + 40)
            # The viewer tracks the shown run, whose line stays on the plot as the slider moves.
            viewer.get_by_role("button", name=re.compile(r"^Track this run \(0 of 5")).click()
            expect(viewer.get_by_role("button", name=re.compile(r"^Track this run \(1 of 5"))).to_be_visible()
            page.evaluate(f"window.__shownResults = {RESULTS_STORE}.results")
            viewer.locator(".p-slider-handle").first.focus()
            for _ in range(10):
                page.keyboard.press("ArrowRight")
            page.wait_for_function(
                f"{RESULTS_STORE}.results !== window.__shownResults && {RESULTS_STORE}.status === 'done'", timeout=60000
            )
            expect(viewer.locator(".simulation-plot .plot-key[aria-label=Runs] li")).to_have_text(["Live", "#1"])

            # Back to the tab closes the window and opens the sidebar on the Simulation tab.
            viewer.get_by_role("button", name="Back to the Simulation tab").click()
            expect(viewer).to_have_count(0)
            expect(page.get_by_role("button", name="Simulate the whole model")).to_be_visible()
            # ----------- END ------------

            context.close()
            browser.close()

    def test_selection_mode_runs_once_the_selection_is_chosen(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            # sink and relay, which the open sidebar leaves in view.
            sink = node(page, "sink")
            relay = node(page, "relay")
            sink.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(f"{SIMULATOR_READY}", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()

            # Flipping to the whole model runs it straight away.
            switch = page.get_by_role("switch", name="Simulate the whole model, not the selection")
            switch.uncheck()
            switch.check()
            expect(page.get_by_text("Simulated the whole model")).to_be_visible(timeout=120000)

            # In Selection mode, picking an instance runs it once chosen.
            switch.uncheck()
            sink.click()
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)

            # A Cmd/Ctrl-click adds to the selection, which runs it.
            relay.click(modifiers=["ControlOrMeta"])
            expect(page.get_by_text("Simulated 2 instances on their own")).to_be_visible(timeout=120000)

            # A selection box dragged with Shift runs only once the pointer comes up.
            box = relay.bounding_box()
            page.evaluate(f"window.__shownResults = {RESULTS_STORE}.results")
            page.keyboard.down("Shift")
            page.mouse.move(box["x"] - 20, box["y"] - 20)
            page.mouse.down()
            page.mouse.move(box["x"] + box["width"] + 20, box["y"] + box["height"] + 20, steps=8)
            page.wait_for_timeout(600)
            self.assertTrue(page.evaluate(f"{RESULTS_STORE}.results === window.__shownResults && {RESULTS_STORE}.status !== 'running'"))
            page.mouse.up()
            page.keyboard.up("Shift")
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_inspection_modules_plot_only_when_the_settings_say(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            use_default_timeouts(context)
            page = context.new_page()
            page.goto(workspace_url(), wait_until="commit")

            # ---------- START -----------
            node(page, "source").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.evaluate(
                "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('inspectionModules')"
                ".addModule({ name: 'Relay level', units: 'mM',"
                " variables: [{ key: 'dndnode_1::y', nodeId: 'dndnode_1', nodeName: 'relay', variableName: 'y', units: 'mM' }] })"
            )
            page.locator(".context-panel .library-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_whole_model(page)

            expect(page.get_by_text("Simulated the whole model")).to_be_visible(timeout=120000)
            # Not plotted by default.
            expect(page.locator(".simulation-plot")).to_have_count(0)

            # They can be put on a plot from the search, like any variable.
            plot_variable(page, "inspection_modules/Relay level")
            expect(page.locator(".simulation-plot .plot-title")).to_have_text("inspection_modules/Relay level")
            page.get_by_role("button", name="Stop plotting Relay level").click()
            expect(page.locator(".simulation-plot")).to_have_count(0)

            # Turned on in Settings, they plot as a plot of their own.
            page.get_by_role("button", name="Settings", exact=True).click()
            settings = page.get_by_role("dialog", name="Settings")
            settings.get_by_role("tab", name="Simulation", exact=True).click()
            page.get_by_role("switch", name="Plot inspection modules").check()
            settings.get_by_role("button", name="Done").click()
            expect(page.locator(".simulation-plot .plot-title")).to_have_text("Relay level")
            # ----------- END ------------

            context.close()
            browser.close()


if __name__ == '__main__':
    unittest.main()
