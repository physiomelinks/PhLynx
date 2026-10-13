import os
import unittest

from playwright.sync_api import sync_playwright, expect

try:
    from .config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH
except ImportError:
    from config import BASE_URL, HEADLESS_MODE, RESOURCE_PATH


NODE = ".vue-flow__node"
EDGE = ".vue-flow__edge"
SELECTED_NODE = ".vue-flow__node.selected"
VIEWPORT = ".vue-flow__transformationpane"

# The workspace-json fixture holds three instances: var_SN, axon_SN and soma_SN.
FIXTURE_NODE_COUNT = 3

READ_TRANSFORM_JS = """
(selector) => {
    const m = new DOMMatrix(getComputedStyle(document.querySelector(selector)).transform);
    return { x: m.e, y: m.f, zoom: m.a };
}
"""

# Dispatch a drop of a real File onto the canvas wrapper, the way the OS would.
DROP_FILE_JS = """
([name, content]) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([content], name, { type: 'application/xml' }));
    document.querySelector('.dnd-flow').dispatchEvent(
        new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
    );
}
"""


# Stand in for the browser's save picker: record each call, then cancel as the user would.
RECORD_SAVE_PICKER_JS = """
window.__savePickerCalls = 0;
window.showSaveFilePicker = async () => {
    window.__savePickerCalls += 1;
    throw new DOMException('cancelled', 'AbortError');
};
"""


def read_resource(name):
    with open(os.path.join(RESOURCE_PATH, name)) as f:
        return f.read()


def transform(page, selector=VIEWPORT):
    return page.evaluate(READ_TRANSFORM_JS, selector)


def wait_for_transform_change(page, before, key):
    """Wait for the viewport transform's `key` (x, y or zoom) to differ from its value in `before`."""
    page.wait_for_function(
        """([selector, key, previous]) => {
            const m = new DOMMatrix(getComputedStyle(document.querySelector(selector)).transform);
            const now = { x: m.e, y: m.f, zoom: m.a };
            return Math.abs(now[key] - previous) > 0.001;
        }""",
        arg=[VIEWPORT, key, before[key]],
    )
    return transform(page)


def wait_for_settled_transform(page):
    """Wait until the viewport transform has held still for several polls (pan, zoom and fit animations done)."""
    page.wait_for_function(
        """(selector) => {
            const m = new DOMMatrix(getComputedStyle(document.querySelector(selector)).transform);
            const key = [m.e, m.f, m.a].map((v) => v.toFixed(3)).join();
            const last = window.__transformWatch;
            window.__transformWatch = { key, polls: last && last.key === key ? last.polls + 1 : 0 };
            return window.__transformWatch.polls >= 4;
        }""",
        arg=VIEWPORT,
        polling=100,
    )
    return transform(page)


def node_by_name(page, name):
    return page.locator(NODE).filter(has_text=name)


def centre(locator):
    box = locator.bounding_box()
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def drag(page, start, end, steps=15):
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move(*end, steps=steps)
    page.mouse.up()


def box_around(page, names, margin=30):
    """Screen rectangle (left, top, right, bottom) that just encloses the named nodes."""
    boxes = [node_by_name(page, n).bounding_box() for n in names]
    return (
        min(b["x"] for b in boxes) - margin,
        min(b["y"] for b in boxes) - margin,
        max(b["x"] + b["width"] for b in boxes) + margin,
        max(b["y"] + b["height"] for b in boxes) + margin,
    )


def shift_drag_select(page, names):
    """Drag a selection box (Shift + drag on the pane) around the named instances."""
    wait_for_settled_transform(page)
    left, top, right, bottom = box_around(page, names)
    page.mouse.move(left, top)
    page.keyboard.down("Shift")
    # Vue Flow only starts a selection box once it has seen Shift and marked the pane.
    expect(page.locator(".vue-flow__pane.selection")).to_be_attached()
    page.mouse.down()
    page.mouse.move(right, bottom, steps=15)
    page.mouse.up()
    page.keyboard.up("Shift")


def undo(page):
    # The undo button enables once the history has recorded the change.
    expect(page.locator("button:has(.pi-undo)")).to_be_enabled()
    page.keyboard.press("ControlOrMeta+z")


def ghost_handle(page, node_name, side):
    """The middle free (ghost) handle on one side of the named instance."""
    handles = node_by_name(page, node_name).locator(f".vue-flow__handle.handle--ghost.vue-flow__handle-{side}")
    return handles.nth(handles.count() // 2)


def all_nodes_inside_canvas(page):
    return page.evaluate(
        """() => {
            const canvas = document.querySelector('.vue-flow').getBoundingClientRect();
            return [...document.querySelectorAll('.vue-flow__node')].every((node) => {
                const r = node.getBoundingClientRect();
                return r.left >= canvas.left && r.top >= canvas.top
                    && r.right <= canvas.right && r.bottom <= canvas.bottom;
            });
        }"""
    )


class TestWorkspaceCanvas(unittest.TestCase):

    def setUp(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=HEADLESS_MODE)
        # A fixed, roomy viewport keeps the canvas layout identical between runs and machines.
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 900})
        self.page = self.context.new_page()

    def tearDown(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()

    # ---------- helpers -----------

    def open_workspace(self):
        """Load the three-instance fixture and wait for the canvas to render it."""
        page = self.page
        workspace_json = read_resource("workspace-json.base64").strip()
        page.goto(BASE_URL + f"?open=workspace_json#{workspace_json}")
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT)
        expect(page.locator(EDGE)).to_have_count(2)
        # Let the initial fit-view finish so tests start from a stable viewport.
        return wait_for_settled_transform(page)

    def open_empty_workspace(self):
        """Open the app with nothing loaded and wait until CellML files can be imported."""
        page = self.page
        page.goto(BASE_URL)
        expect(page.locator(".vue-flow__pane")).to_be_visible()
        expect(page.locator(".file-io-buttons .p-splitbutton button").first).to_be_enabled()

    def drop_cellml(self, name):
        self.page.evaluate(DROP_FILE_JS, [name, read_resource(name)])

    # ---------- zoom, fit view and minimap -----------

    def test_zoom_buttons_change_scale(self):
        page = self.page
        start = self.open_workspace()

        page.locator(".vue-flow__controls-zoomin").click()
        zoomed_in = wait_for_transform_change(page, start, "zoom")
        self.assertGreater(zoomed_in["zoom"], start["zoom"])

        zoomed_in = wait_for_settled_transform(page)
        page.locator(".vue-flow__controls-zoomout").click()
        page.locator(".vue-flow__controls-zoomout").click()
        zoomed_out = wait_for_transform_change(page, zoomed_in, "zoom")
        self.assertLess(zoomed_out["zoom"], zoomed_in["zoom"])
        self.assertLess(wait_for_settled_transform(page)["zoom"], start["zoom"])

    def test_fit_view_brings_all_nodes_back_into_view(self):
        page = self.page
        start = self.open_workspace()

        # Zoom in on the canvas and pan so the nodes are pushed out of view.
        page.locator(".vue-flow__controls-zoomin").click()
        page.locator(".vue-flow__controls-zoomin").click()
        zoomed = wait_for_settled_transform(page)
        self.assertGreater(zoomed["zoom"], start["zoom"])
        drag(page, (1100, 300), (1500, 700))
        panned = wait_for_transform_change(page, zoomed, "x")
        self.assertNotEqual(panned["x"], zoomed["x"])
        self.assertFalse(all_nodes_inside_canvas(page))

        page.locator(".vue-flow__controls-fitview").click()
        wait_for_settled_transform(page)
        self.assertTrue(all_nodes_inside_canvas(page))

    def test_minimap_drag_pans_viewport(self):
        page = self.page
        start = self.open_workspace()

        minimap = page.locator(".vue-flow__minimap")
        expect(minimap).to_be_visible()
        expect(minimap.locator(".vue-flow__minimap-node")).to_have_count(FIXTURE_NODE_COUNT)
        x, y = centre(minimap)
        drag(page, (x, y), (x + 20, y - 15), steps=15)

        moved = wait_for_transform_change(page, start, "x")
        self.assertNotEqual((moved["x"], moved["y"]), (start["x"], start["y"]))
        self.assertAlmostEqual(moved["zoom"], start["zoom"], places=3)

    # ---------- selection, delete and undo -----------

    def test_shift_drag_selects_multiple_instances(self):
        page = self.page
        self.open_workspace()

        shift_drag_select(page, ["var_SN", "axon_SN"])

        expect(page.locator(SELECTED_NODE)).to_have_count(2)
        expect(node_by_name(page, "soma_SN")).not_to_have_class("selected")

    def test_modifier_click_adds_instances_to_selection(self):
        page = self.page
        self.open_workspace()

        # Vue Flow's multi-selection key is Ctrl (Cmd on macOS); Shift is for the selection box.
        node_by_name(page, "var_SN").click(position={"x": 60, "y": 55})
        expect(page.locator(SELECTED_NODE)).to_have_count(1)
        node_by_name(page, "axon_SN").click(modifiers=["ControlOrMeta"], position={"x": 60, "y": 55})

        expect(page.locator(SELECTED_NODE)).to_have_count(2)

    def test_select_all_delete_and_undo(self):
        page = self.page
        self.open_workspace()

        page.locator(".vue-flow__pane").click(position={"x": 1100, "y": 300})
        expect(page.locator(SELECTED_NODE)).to_have_count(0)
        page.keyboard.press("ControlOrMeta+a")
        expect(page.locator(SELECTED_NODE)).to_have_count(FIXTURE_NODE_COUNT)

        page.keyboard.press("Delete")
        expect(page.locator(NODE)).to_have_count(0)

        undo(page)
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT)
        expect(page.locator(EDGE)).to_have_count(2)

    def test_delete_selected_subset_and_undo(self):
        page = self.page
        self.open_workspace()

        shift_drag_select(page, ["var_SN", "axon_SN"])
        expect(page.locator(SELECTED_NODE)).to_have_count(2)

        page.keyboard.press("Delete")
        expect(page.locator(NODE)).to_have_count(1)
        expect(node_by_name(page, "soma_SN")).to_be_visible()

        undo(page)
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT)

    # ---------- dropping CellML files -----------

    def test_drop_cellml_file_with_connections_creates_nodes(self):
        page = self.page
        self.open_empty_workspace()
        expect(page.locator(NODE)).to_have_count(0)

        self.drop_cellml("model.cellml")

        expect(page.locator(NODE).first).to_be_visible()
        self.assertGreater(page.locator(NODE).count(), 0)
        expect(page.locator(EDGE).first).to_be_attached()

    def test_drop_cellml_file_onto_populated_workspace_asks_overwrite_or_add(self):
        page = self.page
        self.open_workspace()

        self.drop_cellml("model.cellml")
        dialog = page.get_by_role("alertdialog")
        expect(dialog).to_contain_text("Workspace Not Empty")
        dialog.get_by_role("button", name="Overwrite").click()
        expect(dialog).to_be_hidden()

        # The fixture's instances are replaced, not added to: appending would leave duplicates (6 nodes).
        expect(page.locator(NODE)).to_have_count(FIXTURE_NODE_COUNT)
        expect(node_by_name(page, "var_SN")).to_have_count(1)
        expect(page.locator(NODE).filter(has_text="model.cellml")).to_have_count(FIXTURE_NODE_COUNT)

    # ---------- connecting handles -----------

    def test_connecting_handles_on_different_instances_adds_edge(self):
        page = self.page
        self.open_workspace()

        drag(page, centre(ghost_handle(page, "soma_SN", "right")), centre(ghost_handle(page, "var_SN", "left")))

        expect(page.locator(EDGE)).to_have_count(3)

    def test_connecting_handles_on_the_same_instance_adds_no_edge(self):
        page = self.page
        self.open_workspace()

        drag(page, centre(ghost_handle(page, "axon_SN", "right")), centre(ghost_handle(page, "axon_SN", "left")))

        # Move off the canvas handles, then confirm no edge appeared.
        page.mouse.move(1100, 300)
        expect(page.locator(".vue-flow__connection-path")).to_have_count(0)
        expect(page.locator(EDGE)).to_have_count(2)


    # ---------- keyboard shortcuts -----------

    def test_save_shortcut_saves_a_populated_workspace(self):
        page = self.page
        page.add_init_script(RECORD_SAVE_PICKER_JS)
        self.open_workspace()

        page.locator(".vue-flow__pane").click(position={"x": 1100, "y": 300})
        page.keyboard.press("ControlOrMeta+s")

        page.wait_for_function("() => window.__savePickerCalls === 1")

    def test_save_shortcut_does_nothing_on_an_empty_workspace(self):
        page = self.page
        page.add_init_script(RECORD_SAVE_PICKER_JS)
        self.open_empty_workspace()

        page.locator(".vue-flow__pane").click(position={"x": 1100, "y": 300})
        page.keyboard.press("ControlOrMeta+s")

        # The save button is disabled on an empty canvas, and so is its shortcut.
        expect(page.locator("button:has(.pi-save)")).to_be_disabled()
        self.assertEqual(page.evaluate("window.__savePickerCalls"), 0)


if __name__ == '__main__':
    unittest.main()
