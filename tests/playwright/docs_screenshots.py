"""Recapture the user guide's screenshots (docs/assets/images) from a running PhLynx.

Start the app (`yarn dev`), then run:

    PHLYNX_BASE_URL=http://localhost:5173/ yarn docs:screenshots [name ...]

With names (e.g. `toolbar simulation-page`), only those screenshots are taken.
"""

import json
import os
import re
import sys

from playwright.sync_api import expect, sync_playwright

sys.path.insert(0, os.path.dirname(__file__))

from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH  # noqa: E402
from test_simulation_tab import (  # noqa: E402
    ADD_FEATURES_PROTOCOL,
    APP_MOUNT_TIMEOUT,
    FEATURES_SETTINGS,
    OPT_IN_TO_ISOLATION,
    RESULTS_STORE,
    SIMULATOR_READY,
    pick_path,
    plot_variable,
    simulate_whole_model,
)
from test_celldl import (  # noqa: E402
    CELLDL_GROUP,
    DIAGRAM_TIMEOUT,
    ENZYME,
    ENZYME_MODULE,
    PRODUCT,
    REACTIONS_MODULE,
    REACTIONS_PANEL,
    import_diagram,
    open_editor,
    place,
    set_element_field,
    wait_for_diagram,
)
from test_workspace import centre, ghost_handle, node_by_name, wait_for_settled_transform  # noqa: E402

IMAGES = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "docs", "assets", "images"))
VIEWPORT = {"width": 1440, "height": 900}
LIGHT_THEME = "localStorage.setItem('phlynx-color-scheme', 'light')"
# A new workspace's settings (BASELINE_SIMULATION_SETTINGS), as a reader following the quick start has. The fixture
# predates saved settings, so it loads with the coarser ones older files get, between which the solver gives up.
APP_DEFAULT_SIMULATION = (
    "document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('simulationSettings')"
    ".setSimulationSettings({ startingPoint: 0, endingPoint: 10, pointInterval: 0.001, tolerance: 1e-7, maxSteps: 500 })"
)
SIMULATION_DONE = f"['done', 'error', 'blocked'].includes({RESULTS_STORE}.status)"


def read_workspace():
    """The three-instance fixture as an `?open=workspace_json` payload."""
    with open(os.path.join(RESOURCE_PATH, "workspace-json.base64")) as f:
        return f.read().strip()


def open_workspace(page, unconnected=False):
    page.goto(BASE_URL + f"?open=workspace_json#{read_workspace()}", wait_until="commit")
    expect(page.locator(".vue-flow__node")).to_have_count(3, timeout=APP_MOUNT_TIMEOUT)
    wait_for_settled_transform(page)
    if unconnected:
        # Deleting a connection turns its handles back into ghosts, as when the instances were first placed.
        edges = page.locator(".vue-flow__edge")
        for remaining in range(edges.count() - 1, -1, -1):
            edges.first.click(force=True)
            page.keyboard.press("Delete")
            expect(edges).to_have_count(remaining)
        page.mouse.click(VIEWPORT["width"] - 500, VIEWPORT["height"] - 150)
    # Tooltips and toasts from loading would land in the shots.
    page.mouse.move(VIEWPORT["width"] - 5, VIEWPORT["height"] - 5)
    dismiss_toasts(page)


def dismiss_toasts(page):
    page.evaluate("document.querySelectorAll('.p-toast-message').forEach((toast) => toast.remove())")


def close_search(page):
    """Close a path search's suggestions, which stay open after a pick."""
    page.keyboard.press("Escape")
    page.evaluate("document.activeElement?.blur()")
    page.mouse.move(VIEWPORT["width"] / 2, VIEWPORT["height"] - 5)
    page.wait_for_timeout(300)


def open_simulation_tab(page):
    page.locator(".resizable-context-panel .aside-collapse-toggle").click()
    page.locator(".context-tabs [role=tab]").filter(has=page.locator(".pi-chart-line")).click()


def run_whole_model(page):
    page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
    page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
    # The whole 0–10 s: the soma only starts firing at about 6 s.
    page.evaluate(APP_DEFAULT_SIMULATION)
    open_simulation_tab(page)
    simulate_whole_model(page)
    page.wait_for_function(SIMULATION_DONE, timeout=120000)


def save(locator_or_page, name, **options):
    path = os.path.join(IMAGES, f"{name}.png")
    locator_or_page.screenshot(path=path, animations="disabled", **options)
    print(f"  wrote {os.path.relpath(path)}")


def clip_around(locators, margin=24):
    boxes = [locator.bounding_box() for locator in locators]
    left = min(b["x"] for b in boxes) - margin
    top = min(b["y"] for b in boxes) - margin
    return {
        "x": max(left, 0),
        "y": max(top, 0),
        "width": max(b["x"] + b["width"] for b in boxes) + margin - max(left, 0),
        "height": max(b["y"] + b["height"] for b in boxes) + margin - max(top, 0),
    }


def open_instance_editor(page, name="soma_SN"):
    node_by_name(page, name).dblclick()
    dialog = page.locator(".module-editor-dialog")
    expect(dialog.get_by_role("tab", name=re.compile(r"Ports \("))).to_be_visible(timeout=30000)
    return dialog


# ---------- screenshots -----------


def phlynx_ui(page):
    open_workspace(page)
    run_whole_model(page)
    plot_variable(page, "soma_SN/V")
    expect(page.locator(".simulation-plot canvas")).to_have_count(1)
    close_search(page)
    dismiss_toasts(page)
    save(page, "phlynx_ui")


def toolbar(page):
    open_workspace(page)
    # With an instance selected the add-handle buttons are enabled.
    node_by_name(page, "soma_SN").click()
    page.mouse.move(VIEWPORT["width"] / 2, VIEWPORT["height"] - 5)
    save(page, "toolbar", clip=page.locator(".app-header").bounding_box(), scale="device")


def module_elements(page):
    open_workspace(page, unconnected=True)
    soma = node_by_name(page, "soma_SN")
    page.mouse.move(*centre(ghost_handle(page, "soma_SN", "right")))
    page.wait_for_timeout(300)
    save(page, "module-elements", clip=clip_around([soma], margin=40))


def quick_start_step_one_placed(page):
    open_workspace(page, unconnected=True)
    save(page, "quick-start-step-one-placed")


def quick_start_step_two(page):
    open_workspace(page)
    save(page, "quick-start-step-two")


def connect_port_nodes(page):
    open_workspace(page, unconnected=True)
    start = centre(ghost_handle(page, "soma_SN", "right"))
    end = centre(ghost_handle(page, "axon_SN", "left"))
    page.mouse.move(*start)
    page.mouse.down()
    # Over the target's ghost handle, so it shows where the connection will land.
    page.mouse.move(*end, steps=15)
    page.wait_for_timeout(300)
    save(page, "connect-port-nodes", clip=clip_around([node_by_name(page, "soma_SN"), node_by_name(page, "axon_SN")], margin=40))
    page.mouse.up()


def edit_module_detail(page):
    open_workspace(page)
    dialog = open_instance_editor(page)
    dialog.get_by_role("tab", name=re.compile(r"Ports \(")).click()
    page.wait_for_timeout(400)
    save(dialog, "edit-module-detail")


def cellml_text_edit(page):
    open_workspace(page)
    dialog = open_instance_editor(page)
    dialog.get_by_text("CellML Text", exact=True).click()
    expect(dialog.locator(".cm-content")).to_be_visible()
    page.wait_for_timeout(400)
    save(dialog.locator(".left-pane"), "cellml-text-edit")


def import_vessel_array(page):
    open_workspace(page)
    import_menu = page.locator(".file-io-buttons .p-splitbutton").first
    import_menu.locator(".p-splitbutton-dropdown").click()
    page.get_by_role("menuitem", name="Instance Array").click()
    dialog = page.locator(".p-dialog").filter(has_text="Instance Array")
    expect(dialog).to_be_visible()
    page.wait_for_timeout(300)
    save(dialog, "import-vessel-array")


def simulation_sidebar(page):
    open_workspace(page)
    run_whole_model(page)
    plot_variable(page, "soma_SN/V")
    plot_variable(page, "soma_SN/m")
    expect(page.locator(".simulation-plot")).to_have_count(2)
    close_search(page)
    page.mouse.move(5, VIEWPORT["height"] - 5)
    dismiss_toasts(page)
    save(page, "simulation-sidebar", clip=page.locator(".resizable-context-panel").bounding_box())


def simulation_page(page):
    open_workspace(page)
    run_whole_model(page)
    plot_variable(page, "soma_SN/V")
    page.get_by_role("button", name="Open the simulation page").click()
    expect(page).to_have_url(re.compile(r"/simulation$"))
    sim_page = page.locator(".simulation-view")
    plot_variable(page, "soma_SN/m", within=sim_page)
    expect(sim_page.locator(".simulation-plot")).to_have_count(2)
    close_search(page)
    sim_page.get_by_text("Simulation settings", exact=True).click()
    page.mouse.move(VIEWPORT["width"] / 2, VIEWPORT["height"] - 5)
    page.wait_for_timeout(300)
    dismiss_toasts(page)
    save(page, "simulation-page")


def protocol_results(page):
    open_workspace(page)
    page.wait_for_function("window.crossOriginIsolated === true", timeout=APP_MOUNT_TIMEOUT)
    page.wait_for_function(SIMULATOR_READY, timeout=APP_MOUNT_TIMEOUT)
    # The protocol parity check's SN protocol, whose data items give obs_data plots.
    page.evaluate(FEATURES_SETTINGS)
    page.evaluate(ADD_FEATURES_PROTOCOL)
    open_simulation_tab(page)
    page.get_by_role("button", name="Run the protocol's experiments").click()
    page.wait_for_function(SIMULATION_DONE, timeout=120000)
    page.get_by_role("button", name="Open the simulation page").click()
    expect(page.locator(".simulation-view .simulation-plot").first).to_be_visible()
    page.mouse.move(VIEWPORT["width"] / 2, VIEWPORT["height"] - 5)
    page.wait_for_timeout(500)
    dismiss_toasts(page)
    save(page, "protocol-results")


def connections_dialog(page):
    open_workspace(page)
    page.locator(".vue-flow__edge").first.dblclick(force=True)
    dialog = page.locator(".p-dialog").filter(has_text="Connections")
    expect(dialog).to_be_visible()
    page.wait_for_timeout(300)
    save(dialog, "connections-dialog")


def macro_builder(page):
    open_workspace(page)
    page.locator("button:has(.pi-hammer)").click()
    dialog = page.locator(".macro-dialog")
    canvas = dialog.locator(".dnd-flow")
    expect(dialog.locator(".vue-flow__pane")).to_be_visible()

    # One segment, soma into axon, whose axon connects into a ghost of the next copy's soma.
    dialog.get_by_role("button", name=re.compile(r"cell modules", re.I)).click()
    cards = dialog.locator(".mlc__card--draggable")
    cards.filter(has_text="SN_soma").first.drag_to(canvas, target_position={"x": 120, "y": 380})
    cards.filter(has_text="SN_axon").first.drag_to(canvas, target_position={"x": 470, "y": 380})
    dialog.get_by_role("button", name=re.compile(r"ghost modules", re.I)).click()
    cards.filter(has_text="ghost").first.drag_to(canvas, target_position={"x": 820, "y": 380})
    ghost_setup = page.locator(".p-dialog").filter(has_text="Configure Ghost Node")
    expect(ghost_setup).to_be_visible()
    ghost_setup.locator(".p-select").click()
    page.get_by_role("option", name=re.compile(r"soma", re.I)).first.click()
    ghost_setup.get_by_role("button", name="Create Ghost").click()
    expect(dialog.locator(".vue-flow__node")).to_have_count(3)

    nodes = dialog.locator(".vue-flow__node")

    def handle(node, side):
        handles = node.locator(f".vue-flow__handle.handle--ghost.vue-flow__handle-{side}")
        return handles.nth(handles.count() // 2)

    soma, axon, ghost = (nodes.filter(has_text=text).first for text in ("SN_soma", "SN_axon", "Next:"))
    for source, target in ((soma, axon), (axon, ghost)):
        start, end = centre(handle(source, "right")), centre(handle(target, "left"))
        page.mouse.move(*start)
        page.mouse.down()
        page.mouse.move(*end, steps=15)
        page.mouse.up()
    expect(dialog.locator(".vue-flow__edge")).to_have_count(2)
    dialog.locator(".repeat-count-control input").fill("4")
    page.mouse.move(VIEWPORT["width"] / 2, VIEWPORT["height"] - 5)
    page.wait_for_timeout(300)
    save(dialog, "macro-builder")


def units_create(page):
    open_workspace(page)
    dialog = open_instance_editor(page)
    # c_SL's Units field (the first row is I_out): typing an expression offers library equivalents and a new unit.
    field = dialog.locator(".right-pane input[placeholder='e.g. mV or mV/ms']").nth(1)
    field.click()
    field.press("ControlOrMeta+a")
    field.press_sequentially("mV/ms", delay=40)
    expect(page.locator(".sanitised-input__option").filter(has_text="mV_per_ms")).to_be_visible()
    for _ in range(3):
        field.press("ArrowDown")
    page.wait_for_timeout(300)
    # No Esc: with no list open it closes the editor.
    row = field.locator("xpath=ancestor::tr[1]")
    save(page, "units-create", clip=clip_around([row, page.locator(".sanitised-input__suggestions")], margin=16))


def math_editor(page):
    open_workspace(page)
    dialog = open_instance_editor(page)
    dialog.get_by_role("tab", name="Math Editor").click()
    page.wait_for_timeout(2500)
    keyboard = page.keyboard
    keyboard.press("End")
    keyboard.press("Enter")
    keyboard.type("\\dd", delay=30)
    keyboard.press("Space")
    keyboard.type("V_m", delay=30)
    keyboard.press("Tab")
    keyboard.type("t", delay=30)
    keyboard.press("Space")
    keyboard.type("=(I_stim-I_ion)/C_m", delay=30)
    keyboard.press("Enter")
    keyboard.type("I_ion=g_K*n^4", delay=30)
    keyboard.press("Space")
    keyboard.type("*(V_m-E_K)", delay=30)
    keyboard.press("Enter")
    keyboard.type("tau_n=1/(alpha_n+beta_n)", delay=30)
    keyboard.press("Enter")
    keyboard.press("Backspace")
    page.mouse.move(VIEWPORT["width"] / 2, VIEWPORT["height"] - 5)
    page.wait_for_timeout(1500)
    save(dialog, "math-editor")


def sweep_view(page):
    open_workspace(page)
    run_whole_model(page)
    plot_variable(page, "soma_SN/V")
    close_search(page)
    page.get_by_role("button", name=re.compile(r"^Sweep \(")).click()
    page.get_by_role("button", name="Sweep a parameter").click()
    pick_path(page, "Choose a parameter to sweep", "soma_SN/g_M")
    close_search(page)
    for test_id, value in (("sim-sweep-from", "0.002"), ("sim-sweep-to", "0.006"), ("sim-sweep-points", "21")):
        box = page.get_by_test_id(test_id)
        box.fill(value)
        box.press("Tab")
    page.get_by_test_id("sim-sweep-readout").get_by_text("Max", exact=True).click()
    page.get_by_test_id("sim-sweep-mode").click()
    page.wait_for_function(f"{RESULTS_STORE}.status === 'done' && {RESULTS_STORE}.results?.isSweep", timeout=120000)
    page.mouse.move(5, VIEWPORT["height"] - 5)
    page.wait_for_timeout(300)
    dismiss_toasts(page)
    save(page, "sweep-view", clip=page.locator(".resizable-context-panel").bounding_box())


# Two experiments stepping the soma's input current, each recording V's peak, plotted against the step.
PROTOCOL_EDITOR_OBS_DATA = {
    "protocol_info": {
        "pre_times": [1, 1],
        "sim_times": [[1, 2], [1, 2]],
        "params_to_change": {"soma_SN/I_in": [[0, -0.05], [0, -0.1]]},
        "experiment_labels": ["Step to -0.05 nA", "Step to -0.1 nA"],
    },
    "prediction_items": [
        {"data_item_name": "soma_SN/V", "operands": ["soma_SN/V"], "unit": "milliV", "experiment_idx": 0,
         "subexperiment_idx": 1, "operation": "max", "item_name_for_plotting": "V_peak"},
        {"data_item_name": "soma_SN/V_2", "operands": ["soma_SN/V"], "unit": "milliV", "experiment_idx": 1,
         "subexperiment_idx": 1, "operation": "max", "item_name_for_plotting": "V_peak"},
    ],
    "prediction_plots": [
        {"name": "Peak V vs step current", "kind": "feature_vs_input",
         "x": {"params_to_change": "soma_SN/I_in", "subexperiment_idx": 1}, "y": "V_peak", "series": None},
    ],
}
ADD_PROTOCOL_EDITOR_OBS_DATA = (
    "(() => { const payload = new TextEncoder().encode(" + json.dumps(json.dumps(PROTOCOL_EDITOR_OBS_DATA)) + ").buffer;"
    " document.querySelector('#app').__vue_app__.config.globalProperties.$pinia._s.get('omex')"
    ".setArchive({ extras: [{ location: 'SN_simple_obs_data.json', format: 'application/json', payload }] }) })()"
)


def protocol_editor(page):
    page.set_viewport_size({"width": VIEWPORT["width"], "height": 1100})
    open_workspace(page)
    open_simulation_tab(page)
    page.evaluate(ADD_PROTOCOL_EDITOR_OBS_DATA)
    page.get_by_role("button", name="Edit obs_data", exact=True).click()
    dialog = page.get_by_role("dialog", name="Edit obs_data")
    dialog.get_by_role("button", name="Step to -0.05 nA", exact=True).click()
    expect(dialog.get_by_label("Experiment name")).to_have_value("Step to -0.05 nA")
    page.evaluate("document.activeElement?.blur()")
    page.mouse.move(5, 1095)
    page.wait_for_timeout(600)
    save(dialog, "protocol-editor")


def open_celldl_module(page, path, module):
    """Imports a CellDL diagram into an empty workspace, places it and opens its editor on the diagram."""
    page.goto(BASE_URL, wait_until="commit")
    page.locator(".file-io-buttons .p-splitbutton").first.wait_for(timeout=APP_MOUNT_TIMEOUT)
    import_diagram(page, path)
    expect(page.get_by_text("CellDL Diagram Loaded")).to_be_visible(timeout=DIAGRAM_TIMEOUT)
    dismiss_toasts(page)
    place(page, CELLDL_GROUP, module)
    dialog = open_editor(page, module)
    wait_for_diagram(page)
    return dialog


def celldl_editor(page):
    dialog = open_celldl_module(page, ENZYME, ENZYME_MODULE)
    page.mouse.move(5, VIEWPORT["height"] - 5)
    page.wait_for_timeout(600)
    dismiss_toasts(page)
    save(dialog, "celldl-editor")


def celldl_reactions(page):
    dialog = open_celldl_module(page, REACTIONS_PANEL, REACTIONS_MODULE)
    page.locator(".celldl-pane .celldl-host #reactions-panel").click()
    expect(page.locator(".celldl-pane .celldl-host").get_by_label("Equation of r1")).to_be_visible()
    page.mouse.move(5, VIEWPORT["height"] - 5)
    page.wait_for_timeout(600)
    dismiss_toasts(page)
    save(dialog.locator(".left-pane"), "celldl-reactions")


def celldl_parameters(page):
    dialog = open_celldl_module(page, ENZYME, ENZYME_MODULE)
    dialog.get_by_role("tab", name=re.compile(r"Parameters \(")).click()
    expect(dialog.locator(".celldl-parameters .unit-system")).to_contain_text("SI (mol, L)")
    dialog.locator(".celldl-parameters .unit-system .p-select").click()
    expect(page.locator(".p-select-option").filter(has_text="Cellular (fmol, pL)")).to_be_visible()
    page.mouse.move(5, VIEWPORT["height"] - 5)
    page.wait_for_timeout(400)
    dismiss_toasts(page)
    save(dialog.locator(".right-pane"), "celldl-parameters")


def celldl_issues(page):
    dialog = open_celldl_module(page, ENZYME, ENZYME_MODULE)
    # Naming the product's store S as well gives two pools named q_S_c, which live conversion warns of.
    set_element_field(dialog, PRODUCT, "Species", "S")
    issues = dialog.locator(".celldl-live-issues")
    expect(issues).to_have_text(re.compile(r"^\s*Converts, with 1 warning"), timeout=DIAGRAM_TIMEOUT)
    issues.click()
    popover = page.locator(".p-popover")
    expect(popover.locator(".celldl-issue-list li")).to_have_count(1)
    page.wait_for_timeout(400)
    dismiss_toasts(page)
    save(page, "celldl-issues", clip=clip_around([dialog.locator(".celldl-live"), popover], margin=16))


def celldl_annotations(page):
    dialog = open_celldl_module(page, ENZYME, ENZYME_MODULE)
    host = page.locator(".celldl-pane .celldl-host")
    host.locator("#annotations-panel").click()
    # The panel rereads the diagram as it opens, dropping an entry made first, so it's entered again until kept.
    chebi = host.get_by_label(re.compile(r"^ChEBI ID of S\b"))
    apply = host.get_by_role("button", name="Apply", exact=True)
    for _ in range(5):
        chebi.fill("17234")
        chebi.press("Tab")
        try:
            expect(apply).to_be_enabled(timeout=1000)
            break
        except AssertionError:
            pass
    chebi.scroll_into_view_if_needed()
    page.evaluate("document.activeElement?.blur()")
    page.mouse.move(5, VIEWPORT["height"] - 5)
    page.wait_for_timeout(600)
    dismiss_toasts(page)
    save(dialog.locator(".left-pane"), "celldl-annotations")


SHOTS = {
    "phlynx_ui": phlynx_ui,
    "toolbar": toolbar,
    "module-elements": module_elements,
    "quick-start-step-one-placed": quick_start_step_one_placed,
    "quick-start-step-two": quick_start_step_two,
    "connect-port-nodes": connect_port_nodes,
    "edit-module-detail": edit_module_detail,
    "cellml-text-edit": cellml_text_edit,
    "import-vessel-array": import_vessel_array,
    "simulation-sidebar": simulation_sidebar,
    "simulation-page": simulation_page,
    "protocol-results": protocol_results,
    "connections-dialog": connections_dialog,
    "macro-builder": macro_builder,
    "units-create": units_create,
    "math-editor": math_editor,
    "sweep-view": sweep_view,
    "protocol-editor": protocol_editor,
    "celldl-editor": celldl_editor,
    "celldl-reactions": celldl_reactions,
    "celldl-parameters": celldl_parameters,
    "celldl-issues": celldl_issues,
    "celldl-annotations": celldl_annotations,
}


def main(names):
    unknown = [name for name in names if name not in SHOTS]
    if unknown:
        sys.exit(f"Unknown screenshot(s): {', '.join(unknown)}. Choose from: {', '.join(SHOTS)}")
    failed = []
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=HEADLESS_MODE)
        for name in names or SHOTS:
            print(name)
            # A fresh context per shot keeps each one's app state and storage independent.
            context = browser.new_context(viewport=VIEWPORT, device_scale_factor=2, color_scheme="light")
            context.add_init_script(OPT_IN_TO_ISOLATION)
            context.add_init_script(LIGHT_THEME)
            page = context.new_page()
            try:
                SHOTS[name](page)
            except Exception as error:  # Keep going so one broken shot doesn't block the rest.
                failed.append(name)
                print(f"  FAILED: {error}")
            context.close()
        browser.close()
    if failed:
        sys.exit(f"Failed: {', '.join(failed)}")


if __name__ == "__main__":
    main(sys.argv[1:])
