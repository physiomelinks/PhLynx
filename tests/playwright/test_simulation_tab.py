import os
import re
import unittest

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
# The model's full 10 s, which it fires late in, so a change of Cm moves its spikes. Its points are finer than
# the workspace's 0.01 s, between which the solver runs out of steps.
FULL_SIMULATION = (
    "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s"
    ".get('simulationSettings').setSimulationSettings({ endingPoint: 10, pointInterval: 0.001 })"
)
APP_MOUNT_TIMEOUT = 60000
SIMULATOR_READY = "document.querySelector('#app').__vue_app__._context.provides.$libopencor.status === 'ready'"
RESULTS_STORE = "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulationResults')"
FINAL_SOMA_V = (
    f"(() => {{ const store = {RESULTS_STORE}; const name = store.mapping.get('dndnode_0::V');"
    " return store.results.variables.get(name).values.at(-1) })()"
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


    def test_tracked_run_stays_on_the_chart_as_a_slider_moves(self):
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
            page.evaluate(FULL_SIMULATION)
            soma.click()
            page.locator(".resizable-context-panel .aside-collapse-toggle").click()
            page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()
            simulate_selection(page)
            expect(page.get_by_text("Simulated 1 instance on their own")).to_be_visible(timeout=120000)
            plot_variable(page, "soma_SN/V")
            add_slider(page, "soma_SN/Cm")
            page.wait_for_function(f"{RESULTS_STORE}.status === 'done'", timeout=120000)

            page.get_by_role("button", name=re.compile(r"^Runs \(0\)")).click()
            expect(page.get_by_text("Track a run to keep its lines on the charts")).to_be_visible()
            page.get_by_role("button", name="Track run").click()
            expect(page.get_by_role("button", name=re.compile(r"^Runs \(1\)"))).to_be_visible()
            expect(page.get_by_text("Run #1")).to_be_visible()
            # The chart says which run each line is from: the live run solid, the tracked run dashed.
            run_key = page.locator(".simulation-plot .plot-key[aria-label=Runs] li")
            expect(run_key).to_have_text(["Live", "#1"])

            before = page.evaluate(FINAL_SOMA_V)
            page.get_by_role("button", name=re.compile(r"^Sliders \(")).click()
            page.get_by_role("slider", name="Cm value").focus()
            for _ in range(300):
                page.keyboard.press("ArrowRight")
            page.wait_for_function(
                f"{RESULTS_STORE}.status === 'done' && {FINAL_SOMA_V} !== {before!r}",
                timeout=120000,
            )
            # The tracked run keeps its own values, whose spikes the larger Cm has moved.
            tracked, largest_difference = page.evaluate(
                f"(() => {{ const store = {RESULTS_STORE}; const run = store.trackedRuns[0];"
                " const read = (results, mapping) => results.variables.get(mapping.get('dndnode_0::V')).values;"
                " const tracked = read(run.results, run.mapping); const live = read(store.results, store.mapping);"
                " let largest = 0; for (let i = 0; i < tracked.length; i++) largest = Math.max(largest, Math.abs(tracked[i] - live[i]));"
                " return [tracked.at(-1), largest] })()"
            )
            self.assertEqual(tracked, before)
            self.assertGreater(largest_difference, 10)
            expect(run_key).to_have_text(["Live", "#1"])

            page.get_by_role("button", name=re.compile(r"^Runs \(1\)")).click()
            expect(page.locator(".run-item").nth(1)).to_contain_text("The model’s values")
            expect(page.locator(".run-item").nth(0)).to_contain_text("soma_SN/Cm = 31.8 picoF")
            page.get_by_role("button", name="Hide run #1").click()
            expect(run_key).to_have_count(0)
            page.get_by_role("button", name="Show run #1").click()
            expect(run_key).to_have_text(["Live", "#1"])
            page.get_by_role("button", name="Stop tracking run #1").click()
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
            # The first column is the variable of integration, named after the model's first ODE's: t.
            self.assertEqual(lines[0], "t (second),soma_SN/V (milliV),soma_SN/m (dimensionless)")
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
