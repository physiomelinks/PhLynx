import csv
import io
import os
import re
import subprocess
import tempfile
import unittest
import zipfile

from playwright.sync_api import expect, sync_playwright

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH


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
FINAL_SOMA_V = (
    f"(() => {{ const store = {RESULTS_STORE}; const name = store.mapping.get('dndnode_0::V');"
    " return store.results.variables.get(name).values.at(-1) })()"
)

# Gives the workspace an obs_data file as CUFLynx sends one, shaped as SN_simple's first two experiments are: a warm-up,
# then two sub-experiments, the second with the M current's conductance doubled.
ADD_PROTOCOL = """(() => {
  const protocol = {
    pre_times: [0.05, 0.05],
    sim_times: [[0.1, 0.1], [0.1, 0.1]],
    params_to_change: { 'soma_SN/I_in': [[0, 0], [0, 0]], 'soma_SN/g_M': [[0.00389, 0.00389], [0.00778, 0.00778]] },
    experiment_labels: ['SHR', 'SHR M-activation'],
  }
  const payload = new TextEncoder().encode(JSON.stringify({ protocol_info: protocol, data_items: [] })).buffer
  document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('omex')
    .setArchive({ extras: [{ location: 'SN_simple_obs_data.json', format: 'application/json', payload }] })
})()"""
# The values of soma_SN's g_M the shown experiment ran with, and how many experiments ran.
SHOWN_G_M = (
    f"(() => {{ const store = {RESULTS_STORE}; const name = [...store.mapping].find(([key]) => key.endsWith('::g_M'))[1];"
    " return { experiments: store.protocolResults.experiments.length, values: [...new Set(store.results.variables.get(name).values)] } })()"
)

# A ramp of soma_SN's input current, which the model computes as a driver.
ADD_RAMP_PROTOCOL = ADD_PROTOCOL.replace(
    """    pre_times: [0.05, 0.05],
    sim_times: [[0.1, 0.1], [0.1, 0.1]],
    params_to_change: { 'soma_SN/I_in': [[0, 0], [0, 0]], 'soma_SN/g_M': [[0.00389, 0.00389], [0.00778, 0.00778]] },
    experiment_labels: ['SHR', 'SHR M-activation'],""",
    """    pre_times: [0],
    sim_times: [[0.2]],
    params_to_change: { 'soma_SN/I_in': [['up']] },
    protocol_shapes: { up: { type: 'ramp', from: 0, to: 0.02 } },""",
)
# The input current as the ramp ran it: at the start, halfway and the end.
SHOWN_I_IN = (
    f"(() => {{ const store = {RESULTS_STORE}; const values = store.results.variables.get(store.protocolInputs.get('soma_SN/I_in').name).values;"
    " return [values[0], values[10], values.at(-1)] })()"
)

# A Python with libcuflynx from circulatory_autogen #536, to run an exported protocol's script; skipped without one.
CUFLYNX_PYTHON = os.environ.get("PHLYNX_CUFLYNX_PYTHON")
# Downloads go to the browser's save, not the File System Access picker, which Playwright can't answer.
USE_DOWNLOADS = "delete window.showSaveFilePicker"
# The outputs the protocol editor writes for ADD_PROTOCOL's experiments: the soma's voltage in the second sub-experiment
# of each, its trace and its mean.
OUTPUTS = [
    {
        "data_item_name": f"{name}_{label}",
        "operands": ["soma_SN/V"],
        "unit": "milliV",
        **({"operation": "mean"} if name == "V_mean" else {}),
        "experiment_idx": e,
        "subexperiment_idx": 1,
        "item_name_for_plotting": name,
    }
    for name in ("V", "V_mean")
    for e, label in enumerate(["SHR", "SHR_M_activation"])
]
# ADD_PROTOCOL's protocol, its first experiment's first sub-experiment shortened to 0.08 s in the editor.
SAVED_PROTOCOL_INFO = {
    "pre_times": [0.05, 0.05],
    "sim_times": [[0.08, 0.1], [0.1, 0.1]],
    "params_to_change": {"soma_SN/I_in": [[0, 0], [0, 0]], "soma_SN/g_M": [[0.00389, 0.00389], [0.00778, 0.00778]]},
    "experiment_labels": ["SHR", "SHR M-activation"],
}
# The soma's mean voltage in each experiment's second sub-experiment, as PhLynx ran it.
IN_APP_V_MEANS = (
    f"(() => {{ const store = {RESULTS_STORE}; const name = store.mapping.get('dndnode_0::V');"
    " return store.protocolResults.experiments.map(({ variables, subs }) => { const values = variables.get(name).values.slice(subs[1].startIndex, subs[1].endIndex + 1);"
    " return values.reduce((sum, value) => sum + value, 0) / values.length }) })()"
)
# The workspace's obs_data, as saved.
SAVED_OBS_DATA = (
    "(() => { const extras = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('omex').preservedExtras;"
    " return JSON.parse(new TextDecoder().decode(extras.find(({ location }) => location === 'SN_simple_obs_data.json').payload)) })()"
)
# The workspace's obs_data as saved, its bytes as a list.
SAVED_OBS_DATA_BYTES = (
    "(() => { const extras = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('omex').preservedExtras;"
    " const { payload } = extras.find(({ location }) => location === 'SN_simple_obs_data.json');"
    " return [...(typeof payload === 'string' ? new TextEncoder().encode(payload) : new Uint8Array(payload))] })()"
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
    scope.get_by_role("combobox", name=box_name).fill(path.replace("/", " "))
    option = page.locator(".path-option").filter(has=page.locator(".path-text", has_text=re.compile(rf"^{re.escape(path)}$")))
    option.first.click()


def plot_variable(page, path, within=None):
    """Plots a variable by its instance/variable path."""
    pick_path(page, "Add a variable to plot", path, within)


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
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            soma = page.get_by_text("SN_somacell_modules.cellmlsoma_SN")
            soma.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            soma.click(button="right")
            expect(page.get_by_text("Simulate Instance")).to_be_visible()
            page.keyboard.press("Escape")
            soma.click()

            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_selection(page)

            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            plot_variable(page, "soma_SN/V")
            expect(page.locator(".simulation-plot canvas")).to_have_count(1)
            expect(page.locator(".simulation-plot .plot-title")).to_have_text("soma_SN/V")
            expect(page.locator(".instance-node--simulated")).to_have_count(1)

            # A variable in another unit gets its own chart, which the tab scrolls to.
            plot_variable(page, "soma_SN/m")
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
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            soma = page.get_by_text("SN_somacell_modules.cellmlsoma_SN")
            soma.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            soma.click()
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_selection(page)
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            before = page.evaluate(FINAL_SOMA_V)

            add_slider(page, "soma_SN/g_Na")
            page.get_by_role("slider", name="g_Na value").focus()
            for _ in range(300):
                page.keyboard.press("ArrowRight")
            expect(page.locator(".slider-value--changed")).to_have_text("2.438 microS")
            # The slider asks for a run, which gives a different end value.
            page.wait_for_function(
                f"{RESULTS_STORE}.status === 'done' && {FINAL_SOMA_V} !== {before!r}",
                timeout=120000,
            )

            page.get_by_role("button", name="More for g_Na").click()
            page.get_by_role("menuitem", name="Apply this value to the model").click()
            expect(page.locator(".slider-value--changed")).to_have_count(0)
            expect(page.locator(".slider-value")).to_have_text("2.438 microS")
            expect(page.get_by_text("The model or settings have changed since this run.")).to_have_count(0)
            # Its range opens from its menu, and changes as typed.
            page.get_by_role("button", name="More for g_Na").click()
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


    def test_plots_variables_of_two_instances_on_one_chart(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            soma = page.get_by_text("SN_somacell_modules.cellmlsoma_SN")
            axon = page.get_by_text("SN_axoncell_modules.cellmlaxon_SN")
            soma.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            soma.click()
            axon.click(modifiers=["ControlOrMeta"])
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_selection(page)
            expect(page.get_by_text("Simulated 2 instances on their own")).to_be_visible(timeout=120000)

            for instance in ("soma_SN", "axon_SN"):
                plot_variable(page, f"{instance}/V")

            # Same plot and unit, so both lines share a chart, named by instance.
            expect(page.locator(".simulation-plot")).to_have_count(1)
            expect(page.locator(".simulation-plot .plot-title")).to_have_text("soma_SN/V, axon_SN/V")

            # Clicking a line's name hides it, leaving it out of the hover readout, and clicking it again shows it.
            chart = page.locator(".simulation-plot")
            axon_toggle = chart.get_by_role("button", name="axon_SN/V", exact=True)
            box = chart.locator(".u-over").bounding_box()
            hover = (box["x"] + box["width"] * 0.6, box["y"] + box["height"] / 2)
            axon_toggle.click()
            expect(axon_toggle).to_have_attribute("aria-pressed", "false")
            page.mouse.move(*hover)
            expect(chart.locator(".plot-readout-row")).to_have_count(1)
            expect(chart.locator(".plot-readout-label")).to_have_text("soma_SN/V")
            axon_toggle.click()
            expect(axon_toggle).to_have_attribute("aria-pressed", "true")
            page.mouse.move(*hover)
            expect(chart.locator(".plot-readout-row")).to_have_count(2)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_results_dialog_syncs_cursors_and_downloads(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            soma = page.get_by_text("SN_somacell_modules.cellmlsoma_SN")
            soma.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            soma.click()
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_selection(page)
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            plot_variable(page, "soma_SN/V")

            page.get_by_role("button", name="Open the results in a larger view").click()
            dialog = page.get_by_role("dialog", name="Simulation results")
            charts = dialog.locator(".simulation-plot")
            expect(charts).to_have_count(1)
            # Variables can be plotted from beside the charts too.
            plot_variable(page, "soma_SN/m", within=dialog)
            expect(charts).to_have_count(2)

            # So can sliders be added and moved, rerunning the simulation.
            add_slider(page, "soma_SN/g_Na", within=dialog)
            page.evaluate(f"window.__shownResults = {RESULTS_STORE}.results")
            dialog.locator(".p-slider-handle").first.focus()
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
                dialog.get_by_role("button", name="Download the results as CSV").click()
            with open(download.value.path()) as f:
                lines = f.read().splitlines()
            self.assertEqual(lines[0], "time (second),soma_SN/V (milliV),soma_SN/m (dimensionless)")
            self.assertEqual(len(lines), 1 + 101)
            self.assertEqual(lines[1].split(",")[0], "0")

            with page.expect_download() as download:
                dialog.get_by_role("button", name="Download the charts as a PNG image").click()
            with open(download.value.path(), "rb") as f:
                self.assertEqual(f.read(8), b"\x89PNG\r\n\x1a\n")


            dialog.get_by_role("button", name="Maximise the results").click()
            expect(dialog.get_by_role("button", name="Restore the results to their size")).to_be_visible()
            # ----------- END ------------

            context.close()
            browser.close()

    def test_runs_a_protocol_from_cuflynx_and_shows_each_experiment(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            page.get_by_text("SN_somacell_modules.cellmlsoma_SN").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            protocol_button = page.get_by_role("button", name="Run the protocol's experiments")
            expect(protocol_button).to_have_count(0)
            # A slider tried out before the protocol turns on.
            add_slider(page, "soma_SN/g_Na")
            slider = page.get_by_role("slider", name="g_Na value")
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
            self.assertEqual(page.evaluate(SHOWN_G_M), {"experiments": 2, "values": [0.00389]})
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
            expect(titles.last).to_have_text(re.compile(r"soma_SN/(I_in|g_M)"))

            # The second experiment ran with the M current raised.
            page.get_by_role("combobox", name="Experiment to show").click()
            page.get_by_role("option", name="SHR M-activation").click()
            self.assertEqual(page.evaluate(SHOWN_G_M), {"experiments": 2, "values": [0.00778]})

            # The larger view switches between them too, once the sidebar's list has gone.
            expect(page.get_by_role("listbox")).to_have_count(0)
            page.get_by_role("button", name="Open the results in a larger view").click()
            dialog = page.get_by_role("dialog", name="Simulation results")
            dialog.get_by_role("combobox", name="Experiment to show").click()
            page.get_by_role("option", name="SHR", exact=True).click()
            self.assertEqual(page.evaluate(SHOWN_G_M), {"experiments": 2, "values": [0.00389]})
            # It switches between the time course and the protocol too, running each at once.
            run_mode = dialog.get_by_role("group", name="What play runs")
            run_mode.get_by_role("button", name="Time course").click()
            expect(protocol_button).to_have_attribute("aria-pressed", "false")
            page.wait_for_function(f"{RESULTS_STORE}.status === 'done' && !{RESULTS_STORE}.protocolResults", timeout=120000)
            expect(dialog.get_by_role("combobox", name="Experiment to show")).to_have_count(0)
            run_mode.get_by_role("button", name="Protocol").click()
            expect(protocol_button).to_have_attribute("aria-pressed", "true")
            page.wait_for_function(f"{RESULTS_STORE}.status === 'done' && !!{RESULTS_STORE}.protocolResults", timeout=120000)
            expect(dialog.get_by_role("combobox", name="Experiment to show")).to_be_visible()
            dialog.get_by_role("button", name="Close", exact=True).click()
            expect(dialog).to_have_count(0)

            # Back to the time course, the slider is on again with the value it was left at.
            protocol_button.click()
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
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            page.get_by_text("SN_somacell_modules.cellmlsoma_SN").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()

            page.evaluate(ADD_RAMP_PROTOCOL)
            page.get_by_role("button", name="Run the protocol's experiments").click()
            page.wait_for_function(f"['done', 'error', 'blocked'].includes({RESULTS_STORE}.status)", timeout=120000)
            self.assertEqual(page.evaluate(f"{RESULTS_STORE}.status"), "done", page.evaluate(f"JSON.stringify([{RESULTS_STORE}.report, {RESULTS_STORE}.error])"))
            start, middle, end = page.evaluate(SHOWN_I_IN)
            self.assertAlmostEqual(start, 0, places=9)
            self.assertAlmostEqual(middle, 0.01, places=9)
            self.assertAlmostEqual(end, 0.02, places=9)
            page.get_by_role("button", name="Show the values the protocol set").first.click()
            expect(page.locator(".simulation-plot .plot-title").last).to_have_text("soma_SN/I_in")
            # ----------- END ------------

            context.close()
            browser.close()

    def test_writes_a_protocol_and_runs_it(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            page.get_by_text("SN_somacell_modules.cellmlsoma_SN").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()

            # A protocol of two sub-experiments, the second doubling the M current's conductance, then a copy of it.
            page.get_by_role("button", name="Create a protocol", exact=True).click()
            dialog = page.get_by_role("dialog", name="Protocol")
            dialog.get_by_role("button", name="Create a protocol").click()
            dialog.get_by_role("button", name="Add parameter to set").click()
            pick_path(page, "Add a parameter for the protocol to set", "soma_SN/g_M", within=dialog)
            dialog.get_by_role("button", name=re.compile(r"^Edit sub-experiment 1 length")).click()
            dialog.get_by_label("Sub-experiment 1 length", exact=True).fill("0.1")
            dialog.get_by_label("Sub-experiment 1 length", exact=True).press("Enter")
            dialog.get_by_role("button", name="Add a sub-experiment").click()
            dialog.get_by_role("button", name="Change how soma_SN/g_M varies in sub-experiment 2").click()
            page.locator(".cell-editor").get_by_label("Value").fill("0.00778")
            page.locator(".cell-editor").get_by_label("Value").press("Enter")
            expect(dialog.get_by_role("button", name="How soma_SN/g_M varies in sub-experiment 2: Number")).to_contain_text("0.00778")
            dialog.get_by_role("button", name="More for Experiment 1").click()
            page.get_by_role("menuitem", name="Duplicate").click()
            expect(dialog.get_by_role("button", name="Experiment 2", exact=True)).to_have_attribute("aria-pressed", "true")
            dialog.get_by_role("button", name="Save").click()
            expect(dialog).to_be_hidden()

            # Saved as the workspace's obs_data, the protocol now runs.
            page.get_by_role("button", name="Run the protocol's experiments").click()
            page.wait_for_function(f"['done', 'error', 'blocked'].includes({RESULTS_STORE}.status)", timeout=120000)
            self.assertEqual(page.evaluate(f"{RESULTS_STORE}.status"), "done", page.evaluate(f"JSON.stringify([{RESULTS_STORE}.report, {RESULTS_STORE}.error])"))
            expect(page.get_by_text("Ran 2 protocol experiments on the whole model")).to_be_visible()
            self.assertEqual(page.evaluate(SHOWN_G_M), {"experiments": 2, "values": [0.00389, 0.00778]})
            # ----------- END ------------

            context.close()
            browser.close()

    def test_sets_a_pulse_and_a_trace_and_runs_them(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            page.get_by_text("SN_somacell_modules.cellmlsoma_SN").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()

            page.get_by_role("button", name="Create a protocol", exact=True).click()
            dialog = page.get_by_role("dialog", name="Protocol")
            dialog.get_by_role("button", name="Create a protocol").click()
            dialog.get_by_role("button", name=re.compile(r"^Edit sub-experiment 1 length")).click()
            dialog.get_by_label("Sub-experiment 1 length", exact=True).fill("0.1")
            dialog.get_by_label("Sub-experiment 1 length", exact=True).press("Enter")
            dialog.get_by_role("button", name="Add parameter to set").click()
            pick_path(page, "Add a parameter for the protocol to set", "soma_SN/g_M", within=dialog)
            dialog.get_by_role("button", name="Add parameter to set").click()
            pick_path(page, "Add a parameter for the protocol to set", "soma_SN/I_in", within=dialog)

            # g_M doubles from 0.02 to 0.06 into the sub-experiment.
            # Its segment's chip says what it is, and picks another kind.
            chip = dialog.get_by_role("button", name="How soma_SN/g_M varies in sub-experiment 1: Number")
            chip.click()
            page.get_by_role("menuitem", name="Pulse").click()
            cell = page.locator(".cell-editor")
            expect(cell.locator(".p-togglebutton-checked")).to_have_text("Pulse")
            expect(cell.get_by_label("Pulse starts", exact=True)).to_be_visible()
            for label, value in (("Baseline value", "0.00389"), ("Pulse value", "0.00778"), ("Pulse starts", "0.02"), ("Pulse ends", "0.06")):
                cell.get_by_label(label, exact=True).fill(value)
                cell.get_by_label(label, exact=True).press("Tab")
            cell.get_by_role("button", name="Apply").click()
            expect(dialog.get_by_role("button", name="How soma_SN/g_M varies in sub-experiment 1: Pulse")).to_be_visible()

            # The input current follows a recorded trace.
            dialog.get_by_role("button", name="Change how soma_SN/I_in varies in sub-experiment 1").click()
            cell.get_by_text("Trace", exact=True).click()
            cell.locator("input[type=file]").set_input_files(os.path.join(RESOURCE_PATH, "protocols", "input_trace.csv"))
            expect(cell.get_by_text("3 points from 0 to 0.1")).to_be_visible()
            cell.get_by_role("button", name="Apply").click()
            expect(dialog.get_by_role("button", name="How soma_SN/I_in varies in sub-experiment 1: Trace")).to_be_visible()
            dialog.get_by_role("button", name="Save").click()

            page.get_by_role("button", name="Run the protocol's experiments").click()
            page.wait_for_function(f"['done', 'error', 'blocked'].includes({RESULTS_STORE}.status)", timeout=120000)
            self.assertEqual(page.evaluate(f"{RESULTS_STORE}.status"), "done", page.evaluate(f"JSON.stringify([{RESULTS_STORE}.report, {RESULTS_STORE}.error])"))
            inputs = page.evaluate(
                f"(() => {{ const store = {RESULTS_STORE}; const read = (name) => [...store.results.variables.get(store.protocolInputs.get(name).name).values];"
                " return { g: read('soma_SN/g_M'), i: read('soma_SN/I_in') } })()"
            )
            self.assertEqual(inputs["g"][1], 0.00389)
            self.assertEqual(inputs["g"][4], 0.00778)
            self.assertEqual(inputs["g"][7], 0.00389)
            self.assertAlmostEqual(inputs["i"][5], 0.01, places=9)
            self.assertAlmostEqual(inputs["i"][10], 0, places=9)
            # ----------- END ------------

            context.close()
            browser.close()

    def test_exports_a_protocol_with_a_script_that_records_its_outputs(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000}, accept_downloads=True)
            context.add_init_script(OPT_IN_TO_ISOLATION)
            context.add_init_script(USE_DOWNLOADS)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            page.get_by_text("SN_somacell_modules.cellmlsoma_SN").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()

            page.evaluate(ADD_PROTOCOL)
            page.get_by_role("button", name="Edit the protocol", exact=True).click()
            dialog = page.get_by_role("dialog", name="Protocol")
            # The input current, at its model value throughout, is tucked away until asked for.
            show = dialog.get_by_role("button", name="Show 1 parameter at its model value")
            expect(dialog.get_by_text("1 parameter at its model value", exact=True)).to_be_visible()
            expect(dialog.get_by_role("button", name="Stop setting soma_SN/I_in")).to_have_count(0)
            expect(dialog.get_by_role("button", name="Stop setting soma_SN/g_M")).to_be_visible()
            expect(show).to_have_attribute("aria-expanded", "false")
            show.click()
            hide = dialog.get_by_role("button", name="Hide 1 parameter at its model value")
            expect(hide).to_have_attribute("aria-expanded", "true")
            expect(dialog.get_by_role("button", name="Stop setting soma_SN/I_in")).to_be_visible()
            hide.click()
            expect(dialog.get_by_role("button", name="Stop setting soma_SN/I_in")).to_have_count(0)
            dialog.get_by_role("button", name=re.compile(r"^Edit sub-experiment 1 length")).click()
            dialog.get_by_label("Sub-experiment 1 length", exact=True).fill("0.08")
            dialog.get_by_label("Sub-experiment 1 length", exact=True).press("Enter")

            # The outputs, added in the editor: the voltage's trace and its mean over the second sub-experiment of both.
            outputs = dialog.get_by_role("region", name="Outputs")
            for name, kind in (("V", "Trace"), ("V_mean", "Feature")):
                outputs.get_by_role("button", name="Add output").click()
                form = outputs.get_by_role("form", name="Add an output")
                form.get_by_role("combobox", name="Search for a variable to record").fill("soma_SN V")
                page.locator(".path-option").filter(has=page.locator(".path-text", has_text=re.compile(r"^soma_SN/V$"))).first.click()
                form.get_by_role("group", name="What it records").get_by_text(kind, exact=True).click()
                if kind == "Feature":
                    form.get_by_role("combobox", name="Operation").click()
                    page.get_by_role("option", name="Mean", exact=True).click()
                form.get_by_label("Output name").fill(name)
                form.get_by_role("combobox", name="Sub-experiment").click()
                page.get_by_role("option", name="Sub-experiment 2").click()
                expect(form.get_by_role("checkbox", name="SHR", exact=True)).to_be_checked()
                expect(form.get_by_role("checkbox", name="SHR M-activation")).to_be_checked()
                form.get_by_role("button", name="Add output").click()
                expect(form).to_have_count(0)
            expect(outputs.locator(".output-name")).to_have_text(["V", "V_mean"])
            # An undo takes the last back, and a redo brings it again.
            dialog.get_by_role("button", name="Undo").click()
            expect(outputs.locator(".output-name")).to_have_text(["V"])
            dialog.get_by_role("button", name="Redo").click()
            expect(outputs.locator(".output-name")).to_have_text(["V", "V_mean"])
            dialog.get_by_role("button", name="Save").click()
            expect(dialog).to_be_hidden()
            saved = page.evaluate(SAVED_OBS_DATA)
            # The protocol as it was but the length changed, the input current at its model value included.
            self.assertEqual(saved["protocol_info"], SAVED_PROTOCOL_INFO)
            self.assertEqual(saved["prediction_items"], OUTPUTS)
            saved_bytes = bytes(page.evaluate(SAVED_OBS_DATA_BYTES))

            page.get_by_role("button", name="Run the protocol's experiments").click()
            page.wait_for_function(f"['done', 'error', 'blocked'].includes({RESULTS_STORE}.status)", timeout=120000)
            self.assertEqual(page.evaluate(f"{RESULTS_STORE}.status"), "done", page.evaluate(f"JSON.stringify([{RESULTS_STORE}.report, {RESULTS_STORE}.error])"))
            in_app_means = page.evaluate(IN_APP_V_MEANS)
            page.get_by_role("button", name=re.compile(r"^Plots \(")).click()
            plot_variable(page, "soma_SN/V")
            page.get_by_role("button", name="Open the results in a larger view").click()
            results = page.get_by_role("dialog", name="Simulation results")
            results.get_by_role("button", name=re.compile(r"^Export the protocol")).click()

            # The mean voltage, plotted against the M current's conductance in the second sub-experiment.
            export = page.get_by_role("dialog", name="Export the protocol")
            export.get_by_role("button", name="Add feature plot").click()
            export.get_by_label("Feature plot 1 title").fill("Mean voltage against g_M")
            expect(export.get_by_role("combobox", name="Feature plot 1 y")).to_contain_text("V_mean")
            export.get_by_role("group", name="Feature plot 1 x").get_by_text("Protocol input", exact=True).click()
            export.get_by_role("combobox", name="Feature plot 1 x input").click()
            page.get_by_role("option", name="soma_SN/g_M").click()
            export.get_by_role("combobox", name="Feature plot 1 x sub-experiment").click()
            page.get_by_role("option", name="Sub-experiment 2").click()
            with page.expect_download() as download:
                export.get_by_role("button", name="Export ZIP").click()
            expect(export).to_be_hidden()

            # The zip holds the script, the model it runs and the workspace's obs_data, byte for byte.
            with open(download.value.path(), "rb") as f:
                bundle = zipfile.ZipFile(io.BytesIO(f.read()))
            names = set(bundle.namelist())
            self.assertTrue({"run_protocol.py", "model.cellml", "SN_simple_obs_data.json", "requirements.txt", "README.md", "manifest.xml"} <= names, names)
            self.assertEqual(bundle.read("SN_simple_obs_data.json"), saved_bytes)
            # The plain model: the drivers and clock are only in the SED-ML's.
            model = bundle.read("model.cellml").decode()
            self.assertNotIn("protocol_drivers", model)
            self.assertNotIn("protocol_clock", model)
            script = bundle.read("run_protocol.py").decode()
            header = {}
            exec(script[: script.index("# ---- End of what PhLynx wrote")], header)
            self.assertEqual(header["MODEL"], "model.cellml")
            self.assertEqual(header["OBS_DATA"], "SN_simple_obs_data.json")
            self.assertEqual(header["DT"], 0.01)
            self.assertEqual(
                header["FEATURE_PLOTS"],
                [{"title": "Mean voltage against g_M", "x": {"input": "soma_SN/g_M", "subexperiment_idx": 1}, "y": "V_mean", "series": None}],
            )
            # ----------- END ------------

            context.close()
            browser.close()

        # The script runs it with libcuflynx, recording the mean of each experiment and plotting it.
        if not CUFLYNX_PYTHON:
            self.skipTest("PHLYNX_CUFLYNX_PYTHON not set, so run_protocol.py isn't run")
        with tempfile.TemporaryDirectory() as folder:
            bundle.extractall(folder)
            run = subprocess.run([CUFLYNX_PYTHON, "run_protocol.py"], cwd=folder, capture_output=True, text=True)
            self.assertEqual(run.returncode, 0, run.stderr)
            with open(os.path.join(folder, "results", "features.csv")) as f:
                features = list(csv.DictReader(f))
            self.assertEqual([row["item"] for row in features], ["V_mean_SHR", "V_mean_SHR_M_activation"])
            self.assertEqual([(row["feature"], row["experiment"], row["subexperiment"], row["operation"]) for row in features], [("V_mean", "0", "1", "mean"), ("V_mean", "1", "1", "mean")])
            # The means PhLynx's own run gives, to the solvers' tolerances.
            for row, mean in zip(features, in_app_means):
                self.assertAlmostEqual(float(row["value"]), mean, delta=1e-3 * abs(mean), msg=row["item"])
            # Each trace, plotted as CA names it when its item has no trace_name_for_plotting: by its variable.
            with open(os.path.join(folder, "results", "traces.csv")) as f:
                traces = {(row["experiment"], row["subexperiment"], row["group"], row["variable"]) for row in csv.DictReader(f)}
            self.assertEqual(traces, {("0", "1", "soma_SN/V", "soma_SN/V"), ("1", "1", "soma_SN/V", "soma_SN/V")})
            for figure in ("traces.png", "features.png", "feature_plot_1.png"):
                self.assertTrue(os.path.exists(os.path.join(folder, "results", figure)), figure)

    def test_toolbar_plays_with_f9_and_opens_the_solver_settings(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            soma = page.get_by_text("SN_somacell_modules.cellmlsoma_SN")
            soma.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
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
            page.get_by_role("button", name="Simulate the whole model").focus()
            page.keyboard.press("F9")
            expect(page.get_by_text("Simulated the whole model")).to_be_visible(timeout=120000)

            # The context menu simulates the instance on its own, switching to the selection.
            soma.click(button="right")
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
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            soma = page.get_by_text("SN_somacell_modules.cellmlsoma_SN")
            soma.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            soma.dblclick()
            page.get_by_role("tab", name=re.compile(r"Plot \(")).click()

            page.get_by_role("button", name="Simulate this instance").click()
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            plot_variable(page, "soma_SN/V")
            expect(page.locator(".simulation-plot .plot-title")).to_have_text("soma_SN/V")

            # Apply saves and keeps the editor open, on the Plot tab.
            page.get_by_role("button", name="Apply").click()
            expect(page.get_by_text("CellML Updated")).to_be_visible()
            expect(page.get_by_role("button", name="Simulate this instance")).to_be_visible()
            # ----------- END ------------

            context.close()
            browser.close()

    def test_floating_viewer_stays_over_the_canvas_with_the_sidebar_closed(self):
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=HEADLESS_MODE)

            context = browser.new_context(viewport={"width": 1600, "height": 1000})
            context.add_init_script(OPT_IN_TO_ISOLATION)
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            page.get_by_text("SN_somacell_modules.cellmlsoma_SN").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_whole_model(page)
            expect(page.get_by_text("Simulated the whole model")).to_be_visible(timeout=120000)
            plot_variable(page, "soma_SN/V")

            add_slider(page, "soma_SN/g_Na")

            page.get_by_role("button", name="Float the results over the canvas").click()
            viewer = page.locator(".simulation-floating-viewer")
            expect(viewer.locator(".simulation-plot .plot-title")).to_have_text("soma_SN/V")

            # Closing the sidebar leaves the viewer up, and its sliders still rerun the model.
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            expect(viewer).to_be_visible()
            # Showing the sliders makes the window taller rather than squeezing the plot.
            height_before = viewer.bounding_box()["height"]
            viewer.get_by_role("button", name="Show the sliders").click()
            expect(viewer.locator(".slider-row")).to_have_count(1)
            self.assertGreater(viewer.bounding_box()["height"], height_before + 40)
            page.evaluate(f"window.__shownResults = {RESULTS_STORE}.results")
            viewer.locator(".p-slider-handle").first.focus()
            for _ in range(10):
                page.keyboard.press("ArrowRight")
            page.wait_for_function(
                f"{RESULTS_STORE}.results !== window.__shownResults && {RESULTS_STORE}.status === 'done'", timeout=60000
            )

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
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            soma = page.get_by_text("SN_somacell_modules.cellmlsoma_SN")
            axon = page.get_by_text("SN_axoncell_modules.cellmlaxon_SN")
            soma.wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function(f"{SIMULATOR_READY}", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()

            # Flipping to the whole model runs it straight away.
            switch = page.get_by_role("switch", name="Simulate the whole model, not the selection")
            switch.uncheck()
            switch.check()
            expect(page.get_by_text("Simulated the whole model")).to_be_visible(timeout=120000)

            # In Selection mode, picking an instance runs it once chosen.
            switch.uncheck()
            soma.click()
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)

            # A Cmd/Ctrl-click adds to the selection, which runs it.
            axon.click(modifiers=["ControlOrMeta"])
            expect(page.get_by_text("Simulated 2 instances on their own")).to_be_visible(timeout=120000)

            # A selection box dragged with Shift runs only once the pointer comes up.
            var = page.get_by_text("SN_varicositycell_modules.cellmlvar_SN").locator("xpath=ancestor::*[contains(@class,'vue-flow__node')][1]")
            box = var.bounding_box()
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
            page = context.new_page()
            with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
                workspace_json = f.read().strip()
            page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}", wait_until="commit")

            # ---------- START -----------
            page.get_by_text("SN_somacell_modules.cellmlsoma_SN").wait_for(timeout=APP_MOUNT_TIMEOUT)
            page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
            page.evaluate(SHORTEN_SIMULATION)
            page.evaluate(
                "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('inspectionModules')"
                ".addModule({ name: 'Soma voltage', units: 'milliV',"
                " variables: [{ key: 'dndnode_0::V', nodeId: 'dndnode_0', nodeName: 'soma_SN', variableName: 'V', units: 'milliV' }] })"
            )
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_whole_model(page)

            expect(page.get_by_text("Simulated the whole model")).to_be_visible(timeout=120000)
            # Not plotted by default.
            expect(page.locator(".simulation-plot")).to_have_count(0)

            # They can be put on a plot from the search, like any variable.
            plot_variable(page, "inspection_modules/Soma voltage")
            expect(page.locator(".simulation-plot .plot-title")).to_have_text("inspection_modules/Soma voltage")
            page.get_by_role("button", name="Stop plotting Soma voltage").click()
            expect(page.locator(".simulation-plot")).to_have_count(0)

            # Turned on in Settings, they plot as a plot of their own.
            page.get_by_role("button", name="Settings", exact=True).click()
            page.get_by_role("switch", name="Plot inspection modules").check()
            page.get_by_role("button", name="Save Changes").click()
            expect(page.locator(".simulation-plot .plot-title")).to_have_text("Soma voltage")
            # ----------- END ------------

            context.close()
            browser.close()


if __name__ == '__main__':
    unittest.main()
