import re
import sys
import unittest

from playwright.sync_api import sync_playwright, expect

try:
    from .config import BASE_URL, HEADLESS_MODE
    from .fixtures import use_default_timeouts, wait_for_library, wait_until_still
    from .test_annotations import TOY_MATHS, add_template, import_files, inside_of, toy
except ImportError:
    from config import BASE_URL, HEADLESS_MODE
    from fixtures import use_default_timeouts, wait_for_library, wait_until_still
    from test_annotations import TOY_MATHS, add_template, import_files, inside_of, toy


BIO = ".bio-flow"
BIO_NODE = f"{BIO} .vue-flow__node"
LIBRARY_CARD = ".mlc__card--draggable"

# Drag a library card onto the screen point the way the browser would: dragstart on the card, then dragover and
# drop on whatever is under the point, sharing one DataTransfer so the drop sees what the card put in it.
DRAG_OVER_AND_DROP_JS = """
([x, y, transfer]) => {
    const target = document.elementFromPoint(x, y);
    for (const type of ['dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, {
            dataTransfer: transfer, clientX: x, clientY: y, bubbles: true, cancelable: true,
        }));
    }
}
"""


# Drag a library card over a screen point without dropping it, so the drop prompts show.
DRAG_OVER_JS = """
([x, y, transfer]) => {
    const target = document.elementFromPoint(x, y);
    for (const type of ['dragenter', 'dragover']) {
        target.dispatchEvent(new DragEvent(type, {
            dataTransfer: transfer, clientX: x, clientY: y, bubbles: true, cancelable: true,
        }));
    }
}
"""


# Gives every library math without a parameter set a "trial" one, setting each of its variables to 12345, as an
# import linked by a config would.
ADD_TRIAL_SETS_JS = """
() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    const library = pinia._s.get('library');
    const parameters = pinia._s.get('defaultParameters');
    for (const module of library.availableModules.values()) {
        if (parameters.setsFor(module.mathRef).length) continue;
        const names = library.getMathAnalysis(module.mathRef)?.references ?? [];
        const values = new Map(names.map((name) => [name, { value: '12345', units: null, data_reference: null, sourced: true }]));
        parameters.addSet(
            { ref: 'trial', source: { file: 'trial.json', importedAt: '' }, globals: new Map(), values },
            { mathRef: module.mathRef }
        );
    }
}
"""


# How many pictures a save of the workspace's pieces keeps.
SAVED_IMAGES_JS = """
() => {
    const pinia = document.querySelector('#app').__vue_app__.config.globalProperties.$pinia;
    return Object.keys(pinia._s.get('bioPieces').getState()?.images ?? {}).length;
}
"""


def centre(box):
    return (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def piece(page, path):
    """The node drawing a site of the pieces, by its path ('cell', 'apical-fluid', 'plasma-membrane.apical', ...):
    empty, or holding a module, as one the build palette places holds a new one."""
    return page.locator(f'{BIO_NODE}:has([data-site="pieces/{path}"])').first


def empty_piece(page, path):
    """The node drawing a site of the pieces while no module is on it."""
    return page.locator(f'{BIO_NODE}[data-id^="pc:"]:has([data-site="pieces/{path}"])')


def bound(page, kind):
    """Diagram instances drawn as one kind of node in the physiological view (bioRegion, bioProtein, ...)."""
    return page.locator(f'{BIO} .vue-flow__node-{kind}:not([data-id^="pc:"])')


def palette_piece(page, kind):
    """One of the build palette's five pieces."""
    return page.locator(f"[data-testid=bio-palette-piece][data-piece={kind}]")


def undo(page):
    button = page.locator("button:has(.pi-undo)").first
    expect(button).to_be_enabled()
    button.click()


def has_class(name):
    """Matches a class attribute holding the class."""
    return re.compile(rf"(^|\s){re.escape(name)}(\s|$)")


def png_bytes(width=80, height=40, rgb=(200, 60, 60)):
    """A plain PNG of one colour, to add as a picture."""
    import struct
    import zlib

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    row = b"\x00" + bytes(rgb) * width
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", header)
        + chunk(b"IDAT", zlib.compress(row * height))
        + chunk(b"IEND", b"")
    )


# Drops picture files from the desktop on a screen point, as the browser would.
DROP_FILE_JS = """
([x, y, name, bytes]) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], name, { type: 'image/png' }));
    const target = document.elementFromPoint(x, y);
    for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, {
            dataTransfer: transfer, clientX: x, clientY: y, bubbles: true, cancelable: true,
        }));
    }
}
"""


class TestBioTemplates(unittest.TestCase):

    def setUp(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=HEADLESS_MODE)
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000})
        use_default_timeouts(self.context)
        self.page = self.context.new_page()

    def tearDown(self):
        self.context.close()
        self.browser.close()
        self.playwright.stop()

    # ---------- helpers -----------

    def open_physiology(self):
        """Open the app on the physiological view, with the library's first group open to drag from."""
        page = self.page
        page.goto(BASE_URL)
        expect(page.locator(".vue-flow__pane").first).to_be_visible()
        # The library's cards come with the built-in library.
        wait_for_library(page)
        page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
        expect(page.locator(f"{BIO} .vue-flow__pane")).to_be_visible()
        page.locator(".mlc__group-header").first.click()
        expect(page.locator(LIBRARY_CARD).nth(2)).to_be_visible()

    def drop_piece(self, kind, point):
        """Drag one of the palette's pieces onto a screen point of the physiological view."""
        pane = self.page.locator(f"{BIO} .vue-flow__pane")
        box = pane.bounding_box()
        palette_piece(self.page, kind).drag_to(pane, target_position={"x": point[0] - box["x"], "y": point[1] - box["y"]})

    def drop_cell(self, point, path):
        """A cell from the palette's pieces: a compartment dropped at a point, then a membrane dropped on it. The
        cell is drawn by the compartment's site, its path the compartment's id."""
        self.drop_piece("compartment", point)
        compartment = piece(self.page, path)
        expect(compartment).to_be_visible()
        self.drop_piece("membrane", centre(compartment.bounding_box()))
        cell = self.page.locator(f'{BIO} .vue-flow__node-bioCell:has([data-site="pieces/{path}"])')
        expect(cell).to_be_visible()
        return cell

    def grow_taller(self, cell, by):
        """Drag a cell's resize handle down, so it is taller by about `by` screen pixels."""
        page = self.page
        box = cell.bounding_box()
        page.mouse.move(box["x"] + 30, box["y"] + box["height"] - 30)
        corner = centre(cell.locator("[data-testid=bio-piece-resize]").first.bounding_box())
        page.mouse.move(*corner)
        page.mouse.down()
        page.mouse.move(corner[0], corner[1] + by, steps=8)
        page.mouse.up()
        wait_until_still(page)

    def butt_against(self, first, second):
        """Drag a cell left until its left side meets another's right side, so the two touch (a gap junction needs
        them to: between cells apart, a tube is always a bridge)."""
        for _ in range(4):
            one, two = first.bounding_box(), second.bounding_box()
            gap = two["x"] - (one["x"] + one["width"])
            # Within a few pixels counts as touching (the layout's TOUCHING is 8 flow units).
            if abs(gap) <= 4:
                return
            self.drag((two["x"] + two["width"] - 30, two["y"] + two["height"] - 20), (-gap, 0))
            wait_until_still(self.page)
        one, two = first.bounding_box(), second.bounding_box()
        self.assertAlmostEqual(two["x"], one["x"] + one["width"], delta=4)

    def pane_point(self, across, down):
        box = self.page.locator(f"{BIO} .vue-flow__pane").bounding_box()
        return (box["x"] + box["width"] * across, box["y"] + box["height"] * down)

    def test_the_build_palette_builds_a_cell_with_a_compartment_beside_it(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()

        # A membrane goes only round a compartment: on the empty view it is refused, with nothing added.
        self.drop_piece("membrane", self.pane_point(0.5, 0.45))
        expect(page.locator(f"{BIO} .vue-flow__node-bioCell")).to_have_count(0)

        # Dropped on a compartment, it encloses it: a cell.
        cell = self.drop_cell(self.pane_point(0.5, 0.45), "compartment")
        # With a new module in it, named for it, to replace later.
        expect(cell).to_contain_text("Compartment")

        # A compartment dropped just above its top side docks against it, outside.
        spot = cell.bounding_box()
        self.drop_piece("compartment", (spot["x"] + spot["width"] / 2, spot["y"] - 12))
        # Straight away, unnamed.
        expect(page.locator(".p-dialog")).to_have_count(0)
        compartment = piece(page, "compartment-2")
        expect(compartment).to_be_visible()
        expect(compartment).to_contain_text("Compartment")
        wait_until_still(page)
        assert compartment.bounding_box()["y"] < cell.bounding_box()["y"]

        # Named afterwards as an instance is in the diagram: a click on its name gives a field for it.
        name = compartment.locator("[data-testid=bio-piece-name]")
        before = name.bounding_box()
        name.click()
        field = page.locator("[data-testid=bio-piece-name-input]")
        expect(field).to_be_focused()
        # The name stays where it was as it becomes a field.
        after = field.bounding_box()
        assert abs(after["x"] - before["x"]) < 1 and abs(after["y"] - before["y"]) < 1, (before, after)
        field.fill("Lumen")
        field.press("Enter")
        expect(piece(page, "compartment-2")).to_contain_text("Lumen")

    def expect_in_diagram(self, count):
        """Looks in the diagram view for how many instances there are, and comes back."""
        page = self.page
        page.locator("[data-testid=view-mode]").get_by_text("Diagram").click()
        expect(page.locator(".vue-flow:not(.bio-flow) .vue-flow__node")).to_have_count(count)
        page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
        expect(page.locator(f"{BIO} .vue-flow__pane")).to_be_visible()

    def delete_at(self, point):
        """Select what is drawn at a screen point and press Delete."""
        expect(self.page.locator(".p-dialog-mask")).to_have_count(0)
        self.page.mouse.click(*point)
        self.page.keyboard.press("Delete")

    def test_delete_takes_a_piece_with_its_module_in_one_press(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        regions = page.locator(f"{BIO} .vue-flow__node-bioRegion")

        # A compartment is its module: one Delete takes both, unasked.
        self.drop_piece("compartment", self.pane_point(0.3, 0.3))
        expect(bound(page, "bioRegion")).to_have_count(1)
        box = piece(page, "compartment").bounding_box()
        self.delete_at((box["x"] + 20, box["y"] + box["height"] - 15))
        expect(regions).to_have_count(0)
        expect(page.locator(".p-dialog")).to_have_count(0)

        # A cell's inside: its compartment with everything attached to it, the membrane named in one question.
        # The id the deleted one had is free again.
        cell = self.drop_cell(self.pane_point(0.5, 0.45), "compartment")
        expect(bound(page, "bioMembrane")).to_have_count(1)
        self.expect_in_diagram(2)
        box = cell.bounding_box()
        self.delete_at((box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.3))
        dialog = page.locator(".p-dialog")
        expect(dialog).to_contain_text("goes with it")
        dialog.get_by_role("button", name="Delete", exact=True).click()
        expect(page.locator(f"{BIO} .vue-flow__node")).to_have_count(0)
        self.expect_in_diagram(0)
        # One step, undone as one: the cell back with both its modules.
        undo(page)
        expect(bound(page, "bioCell")).to_have_count(1)
        expect(bound(page, "bioMembrane")).to_have_count(1)
        self.expect_in_diagram(2)

    def test_delete_on_a_cells_membrane_takes_the_membrane_alone(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        cells = page.locator(f"{BIO} .vue-flow__node-bioCell")

        cell = self.drop_cell(self.pane_point(0.5, 0.45), "compartment")
        box = cell.bounding_box()
        band = (box["x"] + 2, box["y"] + box["height"] / 2)
        inside = (box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.3)

        # The membrane and its module go, unasked, leaving the compartment and its module as they were.
        self.delete_at(band)
        expect(cells).to_have_count(0)
        expect(bound(page, "bioRegion")).to_have_count(1)
        expect(page.locator(".p-dialog")).to_have_count(0)
        self.expect_in_diagram(1)
        # Then the compartment, in one press.
        self.delete_at(inside)
        expect(page.locator(f"{BIO} .vue-flow__node-bioRegion")).to_have_count(0)
        self.expect_in_diagram(0)

    def box_select(self, box, margin=40):
        """Drag a selection box, with Shift, round a bounding box."""
        page = self.page
        start = (box["x"] - margin, box["y"] - margin)
        end = (box["x"] + box["width"] + margin, box["y"] + box["height"] + margin)
        page.keyboard.down("Shift")
        page.mouse.move(*start)
        page.mouse.down()
        page.mouse.move(*end, steps=8)
        page.mouse.up()
        page.keyboard.up("Shift")

    def test_delete_takes_a_box_selection_whole(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        nodes = page.locator(f"{BIO} .vue-flow__node")

        # A cell, selected whole: one Delete takes its two modules and its two pieces, unasked, as one step.
        cell = self.drop_cell(self.pane_point(0.5, 0.45), "compartment")
        wait_until_still(page)
        box = cell.bounding_box()
        self.box_select(box)
        expect(page.locator(f"{BIO} .vue-flow__node.selected")).to_have_count(2)
        page.keyboard.press("Delete")
        expect(nodes).to_have_count(0)
        expect(page.locator(".p-dialog")).to_have_count(0)
        self.expect_in_diagram(0)
        undo(page)
        expect(bound(page, "bioCell")).to_have_count(1)
        expect(bound(page, "bioMembrane")).to_have_count(1)
        self.expect_in_diagram(2)

    def on_top_at_its_centre(self, node):
        """Whether a node is the one drawn on top at its own centre, so not hidden by what it is in."""
        x, y = centre(node.bounding_box())
        top = self.page.evaluate(
            "([x, y]) => document.elementFromPoint(x, y)?.closest('.vue-flow__node')?.dataset.id", [x, y]
        )
        return top == node.get_attribute("data-id")

    def name_clear_of(self, outer, inner):
        """Whether a node's name is drawn clear of a node nested in it."""
        a = outer.locator("[data-testid=bio-piece-name]").first.bounding_box()
        b = inner.bounding_box()
        return not (a["x"] < b["x"] + b["width"] and b["x"] < a["x"] + a["width"]
                    and a["y"] < b["y"] + b["height"] and b["y"] < a["y"] + a["height"])

    def test_a_compartment_in_a_compartment_shows_with_or_without_a_membrane_round_them(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()

        # In a cell's compartment, the new compartment is drawn over it.
        cell = self.drop_cell(self.pane_point(0.3, 0.45), "compartment")
        self.drop_piece("compartment", centre(cell.bounding_box()))
        inner = piece(page, "compartment-2")
        expect(inner).to_be_visible()
        assert self.on_top_at_its_centre(inner)
        assert self.name_clear_of(cell, inner)

        # In a bare compartment, then a membrane put round that: the inner one still shows.
        self.drop_piece("compartment", self.pane_point(0.75, 0.45))
        outer = piece(page, "compartment-3")
        expect(outer).to_be_visible()
        self.drop_piece("compartment", centre(outer.bounding_box()))
        inner = piece(page, "compartment-4")
        expect(inner).to_be_visible()
        assert self.on_top_at_its_centre(inner)
        assert self.name_clear_of(outer, inner)
        box = outer.bounding_box()
        self.drop_piece("membrane", (box["x"] + 30, box["y"] + 30))
        expect(page.locator(f'{BIO} .vue-flow__node-bioCell:has([data-site="pieces/compartment-3"])')).to_be_visible()
        wait_until_still(page)
        assert self.on_top_at_its_centre(inner)
        assert self.name_clear_of(piece(page, "compartment-3"), inner)

    def test_delete_takes_a_tube_and_a_process_zone_in_one_press(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        self.drop_piece("compartment", self.pane_point(0.3, 0.4))
        self.drop_piece("compartment", self.pane_point(0.6, 0.3))
        expect(piece(page, "compartment-2")).to_be_visible()
        wait_until_still(page)

        # A tube is its module, drawn as the stretch of vessel a conduit is: one Delete takes both.
        self.drop_piece("tube", centre(piece(page, "compartment").bounding_box()))
        link = page.locator("[data-testid=bio-link]")
        expect(link).to_have_count(1)
        self.delete_at(centre(bound(page, "bioJoint").bounding_box()))
        expect(bound(page, "bioJoint")).to_have_count(0)
        expect(link).to_have_count(0)
        expect(piece(page, "compartment")).to_be_visible()
        self.expect_in_diagram(2)

        # A process zone, empty, goes at once.
        page.locator("[data-testid=library-tab-build]").click()
        self.drop_piece("zone", centre(piece(page, "compartment").bounding_box()))
        zone = page.locator(f"{BIO} .vue-flow__node-bioZone")
        expect(zone).to_have_count(1)
        box = zone.bounding_box()
        self.delete_at((box["x"] + box["width"] - 12, box["y"] + box["height"] - 8))
        expect(zone).to_have_count(0)

    def test_a_compartment_lands_where_its_preview_showed(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        target = self.pane_point(0.4, 0.4)
        tile = centre(palette_piece(page, "compartment").bounding_box())
        page.mouse.move(*tile)
        page.mouse.down()
        page.mouse.move(*target, steps=20)
        ghost = page.locator(".bio-piece-preview__ghost").first
        expect(ghost).to_be_visible()
        shown = ghost.bounding_box()
        page.mouse.up()
        # Not fitted to it afterwards: it stays where it was shown.
        compartment = piece(page, "compartment")
        expect(compartment).to_be_visible()
        wait_until_still(page)
        placed = compartment.bounding_box()
        for key in ("x", "y", "width", "height"):
            self.assertAlmostEqual(placed[key], shown[key], delta=3, msg=key)

    def test_process_zones_in_a_compartment_keep_their_size_and_clear_of_each_other(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        self.drop_piece("compartment", self.pane_point(0.4, 0.4))
        compartment = piece(page, "compartment")
        expect(compartment).to_be_visible()
        zones = page.locator(f"{BIO} .vue-flow__node-bioZone")
        self.drop_piece("zone", centre(compartment.bounding_box()))
        expect(zones).to_have_count(1)
        self.drop_piece("zone", centre(compartment.bounding_box()))
        expect(zones).to_have_count(2)
        wait_until_still(page)

        def apart(a, b):
            return (
                a["x"] + a["width"] <= b["x"] + 1
                or b["x"] + b["width"] <= a["x"] + 1
                or a["y"] + a["height"] <= b["y"] + 1
                or b["y"] + b["height"] <= a["y"] + 1
            )

        first, second = zones.nth(0), zones.nth(1)
        self.assertTrue(apart(first.bounding_box(), second.bounding_box()))

        # The first made as small as it goes from its corner: it keeps the room its row needs, and the second keeps
        # clear of it.
        before = first.bounding_box()
        first.hover()
        corner = centre(first.locator("[data-testid=bio-piece-resize]").first.bounding_box())
        page.mouse.move(*corner)
        page.mouse.down()
        page.mouse.move(before["x"] + 4, before["y"] + 4, steps=8)
        page.mouse.up()
        wait_until_still(page)
        after = first.bounding_box()
        self.assertAlmostEqual(after["height"], before["height"], delta=2)
        self.assertGreater(after["width"], 60)
        self.assertTrue(apart(after, second.bounding_box()))
        outer = compartment.bounding_box()
        for zone in (after, second.bounding_box()):
            self.assertGreaterEqual(zone["y"] + zone["height"], outer["y"])
            self.assertLessEqual(zone["y"] + zone["height"], outer["y"] + outer["height"] + 1)

    def test_the_build_palette_joins_two_compartments_with_a_tube(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()

        # Two compartments on the view, side by side.
        self.drop_piece("compartment", self.pane_point(0.3, 0.4))
        first = piece(page, "compartment")
        expect(first).to_be_visible()
        self.drop_piece("compartment", self.pane_point(0.6, 0.3))
        second = piece(page, "compartment-2")
        expect(second).to_be_visible()
        wait_until_still(page)
        one, two = first.bounding_box(), second.bounding_box()
        assert two["x"] > one["x"] + one["width"], (one, two)

        # A tube dropped on the first joins it to the nearest other, with a new module in it named for it, drawn as
        # the stretch of vessel a conduit is.
        self.drop_piece("tube", centre(one))
        link = page.locator("[data-testid=bio-link]")
        expect(link).to_have_count(1)
        held = bound(page, "bioJoint").filter(has_text="Tube")
        expect(held).to_have_count(1)
        expect(held.locator("[data-testid=bio-conduit]")).to_have_count(1)

        # A library module dropped on the tube's room takes the new one's place.
        page.locator("[data-testid=library-tab-modules]").click()
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        wait_until_still(page)
        self.drop_module(0, centre(held.bounding_box()))
        expect(link).to_have_count(1)
        expect(held).to_have_count(0)
        expect(bound(page, "bioJoint")).to_have_count(1)

        # A compartment dragged takes its end of the tube along, and one step back puts it where it was.
        two = second.bounding_box()
        self.drag((two["x"] + two["width"] - 30, two["y"] + two["height"] - 20), (0, 160))
        wait_until_still(page)
        self.assertGreater(second.bounding_box()["y"] - two["y"], 120)
        undo(page)
        wait_until_still(page)
        self.assert_moved(two, second.bounding_box(), (0, 0), delta=2)

    def test_the_build_palette_joins_two_cells_with_a_gap_junction(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()

        first = self.drop_cell(self.pane_point(0.3, 0.4), "compartment")
        one = first.bounding_box()
        second = self.drop_cell((one["x"] + one["width"] * 1.9, one["y"] + one["height"] / 2), "compartment-2")
        wait_until_still(page)
        self.butt_against(first, second)
        one = first.bounding_box()

        # A tube between two touching cells asks how it joins them; as a gap junction, it has a new module on it named for it.
        self.drop_piece("tube", centre(one))
        dialog = page.locator(".p-dialog").filter(has_text="Join two cells")
        expect(dialog).to_be_visible()
        dialog.get_by_role("button", name="Gap junction", exact=True).click()
        link = page.locator("[data-testid=bio-link]")
        expect(link).to_have_count(1)
        expect(page.locator(BIO).get_by_text("Gap_junction", exact=True)).to_be_visible()
        expect(page.locator("[data-testid=bio-bridge]")).to_have_count(0)

        # The cell's menu takes it away again with its module, unasked, as nothing else goes with it.
        self.piece_menu("compartment", "Remove", "Gap_junction")
        expect(link).to_have_count(0)
        expect(page.locator(".p-dialog")).to_have_count(0)
        expect(page.locator(BIO).get_by_text("Gap_junction", exact=True)).to_have_count(0)


    def test_a_bridge_between_two_cells_is_an_open_channel_and_the_choice_is_remembered(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()

        first = self.drop_cell(self.pane_point(0.25, 0.4), "compartment")
        one = first.bounding_box()
        second = self.drop_cell((one["x"] + one["width"] * 1.9, one["y"] + one["height"] / 2), "compartment-2")
        wait_until_still(page)
        # A bridge's channel needs the cells to face each other along enough of their sides.
        for cell in (first, second):
            self.grow_taller(cell, 120)
        one = first.bounding_box()
        asked = page.locator(".p-dialog").filter(has_text="Join two cells")
        bridge = page.locator("[data-testid=bio-bridge]")

        # Between cells apart, a tube is a bridge, asking nothing: an open channel walled by membrane across the gap.
        self.drop_piece("tube", centre(one))
        expect(bridge).to_have_count(1)
        expect(asked).to_have_count(0)
        expect(page.locator(BIO).get_by_text("Bridge", exact=True)).to_be_visible()
        channel, two = bridge.bounding_box(), second.bounding_box()
        assert channel["x"] < one["x"] + one["width"] and channel["x"] + channel["width"] > two["x"], (channel, one, two)
        undo(page)
        expect(bridge).to_have_count(0)

        # Between touching cells it asks; chosen as a bridge and remembered, it is drawn as the joint where they meet.
        self.butt_against(first, second)
        self.drop_piece("tube", centre(first.bounding_box()))
        expect(asked).to_be_visible()
        asked.get_by_text("Remember this choice").click()
        asked.get_by_role("button", name="Bridge", exact=True).click()
        expect(asked).to_be_hidden()
        expect(page.locator(BIO).get_by_text("Bridge", exact=True)).to_be_visible()
        expect(page.locator("[data-testid=bio-link]")).to_have_count(1)

        # The next is a bridge too, without asking: the choice is now the setting's.
        undo(page)
        expect(page.locator("[data-testid=bio-link]")).to_have_count(0)
        self.drop_piece("tube", centre(first.bounding_box()))
        expect(page.locator(BIO).get_by_text("Bridge", exact=True)).to_be_visible()
        expect(asked).to_have_count(0)
        stored = page.evaluate("() => JSON.parse(localStorage.getItem('phlynx-settings')).bioCellTube")
        self.assertEqual(stored, "bridge")
    def test_the_build_palette_places_a_template_with_new_modules_to_replace(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()

        # A plain cell from the palette comes with a new module inside it and one for its membrane, in one step.
        pane = page.locator(f"{BIO} .vue-flow__pane")
        box = pane.bounding_box()
        page.locator("[data-testid=bio-palette-template][data-template=cell]").drag_to(
            pane, target_position={"x": box["width"] * 0.4, "y": box["height"] * 0.4}
        )
        expect(bound(page, "bioCell")).to_have_count(1)
        # Named for the cell and its membrane, so the cell keeps its name.
        expect(bound(page, "bioCell")).to_contain_text("Cell")
        expect(bound(page, "bioMembrane")).to_have_count(1)
        instances = page.locator(f'{BIO_NODE}:not([data-id^="pc:"]):not([data-id^="grip:"])')
        count = instances.count()

        # A library module dropped on the cell takes the new module's place, without asking.
        page.locator("[data-testid=library-tab-modules]").click()
        cell = bound(page, "bioCell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"] + cell["height"] / 2))
        expect(page.locator(".p-dialog")).to_have_count(0)
        expect(bound(page, "bioCell")).not_to_contain_text("Cell")
        expect(instances).to_have_count(count)

        # Undone, the new module is back; undone again, the cell and its new modules go together.
        undo(page)
        expect(bound(page, "bioCell")).to_contain_text("Cell")
        undo(page)
        expect(page.locator(f'{BIO_NODE}[data-id^="pc:"]')).to_have_count(0)
        expect(instances).to_have_count(0)

    def test_a_carried_template_previews_its_pieces(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()

        # Armed, a template shows the pieces it would add where the pointer is, and says what it would add.
        page.locator("[data-testid=bio-palette-template][data-template=cell]").click()
        page.mouse.move(*self.pane_point(0.4, 0.4))
        expect(page.locator("[data-testid=bio-piece-ghost]").first).to_be_visible()
        expect(page.locator("[data-testid=bio-piece-drop-label]")).to_have_text("Add Cell")
        ghost = page.locator("[data-testid=bio-piece-ghost]").first.bounding_box()

        # The preview follows the pointer.
        page.mouse.move(*self.pane_point(0.5, 0.5))
        for _ in range(20):
            moved = page.locator("[data-testid=bio-piece-ghost]").first.bounding_box()
            if moved["x"] > ghost["x"] + 10:
                break
            page.wait_for_timeout(50)
        self.assertGreater(moved["x"], ghost["x"] + 10)

        # Let go of, it is gone.
        page.locator("[data-testid=bio-palette-template][data-template=cell]").click()
        expect(page.locator("[data-testid=bio-piece-preview]")).to_have_count(0)

    def test_a_template_from_the_menu_comes_with_its_modules_as_from_the_build_tab(self):
        page = self.page
        self.open_physiology()
        page.mouse.click(450, 200, button="right")
        menu = page.locator(".p-contextmenu")
        menu.get_by_text("Add Template", exact=True).hover()
        menu.get_by_text("Cell", exact=True).click()
        # A new module on each site that takes one, named for its site, as a drop from the Build tab adds.
        expect(bound(page, "bioCell")).to_have_count(1)
        expect(bound(page, "bioCell")).to_contain_text("Cell")
        expect(bound(page, "bioMembrane")).to_have_count(1)
        expect(empty_piece(page, "cell")).to_have_count(0)

    def test_a_template_dropped_on_a_compartment_goes_in_it(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        self.drop_piece("compartment", self.pane_point(0.4, 0.4))
        host = piece(page, "compartment")
        expect(host).to_be_visible()
        box = host.bounding_box()
        point = (box["x"] + 30, box["y"] + 30)

        # Carried over the compartment, it is the target, outlined, and the label says the template goes in it.
        page.locator("[data-testid=bio-palette-template][data-template=cell]").click()
        page.mouse.move(*point)
        label = page.locator("[data-testid=bio-piece-drop-label]")
        expect(label).to_contain_text("Add Cell in Compartment")
        expect(label).to_contain_text("Compartment grows to fit it")
        expect(page.locator("[data-testid=bio-piece-preview] .bio-piece-preview__target")).to_have_count(1)

        # Dropped, the cell is drawn inside the compartment, which grows round it.
        page.mouse.click(*point)
        cell = bound(page, "bioCell")
        expect(cell).to_have_count(1)
        wait_until_still(page)
        outer, inner = host.bounding_box(), cell.bounding_box()
        self.assertGreaterEqual(inner["x"], outer["x"])
        self.assertGreaterEqual(inner["y"], outer["y"])
        self.assertLessEqual(inner["x"] + inner["width"], outer["x"] + outer["width"])
        self.assertLessEqual(inner["y"] + inner["height"], outer["y"] + outer["height"])

        # Off any compartment, a template still goes on the canvas.
        page.locator("[data-testid=bio-palette-template][data-template=cell]").click()
        page.mouse.move(*self.pane_point(0.85, 0.2))
        expect(page.locator("[data-testid=bio-piece-drop-label]")).to_have_text("Add Cell")
        expect(page.locator("[data-testid=bio-piece-preview] .bio-piece-preview__target")).to_have_count(0)

    def test_the_build_palette_puts_an_organelle_inside_a_cell(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        cell = self.drop_cell(self.pane_point(0.5, 0.4), "compartment")
        before = cell.bounding_box()

        # A membrane dropped in the cell's cytoplasm is refused: it has a membrane already.
        nodes = page.locator(BIO_NODE).count()
        self.drop_piece("membrane", centre(before))
        wait_until_still(page)
        expect(page.locator(BIO_NODE)).to_have_count(nodes)

        # Dropped on a compartment inside the cell, it encloses it: an organelle, and the cell grows to hold it.
        organelle = self.drop_cell(centre(before), "compartment-2")
        name = organelle.locator("[data-testid=bio-piece-name]")
        expect(name).to_have_text("Compartment_2")
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        wait_until_still(page)
        outer, inner = cell.bounding_box(), organelle.bounding_box()
        assert outer["x"] < inner["x"] and inner["x"] + inner["width"] < outer["x"] + outer["width"], (outer, inner)
        assert outer["y"] < inner["y"] and inner["y"] + inner["height"] < outer["y"] + outer["height"], (outer, inner)

        # A compartment dropped just inside the cell's bottom side docks against it, inside: a microdomain.
        self.drop_piece("compartment", (outer["x"] + outer["width"] * 0.15, outer["y"] + outer["height"] - 12))
        microdomain = piece(page, "microdomain")
        expect(microdomain).to_be_visible()
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        wait_until_still(page)
        outer, under = cell.bounding_box(), microdomain.bounding_box()
        assert under["y"] > outer["y"] + outer["height"] / 2, (outer, under)

        # A fold dropped by the cell's top side dips in from it.
        self.drop_piece("fold", (outer["x"] + outer["width"] * 0.8, outer["y"] + 10))
        fold = page.locator("[data-testid=bio-fold]")
        expect(fold).to_have_count(1)
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        wait_until_still(page)
        outer, dip = cell.bounding_box(), fold.bounding_box()
        assert abs(dip["y"] - outer["y"]) < 6 and dip["height"] > 0.2 * outer["height"], (outer, dip)
        inner = organelle.bounding_box()

        # A module dropped on the organelle takes the place of the new module in it, not the cell's.
        page.locator("[data-testid=library-tab-modules]").click()
        expect(name).to_have_text("Compartment_2")
        self.drop_module(2, centre(inner))
        expect(name).not_to_have_text("Compartment_2")
        expect(cell.locator("[data-testid=bio-piece-name]").first).to_have_text("Compartment")

    def test_a_process_zone_in_a_cell_runs_along_the_wider_side_of_its_fold(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        cell = self.drop_cell(self.pane_point(0.5, 0.4), "compartment")
        outer = cell.bounding_box()

        # A fold down from the cell's top, a little past its middle.
        self.drop_piece("fold", (outer["x"] + outer["width"] * 0.6, outer["y"] + 10))
        fold = page.locator("[data-testid=bio-fold]")
        expect(fold).to_have_count(1)
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        wait_until_still(page)
        outer = cell.bounding_box()

        # A process zone dropped in the cell stays in its row at the top, but stops short of the fold, on the wider
        # side of it, rather than running across it and out of the cell.
        self.drop_piece("zone", (outer["x"] + outer["width"] * 0.2, outer["y"] + outer["height"] * 0.7))
        zone = page.locator(f"{BIO} .vue-flow__node-bioZone")
        expect(zone).to_have_count(1)
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        wait_until_still(page)
        outer, dip, band = cell.bounding_box(), fold.bounding_box(), zone.bounding_box()
        assert band["y"] < dip["y"] + dip["height"], (dip, band)
        assert band["x"] + band["width"] < dip["x"], (dip, band)
        # It runs all along that side: from its margin in the cell up to the room the fold keeps clear beside it.
        assert band["x"] > outer["x"] and band["x"] - outer["x"] < 80, (outer, band)
        assert dip["x"] - (band["x"] + band["width"]) < 90, (dip, band)

    def test_a_compartments_far_edge_dragged_onto_a_fold_docks_it_there_too(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        cell = self.drop_cell(self.pane_point(0.5, 0.4), "compartment")
        organelle = self.drop_cell(centre(cell.bounding_box()), "compartment-2")
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        wait_until_still(page)

        # The cell made wider, from its corner, for room right of the organelle.
        outer = cell.bounding_box()
        page.mouse.move(outer["x"] + 30, outer["y"] + outer["height"] - 30)
        corner = centre(cell.locator("[data-testid=bio-piece-resize]").first.bounding_box())
        page.mouse.move(*corner)
        page.mouse.down()
        page.mouse.move(corner[0] + 320, corner[1], steps=8)
        page.mouse.up()
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        wait_until_still(page)

        # A fold down from the cell's top, to the right of the organelle and as deep as it.
        outer, inner = cell.bounding_box(), organelle.bounding_box()
        fold_x = (inner["x"] + inner["width"] + outer["x"] + outer["width"]) / 2
        self.drop_piece("fold", (fold_x, outer["y"] + 10))
        fold = page.locator("[data-testid=bio-fold]")
        expect(fold).to_have_count(1)
        grip = page.locator('[data-testid=bio-grip][data-grip="fold"]')
        start = centre(grip.bounding_box())
        page.mouse.move(*start)
        page.mouse.down()
        page.mouse.move(start[0], inner["y"] + inner["height"] * 0.9, steps=8)
        page.mouse.up()
        wait_until_still(page)

        # A compartment against the organelle's right side, outside it.
        inner = organelle.bounding_box()
        self.drop_piece("compartment", (inner["x"] + inner["width"] + 10, inner["y"] + inner["height"] / 2))
        cleft = page.locator(f'{BIO} .vue-flow__node:has([data-site="pieces/compartment-3"])').first
        expect(cleft).to_be_visible()

        # Its far edge's grip, dragged onto the fold's near wall, outlines the fold and says so; let go, it docks
        # there too. The grip is above the membranes, so it can be taken where the compartment runs under the fold.
        reach = page.locator('[data-testid=bio-grip][data-grip="reach"][data-piece="compartment-3"]')
        expect(reach).to_have_count(1)
        start = centre(reach.bounding_box())
        wall = fold.bounding_box()
        page.mouse.move(*start)
        page.mouse.down()
        page.mouse.move(wall["x"] - 4, start[1], steps=10)
        expect(page.locator(".bio-drop-label")).to_have_text(re.compile(r"Also against Fold, round its walls"))
        expect(page.locator("[data-testid=bio-piece-preview] .bio-piece-preview__target")).to_have_count(1)
        page.mouse.up()
        expect(page.locator(".bio-drop-label")).to_have_count(0)

        # Drawn between the two: from the organelle's side to the fold's wall, with no reach grip of its own now.
        expect(reach).to_have_count(0)
        wait_until_still(page)
        inner, gap, wall = organelle.bounding_box(), cleft.bounding_box(), fold.bounding_box()
        assert abs(gap["x"] + gap["width"] - wall["x"]) < 12, (gap, wall)
        assert gap["x"] < inner["x"] + inner["width"], (gap, inner)

        # Detach From takes the fold dock away again, as one undo step.
        cleft.click(button="right")
        page.get_by_role("menuitem", name="Detach From").hover()
        page.get_by_role("menuitem", name="Fold", exact=True).click()
        expect(reach).to_have_count(1)

        # Its far edge dragged to where there is nothing to dock to, midway to the fold, only sets how far it reaches.
        page.wait_for_timeout(300)
        before = cleft.bounding_box()
        start = centre(reach.bounding_box())
        inner, wall = organelle.bounding_box(), fold.bounding_box()
        to = (inner["x"] + inner["width"] + wall["x"]) / 2
        page.mouse.move(*start)
        page.mouse.down()
        page.mouse.move(to, start[1], steps=6)
        expect(page.locator(".bio-drop-label")).to_have_count(0)
        page.mouse.up()
        wait_until_still(page)
        after = cleft.bounding_box()
        assert abs(after["x"] + after["width"] - to) < 6, (to, after)

        # Undone a step at a time: the reach, then the detach.
        undo(page)
        wait_until_still(page)
        assert abs(cleft.bounding_box()["width"] - before["width"]) < 6, (before, cleft.bounding_box())
        undo(page)
        expect(reach).to_have_count(0)

    def test_an_image_goes_only_on_bare_canvas_and_is_only_drawn(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        self.drop_piece("compartment", self.pane_point(0.3, 0.3))
        compartment = piece(page, "compartment")
        expect(compartment).to_be_visible()
        regions = bound(page, "bioRegion")
        expect(regions).to_have_count(1)
        images = page.locator("[data-testid=bio-image]")

        # Dragged onto a compartment, the Image tile is refused; onto bare canvas, it leaves a placeholder.
        self.drop_piece("image", centre(compartment.bounding_box()))
        expect(page.get_by_text("An image goes on bare canvas.").last).to_be_visible()
        expect(images).to_have_count(0)
        self.drop_piece("image", self.pane_point(0.7, 0.6))
        expect(images).to_have_count(1)
        expect(images.first).to_have_attribute("data-empty", "true")
        placeholder = images.first.bounding_box()
        self.assertGreater(placeholder["width"], 100)

        # Its button asks for a picture, which then fills it, keeping its width and taking the picture's shape.
        with page.expect_file_chooser() as chooser:
            images.first.locator("[data-testid=bio-image-choose]").click()
        chooser.value.set_files(files=[{"name": "Heart.png", "mimeType": "image/png", "buffer": png_bytes(80, 40)}])
        expect(images.first.locator("img")).to_have_attribute("src", re.compile(r"^data:image/png;base64,"))
        filled = images.first.bounding_box()
        self.assertAlmostEqual(filled["width"], placeholder["width"], delta=2)
        self.assertAlmostEqual(filled["height"], filled["width"] / 2, delta=2)
        # Only drawn: no module comes with it.
        expect(regions).to_have_count(1)
        self.assertEqual(page.evaluate(SAVED_IMAGES_JS), 1)

        # It is dragged anywhere, even under the compartment, which stays as it was.
        node = page.locator(f"{BIO} .vue-flow__node-bioImage")
        room = compartment.bounding_box()
        before = node.bounding_box()
        self.drag(centre(before), (-200, -100))
        wait_until_still(page)
        after = node.bounding_box()
        self.assertLess(after["x"], before["x"] - 150)
        self.assertEqual(compartment.bounding_box(), room)

        # Delete takes it alone, and undo brings it back with its picture.
        self.delete_at((after["x"] + after["width"] - 6, after["y"] + after["height"] - 6))
        expect(images).to_have_count(0)
        expect(compartment).to_be_visible()
        undo(page)
        expect(images.first.locator("img")).to_have_attribute("src", re.compile(r"^data:image/png;base64,"))

        # The tile clicked, then a click on bare canvas, places another placeholder.
        tile = palette_piece(page, "image")
        tile.click()
        expect(tile).to_have_attribute("aria-pressed", "true")
        page.mouse.click(*self.pane_point(0.5, 0.85))
        expect(images).to_have_count(2)

        # A picture dropped from the desktop on bare canvas is added with it; on the compartment, it is refused.
        page.evaluate(DROP_FILE_JS, [*self.pane_point(0.8, 0.85), "Cell.png", list(png_bytes(rgb=(60, 60, 200)))])
        expect(images).to_have_count(3)
        page.evaluate(DROP_FILE_JS, [*centre(compartment.bounding_box()), "On.png", list(png_bytes())])
        expect(images).to_have_count(3)
        self.assertEqual(page.evaluate(SAVED_IMAGES_JS), 2)

    def test_an_image_takes_a_skin_made_for_images_from_its_menu(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        self.drop_piece("image", self.pane_point(0.5, 0.5))
        image = page.locator("[data-testid=bio-image]")
        expect(image).to_have_attribute("data-empty", "true")
        menu = page.locator(".p-contextmenu")

        def skin_menu():
            image.click(button="right", position={"x": 12, "y": 12})
            menu.get_by_text("Skin", exact=True).hover()

        # Its Skin menu offers the skins made for images, and none for a compartment's inside.
        skin_menu()
        for name in ("None", "Blood vessel", "Heart", "Neuron", "Red blood cell", "Load SVG…"):
            expect(menu.get_by_text(name, exact=True)).to_be_visible()
        expect(menu.get_by_text("Rod outer segment", exact=True)).to_have_count(0)
        menu.get_by_text("Heart", exact=True).click()
        expect(image).to_have_attribute("data-skin", "heart")
        expect(image.locator("[data-testid=bio-skin] image")).to_have_attribute("href", re.compile(r"^data:image/svg"))
        expect(image).not_to_have_attribute("data-empty", "true")

        # An SVG of the user's is loaded for it, and kept among their skins for images.
        skin_menu()
        with page.expect_file_chooser() as chooser:
            menu.get_by_text("Load SVG…", exact=True).click()
        svg = b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 2"><rect width="4" height="2" fill="#3a7"/></svg>'
        chooser.value.set_files(files=[{"name": "Kidney.svg", "mimeType": "image/svg+xml", "buffer": svg}])
        expect(image).to_have_attribute("data-skin", re.compile(r"^local:kidney"))
        skin_menu()
        expect(menu.get_by_text("Kidney", exact=True)).to_be_visible()

        # None leaves the placeholder again; a picture chosen takes the skin's place.
        menu.get_by_text("None", exact=True).click()
        expect(image).to_have_attribute("data-empty", "true")
        skin_menu()
        menu.get_by_text("Heart", exact=True).click()
        expect(image).to_have_attribute("data-skin", "heart")
        image.click(button="right", position={"x": 12, "y": 12})
        with page.expect_file_chooser() as chooser:
            menu.get_by_text("Choose Picture…", exact=True).click()
        chooser.value.set_files(files=[{"name": "Heart.png", "mimeType": "image/png", "buffer": png_bytes()}])
        expect(image.locator("img")).to_have_attribute("src", re.compile(r"^data:image/png;base64,"))
        expect(image).not_to_have_attribute("data-skin", "heart")

    def test_the_build_palette_places_a_template_and_adds_to_its_cell(self):
        page = self.page
        self.open_physiology()
        pane = page.locator(f"{BIO} .vue-flow__pane")
        box = pane.bounding_box()

        # A template dragged from the palette, once opened, lands on the view.
        page.locator("[data-testid=library-tab-build]").click()
        template = page.locator("[data-testid=bio-palette-template]").filter(has_text="Epithelial cell")
        template.drag_to(pane, target_position={"x": box["width"] * 0.35, "y": box["height"] * 0.3})
        cell = piece(page, "cell")
        expect(cell).to_be_visible()
        page.locator(f"{BIO} .vue-flow__controls-zoomout").click()

        # A piece clicked, then a click on the cell, adds it there; the piece is let go.
        zone = palette_piece(page, "zone")
        zone.click()
        expect(zone).to_have_attribute("aria-pressed", "true")
        spot = cell.bounding_box()
        page.mouse.click(spot["x"] + spot["width"] / 2, spot["y"] + spot["height"] * 0.7)
        expect(piece(page, "zone")).to_be_visible()
        expect(zone).to_have_attribute("aria-pressed", "false")

    def open_physiology_with_template(self, name):
        """Open the app, switch to the physiological view and place a template's pieces from the pane's menu, each
        compartment, membrane and tube with its new, empty module."""
        page = self.page
        self.open_physiology()
        add_template(page, name)
        menu = page.locator(".p-contextmenu")
        # The menu fades out over the cell, and would take the first drop.
        expect(menu).to_be_hidden()
        # Room for the whole template.
        page.locator(f"{BIO} .vue-flow__controls-zoomout").click()

    def drag(self, start, offset, release=True):
        """Drag with the mouse from a screen point by an offset, in steps; optionally hold it at the end."""
        page = self.page
        page.mouse.move(*start)
        page.mouse.down()
        for step in range(1, 11):
            page.mouse.move(start[0] + offset[0] * step / 10, start[1] + offset[1] * step / 10)
        if release:
            page.mouse.up()

    def moved(self, before, after):
        """How far a box moved; a drag moves its node a little less than the pointer, which first has to start it."""
        return (after["x"] - before["x"], after["y"] - before["y"])

    def assert_moved(self, before, after, offset, delta=3):
        self.assertAlmostEqual(after["x"] - before["x"], offset[0], delta=delta)
        self.assertAlmostEqual(after["y"] - before["y"], offset[1], delta=delta)

    def choose(self, select, option):
        """Pick an option of a PrimeVue Select by its text, or by its index."""
        page = self.page
        page.locator(f"[data-testid={select}]").click()
        options = page.locator(".p-select-overlay .p-select-option")
        (options.nth(option) if isinstance(option, int) else options.filter(has_text=option).first).click()

    def cancel_editor(self):
        """Close the instance editor a new module opens in, leaving the module as it is."""
        editor = self.page.locator(".module-editor-dialog")
        expect(editor).to_be_visible()
        editor.get_by_role("button", name="Cancel").click()
        expect(editor).to_be_hidden()

    def drop_module(self, index, point):
        """Drag the library's index-th module onto a screen point of the physiological view."""
        page = self.page
        transfer = page.evaluate_handle("() => new DataTransfer()")
        page.locator(LIBRARY_CARD).nth(index).dispatch_event("dragstart", {"dataTransfer": transfer})
        page.evaluate(DRAG_OVER_AND_DROP_JS, [point[0], point[1], transfer])

    def drag_over(self, index, point):
        """Start dragging the library's index-th module and hold it over a screen point."""
        page = self.page
        transfer = page.evaluate_handle("() => new DataTransfer()")
        page.locator(LIBRARY_CARD).nth(index).dispatch_event("dragstart", {"dataTransfer": transfer})
        page.evaluate(DRAG_OVER_JS, [point[0], point[1], transfer])

    # ---------- dropping modules on the pieces' sites -----------

    def test_fitting_the_view_keeps_clear_of_the_library(self):
        page = self.page
        # Narrow enough that the template fills the view.
        page.set_viewport_size({"width": 1000, "height": 900})
        self.open_physiology()
        page.mouse.click(450, 200, button="right")
        menu = page.locator(".p-contextmenu")
        menu.get_by_text("Add Template", exact=True).hover()
        menu.get_by_text("Epithelial cell", exact=True).click()
        expect(piece(page, "cell")).to_be_visible()
        expect(menu).to_be_hidden()
        # The context panel is a library panel too, docked right; the library is the one that isn't.
        library = page.locator(".resizable-library-panel:not(.context-panel) .module-aside").bounding_box()
        edge = library["x"] + library["width"]
        lefts = lambda: page.evaluate(
            "() => [...document.querySelectorAll('.bio-flow .vue-flow__node')].map((n) => n.getBoundingClientRect().x)"
        )
        # Placed, then fitted by the Controls' button: nothing under the library.
        wait_until_still(page)
        self.assertGreaterEqual(min(lefts()), edge)
        page.locator(f"{BIO} .vue-flow__controls-zoomout").click()
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        wait_until_still(page)
        self.assertGreaterEqual(min(lefts()), edge)

    def test_the_drop_target_and_its_label_are_green(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        self.drag_over(0, self.cell_inside())
        green = page.evaluate("""() => {
            const probe = document.createElement('div')
            probe.style.color = 'var(--p-green-600)'
            document.querySelector('.bio-flow-root').append(probe)
            const colour = getComputedStyle(probe).color
            probe.remove()
            return colour
        }""")
        expect(page.locator(".bio-site-prompt--active path")).to_have_css("stroke", green)
        expect(page.locator("[data-testid=bio-drop-label]")).to_have_css("border-top-color", green)
        # The others, such as the cell's membrane band, keep the primary colour.
        idle = page.locator(".bio-site-prompt--membrane path")
        self.assertNotEqual(idle.evaluate("(el) => getComputedStyle(el).stroke"), green)

    def cell_inside(self):
        """A screen point on the epithelial cell's inside, clear of its slots, its process zone and its name."""
        return inside_of(self.page, "cell")

    def test_drop_on_a_cells_inside_then_on_its_membrane_replaces_their_modules(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        active = page.locator(".bio-site-prompt--active")
        cell = piece(page, "cell")
        inside = cell.get_attribute("data-id")

        # On the cell's inside, not a process card: its new, empty module replaced, unasked.
        self.drag_over(0, self.cell_inside())
        expect(active).to_have_class(has_class("bio-site-prompt--cell"))
        self.drop_module(0, self.cell_inside())
        expect(page.locator(f'{BIO_NODE}[data-id="{inside}"]')).to_have_count(0)
        expect(bound(page, "bioCell")).to_have_count(1)
        expect(bound(page, "bioCard")).to_have_count(0)

        # Just inside the outline, between the apical slot and the corner: the cell's membrane.
        wall = bound(page, "bioMembrane").get_attribute("data-id")
        box = bound(page, "bioCell").bounding_box()
        band = (box["x"] + box["width"] * 0.2, box["y"] + 4)
        self.drag_over(1, band)
        expect(active).to_have_class(has_class("bio-site-prompt--membrane"))
        self.drop_module(1, band)
        expect(page.locator(f'{BIO_NODE}[data-id="{wall}"]')).to_have_count(0)
        expect(bound(page, "bioMembrane")).to_have_count(1)
        expect(bound(page, "bioCell")).to_have_count(1)

    def apical_prompts(self, y):
        """The slot prompts on the row at screen height y, left to right: (centre, is spare, has a plus)."""
        prompts = self.page.evaluate("""() => [...document.querySelectorAll('.bio-slot-prompt')].map((g) => {
            const r = g.querySelector('rect').getBoundingClientRect()
            return [r.x + r.width / 2, r.y + r.height / 2, g.classList.contains('bio-slot-prompt--spare'),
                !!g.querySelector('.bio-slot-prompt__plus')]
        })""")
        return sorted(((x, py), spare, plus) for x, py, spare, plus in prompts if abs(py - y) < 2)

    def test_protein_prompts_sit_on_the_proteins_with_a_spare_plus(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        proteins = bound(page, "bioProtein")
        expect(proteins).to_have_count(1)

        # The next goes on the spare slot past the first.
        y = centre(proteins.first.bounding_box())[1]
        self.drag_over(1, centre(proteins.first.bounding_box()))
        (spare, _, _) = self.apical_prompts(y)[-1]
        self.drop_module(1, spare)
        expect(proteins).to_have_count(2)

        # Dragging a third: a prompt on each protein, then one spare with a plus.
        y = centre(proteins.first.bounding_box())[1]
        self.drag_over(2, centre(proteins.first.bounding_box()))
        row = self.apical_prompts(y)
        self.assertEqual([(is_spare, plus) for _, is_spare, plus in row], [(False, False), (False, False), (True, True)])
        drawn = sorted(centre(proteins.nth(i).bounding_box())[0] for i in range(2))
        for (point, _, _), x in zip(row, drawn):
            self.assertAlmostEqual(point[0], x, delta=2)

    def test_drop_modules_on_epithelial_cell_sites_replace_and_undo(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")

        # On the apical facet's slot, along the top of the cell: a membrane protein in that slot.
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        # Centred on the membrane's top, as the cell is drawn once it has refitted round the protein and its name.
        wait_until_still(page)
        protein_box, cell = protein.bounding_box(), piece(page, "cell").bounding_box()
        self.assertAlmostEqual(protein_box["y"] + protein_box["height"] / 2, cell["y"], delta=2)

        # On the apical fluid, clear of the slots: it replaces the fluid's new, empty module, unasked.
        lumen = piece(page, "apical-fluid").bounding_box()
        point = (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3)
        first = self.swap_onto("apical-fluid", 1, point).get_attribute("data-id")

        # Another on the same fluid replaces it, once confirmed, and the one it replaced is deleted.
        self.drop_module(2, point)
        page.get_by_role("button", name="Replace").click()
        expect(piece(page, "apical-fluid")).not_to_have_attribute("data-id", first)
        expect(page.locator(f'{BIO_NODE}[data-id="{first}"]')).to_have_count(0)
        expect(bound(page, "bioCard")).to_have_count(0)

        # One undo takes back the whole replacing drop: the new instance goes, and the first is back.
        undo(page)
        expect(piece(page, "apical-fluid")).to_have_attribute("data-id", first)
        expect(bound(page, "bioProtein")).to_have_count(1)


    def test_dragging_a_cell_with_a_bound_protein_keeps_it_bound(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        lumen = piece(page, "apical-fluid").bounding_box()
        region = self.swap_onto("apical-fluid", 1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        protein = bound(page, "bioProtein")

        # Dragged by its inside, clear of what is in it: the cell moves, and the protein and the fluid move with it.
        box = piece(page, "cell").bounding_box()
        before, lumen = protein.bounding_box(), region.bounding_box()
        self.drag(inside_of(page, "cell"), (120, 60))
        wait_until_still(page)
        expect(protein).to_have_count(1)
        moved = piece(page, "cell").bounding_box()
        offset = self.moved(box, moved)
        self.assertGreater(offset[0], 50)
        self.assert_moved(before, protein.bounding_box(), offset, delta=2)
        self.assert_moved(lumen, region.bounding_box(), offset, delta=2)
        undo(page)
        wait_until_still(page)
        expect(protein).to_have_count(1)
        self.assertAlmostEqual(protein.bounding_box()["x"], before["x"], delta=2)

    def test_a_protein_moved_to_another_facet_joins_that_facets_fluid_instead(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        lumen = piece(page, "apical-fluid").bounding_box()
        apical_region = self.swap_onto("apical-fluid", 1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        blood = piece(page, "basolateral-fluid").bounding_box()
        basolateral_region = self.swap_onto("basolateral-fluid", 2, (blood["x"] + 20, blood["y"] + blood["height"] * 2 / 3))
        apical, basolateral = apical_region.get_attribute("data-id"), basolateral_region.get_attribute("data-id")
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        p = protein.get_attribute("data-id")

        def edge(source, target):
            return page.locator(f'.vue-flow__edge[data-id="{source}--{target}"]')

        def in_diagram(present, absent):
            page.locator("[data-testid=view-mode]").get_by_text("Diagram").click()
            expect(edge(*present)).to_have_count(1)
            expect(edge(*absent)).to_have_count(0)
            page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
            expect(protein).to_have_count(1)

        # On the apical membrane: joined to the lumen, from outside to in.
        in_diagram((apical, p), (basolateral, p))

        # Dragged to the basolateral membrane: the lumen's edge goes and the interstitium's comes, in one step.
        cell = piece(page, "cell").bounding_box()
        start = centre(protein.bounding_box())
        self.drag(start, (cell["x"] + cell["width"] / 2 - start[0], cell["y"] + cell["height"] - start[1]))
        self.assertAlmostEqual(centre(protein.bounding_box())[1], cell["y"] + cell["height"], delta=4)
        in_diagram((basolateral, p), (apical, p))

        # Selected, it shows only its new neighbour's connection.
        protein.click()
        expect(page.locator(f'{BIO} .vue-flow__edge[data-id="{basolateral}--{p}"]')).to_have_count(1)
        expect(page.locator(f'{BIO} .vue-flow__edge[data-id="{apical}--{p}"]')).to_have_count(0)

        undo(page)
        self.assertAlmostEqual(centre(protein.bounding_box())[1], cell["y"], delta=4)
        in_diagram((apical, p), (basolateral, p))

    def test_a_protein_dragged_off_its_membrane_leaves_its_fluid_in_one_undo_step(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        lumen = piece(page, "apical-fluid").bounding_box()
        region = self.swap_onto("apical-fluid", 1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        expect(bound(page, "bioProtein")).to_have_count(1)
        # Followed by its id: off the cell, a module with no annotations is drawn as a card.
        protein = page.locator(f'{BIO_NODE}[data-id="{bound(page, "bioProtein").get_attribute("data-id")}"]')
        joined = page.locator(
            f'.vue-flow__edge[data-id="{region.get_attribute("data-id")}--{protein.get_attribute("data-id")}"]'
        )
        # Measured again: the cell and its fluid refit round the protein and its name.
        wait_until_still(page)
        cell, lumen = piece(page, "cell").bounding_box(), piece(page, "apical-fluid").bounding_box()

        def in_diagram(count):
            page.locator("[data-testid=view-mode]").get_by_text("Diagram").click()
            expect(joined).to_have_count(count)
            page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
            expect(protein).to_have_count(1)

        in_diagram(1)

        # Off the cell, clear of it: no longer joined to the lumen.
        start = centre(protein.bounding_box())
        clear = max(cell["x"] + cell["width"], lumen["x"] + lumen["width"]) + 150
        self.drag(start, (clear - start[0], lumen["y"] - start[1]))
        in_diagram(0)

        # One undo puts it back on the membrane, joined again: the edge's handles change in the same step.
        undo(page)
        self.assertAlmostEqual(centre(protein.bounding_box())[1], cell["y"], delta=4)
        in_diagram(1)

    # ---------- dragging structures and parts -----------

    def test_a_cell_drag_moves_what_is_in_and_against_it_and_a_part_moves_alone(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        expect(bound(page, "bioProtein")).to_have_count(1)
        # Followed by its id: off the cell, a module with no annotations is drawn as a card.
        protein = page.locator(f'{BIO_NODE}[data-id="{bound(page, "bioProtein").get_attribute("data-id")}"]')
        boxes = lambda: [loc.bounding_box() for loc in (piece(page, "cell"), piece(page, "apical-fluid"), protein)]

        # By the cell's body, clear of its protein: everything in and against it moves along as it is dragged, and
        # stays where it is dropped.
        before = boxes()
        body = before[0]
        self.drag(inside_of(page, "cell"), (90, 50), release=False)
        offset = self.moved(before[0], piece(page, "cell").bounding_box())
        self.assertGreater(offset[0], 50)
        self.assert_moved(before[1], piece(page, "apical-fluid").bounding_box(), offset)
        page.mouse.up()
        wait_until_still(page)
        for old, new in zip(before, boxes()):
            self.assert_moved(old, new, offset)
        # One step, which one undo takes back.
        undo(page)
        wait_until_still(page)
        self.assert_moved(before[1], piece(page, "apical-fluid").bounding_box(), (0, 0))

        # A protein is a part: dragged off its cell, it moves alone.
        before = boxes()
        start = centre(protein.bounding_box())
        self.drag(start, (0, -260))
        expect(protein).to_have_count(1)
        wait_until_still(page)
        # The cell stays where it is; it refits its top side, now with no protein on it.
        self.assertAlmostEqual(boxes()[0]["x"], before[0]["x"], delta=3)
        self.assertLess(protein.bounding_box()["y"], before[2]["y"] - 150)

        # Off it, it stays put while the cell is dragged.
        before = boxes()
        body = before[0]
        self.drag((body["x"] + 30, body["y"] + body["height"] - 40), (80, 40))
        wait_until_still(page)
        offset = self.moved(before[0], piece(page, "cell").bounding_box())
        self.assertGreater(offset[0], 40)
        self.assert_moved(before[1], piece(page, "apical-fluid").bounding_box(), offset)
        self.assert_moved(before[2], protein.bounding_box(), (0, 0))

    def alt_drag(self, start, offset, release=True):
        """Drag with Alt held, which lifts a piece out of where it is; held at the end, Alt is still down."""
        self.page.keyboard.down("Alt")
        self.drag(start, offset, release)
        if release:
            self.page.keyboard.up("Alt")

    def test_alt_and_a_drag_lift_a_piece_out_to_stand_or_dock_somewhere_else(self):
        page = self.page
        self.open_physiology_with_template("Cardiomyocyte")
        label = page.locator("[data-testid=bio-piece-drop-label]")
        cell = lambda: piece(page, "myocyte").bounding_box()
        organelle = lambda: piece(page, "sr").bounding_box()
        fluid = lambda: piece(page, "extracellular").bounding_box()
        right_of = lambda box: box["x"] + box["width"]

        # An organelle lifted out of its cell: it stays where it is while carried, its label saying where it would
        # go, and stands on the view once let go of, as one step.
        before = organelle()
        self.assertLess(right_of(before), right_of(cell()))
        start = (before["x"] + 30, before["y"] + before["height"] - 40)
        self.alt_drag(start, (right_of(cell()) + 60 - before["x"], 0), release=False)
        expect(label).to_contain_text("Moves Sarcoplasmic reticulum out, onto the view")
        self.assert_moved(before, organelle(), (0, 0))
        page.mouse.up()
        page.keyboard.up("Alt")
        expect(label).to_have_count(0)
        wait_until_still(page)
        self.assertGreater(organelle()["x"], right_of(cell()))
        undo(page)
        wait_until_still(page)
        self.assert_moved(before, organelle(), (0, 0))

        # Without Alt, it only moves within its cell, which grows to hold it.
        self.drag(start, (right_of(cell()) + 60 - before["x"], 0))
        wait_until_still(page)
        self.assertLess(right_of(organelle()), right_of(cell()))
        undo(page)
        wait_until_still(page)

        # A fluid along a whole side has nowhere to go by a drag alone; lifted, it is detached, to stand on its own.
        before = fluid()
        overlap = before["y"] + before["height"] - cell()["y"]
        hold = (before["x"] + 30, before["y"] + before["height"] * 0.6)
        self.drag(hold, (0, -120))
        wait_until_still(page)
        self.assert_moved(before, fluid(), (0, 0))
        self.alt_drag(hold, (0, -160), release=False)
        expect(label).to_contain_text("Detaches Extracellular space, to stand on its own")
        page.mouse.up()
        page.keyboard.up("Alt")
        wait_until_still(page)
        self.assertLess(fluid()["y"], before["y"] - 100)

        # Carried back to the cell's top side, it is docked there again.
        free = fluid()
        hold = (free["x"] + 30, free["y"] + free["height"] * 0.6)
        top = cell()
        self.alt_drag(hold, (top["x"] + top["width"] * 0.3 - hold[0], top["y"] - 5 - hold[1]), release=False)
        expect(label).to_contain_text("Docks Extracellular space against Sarcolemma’s top, outside")
        page.mouse.up()
        page.keyboard.up("Alt")
        wait_until_still(page)
        docked = fluid()
        self.assertAlmostEqual(docked["y"] + docked["height"] - cell()["y"], overlap, delta=3)

        # The menu does the same without a drag: Detach, and Move Out of what a piece stands in.
        self.piece_menu("extracellular", "Detach")
        wait_until_still(page)
        expect(piece(page, "extracellular")).to_be_visible()
        undo(page)
        self.piece_menu("sr", "Move Out of Cardiomyocyte")
        wait_until_still(page)
        self.assertGreater(organelle()["x"], right_of(cell()))

    def add_zone(self):
        """Click the palette's process zone, then the cell's lower half: a zone in the cell. Back on the modules."""
        page = self.page
        page.locator("[data-testid=library-tab-build]").click()
        palette_piece(page, "zone").click()
        box = piece(page, "cell").bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.7)
        expect(empty_piece(page, "zone")).to_have_count(1)
        page.locator("[data-testid=library-tab-modules]").click()

    def zone_corner(self):
        """A point in the process zone, by its corner, clear of the cell's hint in the middle."""
        box = piece(self.page, "zone").bounding_box()
        return (box["x"] + 30, box["y"] + 30)

    def test_a_plain_cell_takes_its_processes_and_regions_along(self):
        page = self.page
        self.open_physiology_with_template("Cell")

        # A compartment against the cell's top side, and a process zone inside it.
        page.locator("[data-testid=library-tab-build]").click()
        box = piece(page, "cell").bounding_box()
        self.drop_piece("compartment", (box["x"] + box["width"] / 2, box["y"] - 12))
        region = bound(page, "bioRegion")
        expect(region).to_have_count(1)
        self.add_zone()

        # A module on the compartment, in place of its new one, and a process in the zone, drawn as its symbol.
        name = page.locator(LIBRARY_CARD).nth(1).inner_text().split("\n")[0]
        self.drop_module(1, centre(piece(page, "compartment").bounding_box()))
        expect(region).to_have_count(1)
        expect(region).to_contain_text(name)
        self.drop_module(0, self.zone_corner())
        card = bound(page, "bioProtein")
        expect(card).to_have_count(1)
        cell = piece(page, "cell")
        box, held = cell.bounding_box(), card.bounding_box()
        self.assertGreater(held["x"], box["x"])
        self.assertLess(held["x"] + held["width"], box["x"] + box["width"])

        # The cell dragged: the process and the region come along as it goes, and stay with it once dropped.
        before = [loc.bounding_box() for loc in (cell, card, region)]
        self.drag((box["x"] + box["width"] - 40, box["y"] + box["height"] - 40), (120, 60), release=False)
        offset = self.moved(before[0], cell.bounding_box())
        self.assertGreater(offset[0], 80)
        self.assert_moved(before[2], region.bounding_box(), offset)
        page.mouse.up()
        wait_until_still(page)
        for old, new in zip(before, [loc.bounding_box() for loc in (cell, card, region)]):
            self.assert_moved(old, new, offset)

    def test_drop_on_a_plain_cells_membrane_and_inside(self):
        page = self.page
        self.open_physiology_with_template("Cell")
        cell = piece(page, "cell")
        inside_module, wall = cell.get_attribute("data-id"), bound(page, "bioMembrane").get_attribute("data-id")
        active = page.locator(".bio-site-prompt--active")
        label = page.locator("[data-testid=bio-drop-label]")

        # Just inside the outline, clear of its slots: the cell's membrane.
        box = cell.bounding_box()
        band = (box["x"] + box["width"] * 0.12, box["y"] + 3)
        self.drag_over(1, band)
        expect(active).to_have_class(has_class("bio-site-prompt--membrane"))
        expect(label).to_contain_text("(membrane)")
        self.drop_module(1, band)
        expect(bound(page, "bioMembrane")).not_to_have_attribute("data-id", wall)
        # Another dropped there would replace it.
        self.drag_over(0, band)
        expect(active).to_have_class(has_class("bio-site-prompt--membrane"))
        expect(label).to_contain_text("Replaces")

        # Well inside: the cell's inside.
        box = cell.bounding_box()
        inside = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        self.drag_over(0, inside)
        expect(active).to_have_class(has_class("bio-site-prompt--cell"))
        expect(label).to_contain_text("(intracellular space)")
        self.drop_module(0, inside)
        expect(cell).not_to_have_attribute("data-id", inside_module)
        expect(bound(page, "bioCard")).to_have_count(0)
        # Each drop is one step, which puts back the new, empty module it replaced.
        undo(page)
        expect(cell).to_have_attribute("data-id", inside_module)
        expect(bound(page, "bioMembrane")).not_to_have_attribute("data-id", wall)
        undo(page)
        expect(bound(page, "bioMembrane")).to_have_attribute("data-id", wall)

    def drop_named(self, name, point):
        """Drag the library module by its name onto a screen point of the physiological view."""
        page = self.page
        card = page.locator(LIBRARY_CARD).filter(has_text=f"{name}:default").first
        if not card.is_visible():
            page.locator(".mlc__group-header").filter(has_text=re.compile(re.escape(name), re.IGNORECASE)).first.click()
        expect(card).to_be_visible()
        transfer = page.evaluate_handle("() => new DataTransfer()")
        card.dispatch_event("dragstart", {"dataTransfer": transfer})
        page.evaluate(DRAG_OVER_AND_DROP_JS, [point[0], point[1], transfer])
        card.dispatch_event("dragend", {"dataTransfer": transfer})

    def test_drag_existing_nodes_into_a_plain_cell(self):
        page = self.page
        # The toy porter, annotated as a transporter, and the toy pool, not annotated.
        page.goto(BASE_URL)
        expect(page.locator(".vue-flow__pane").first).to_be_visible(timeout=60000)
        import_files(page, "CellML File", [toy(name) for name in TOY_MATHS])
        import_files(page, "Module Annotations", [toy("porter.ttl")])
        page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
        expect(page.locator(f"{BIO} .vue-flow__pane")).to_be_visible()
        add_template(page, "Cell")
        menu = page.locator(".p-contextmenu")
        cell = piece(page, "cell")
        expect(cell).to_be_visible()
        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()
        page.locator(f"{BIO} .vue-flow__controls-zoomout").click()
        box = cell.bounding_box()

        # The transporter dropped off the cell lands in the tray, in no membrane yet; dragged onto the cell's top
        # slot it goes in the membrane there.
        self.drop_named("porter", (box["x"] + box["width"] + 200, box["y"] + 40))
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        expect(protein.locator("[data-testid=bio-protein]")).to_have_class(has_class("bio-protein--unplaced"))
        # Adding it can refit the view.
        box = cell.bounding_box()
        # Dropped on the cell's outline by a corner, clear of its slots, a protein never becomes its membrane.
        start = centre(protein.bounding_box())
        corner = (box["x"] + box["width"] * 0.12, box["y"] + 3)
        wall = bound(page, "bioMembrane").get_attribute("data-id")
        self.drag(start, (corner[0] - start[0], corner[1] - start[1]))
        expect(bound(page, "bioProtein")).to_have_count(1)
        expect(bound(page, "bioMembrane")).to_have_attribute("data-id", wall)
        start = centre(protein.bounding_box())
        target = (box["x"] + box["width"] / 2, box["y"])
        self.drag(start, (target[0] - start[0], target[1] - start[1]))
        expect(protein.locator("[data-testid=bio-protein]")).not_to_have_class(has_class("bio-protein--unplaced"))
        box = cell.bounding_box()
        at = centre(protein.bounding_box())
        self.assertAlmostEqual(at[1], box["y"], delta=3)
        self.assertAlmostEqual(at[0], box["x"] + box["width"] / 2, delta=3)
        # It is the cell's now: it moves with it.
        self.drag((box["x"] + box["width"] - 40, box["y"] + box["height"] - 40), (60, 30))
        wait_until_still(page)
        moved = cell.bounding_box()
        self.assertAlmostEqual(centre(protein.bounding_box())[0] - at[0], moved["x"] - box["x"], delta=3)

        # A card dragged into the cell's process zone: a process inside it, drawn as its symbol, as one step.
        self.add_zone()
        box = cell.bounding_box()
        self.drop_named("pool", (box["x"] + box["width"] + 200, box["y"] + 40))
        expect(bound(page, "bioCard")).to_have_count(1)
        card = page.locator(f'{BIO_NODE}[data-id="{bound(page, "bioCard").get_attribute("data-id")}"]')
        before = card.bounding_box()
        start = centre(before)
        target = self.zone_corner()
        self.drag(start, (target[0] - start[0], target[1] - start[1]))
        expect(bound(page, "bioCard")).to_have_count(0)
        expect(card).to_have_class(has_class("vue-flow__node-bioProtein"))
        box = cell.bounding_box()
        inside = card.bounding_box()
        self.assertGreater(inside["x"], box["x"])
        self.assertLess(inside["x"] + inside["width"], box["x"] + box["width"])
        undo(page)
        expect(card).to_have_class(has_class("vue-flow__node-bioCard"))
        wait_until_still(page)
        self.assertAlmostEqual(card.bounding_box()["x"], before["x"], delta=3)

    # ---------- the pieces' menus -----------

    def piece_menu(self, path, *labels):
        """Right-click a piece and follow its menu through the labels, clicking the last."""
        page = self.page
        expect(page.locator(".p-dialog-mask")).to_have_count(0)
        box = piece(page, path).bounding_box()
        page.mouse.click(box["x"] + 30, box["y"] + box["height"] * 0.6, button="right")
        menu = page.locator(".p-contextmenu")
        for label in labels[:-1]:
            menu.get_by_text(label, exact=True).hover()
        menu.get_by_text(labels[-1], exact=True).click()
        expect(menu).to_be_hidden()

    def test_a_rod_is_a_cell_with_its_segments_drawn_in_and_proteins_along_it(self):
        page = self.page
        self.open_physiology_with_template("Rod photoreceptor")
        fit = page.locator(f"{BIO} .vue-flow__controls-fitview")
        fit.click()
        wait_until_still(page)
        rod = page.locator(f'{BIO_NODE}[data-id="pc:plasma-membrane"]')
        # A cell like any other, lying on its side, with each segment's own artwork in it.
        expect(rod.locator("[data-testid=bio-skin]")).to_have_count(0)
        expect(rod.locator("[data-testid=bio-bilayer]")).to_have_count(1)
        for segment in ("outer-segment", "inner-segment"):
            expect(piece(page, segment).locator("[data-testid=bio-skin]")).to_have_count(1)
        box = rod.bounding_box()
        assert box["width"] > 2 * box["height"], box
        # Its segments are spaces of their own, the outer left of the inner, and the space outside lies round it on
        # every side.
        outer, inner = piece(page, "outer-segment").bounding_box(), piece(page, "inner-segment").bounding_box()
        assert centre(outer)[0] < centre(inner)[0], (outer, inner)
        around = piece(page, "extracellular").bounding_box()
        assert around["x"] < box["x"] and around["y"] < box["y"], (around, box)
        assert around["x"] + around["width"] > box["x"] + box["width"] and around["y"] + around["height"] > box["y"] + box["height"], (around, box)
        # Proteins dropped on the membrane above and below the outer segment go on its stretches there.
        for edge in ("os-upper", "os-lower"):
            count = bound(page, "bioProtein").count()
            outer = piece(page, "outer-segment").bounding_box()
            y = outer["y"] if edge == "os-upper" else outer["y"] + outer["height"]
            self.drop_module(0, (outer["x"] + outer["width"] / 2, y))
            expect(bound(page, "bioProtein")).to_have_count(count + 1)
            fit.click()
            wait_until_still(page)
            box = rod.bounding_box()
        sites = page.evaluate("""() => {
            let c = [...document.querySelectorAll('.vue-flow')].find((el) => !el.closest('.bio-flow')).__vueParentComponent
            while (c && !c.exposed?.nodes) c = c.parent
            return c.exposed.nodes.value.map((n) => n.data.bioView?.site).filter(Boolean).sort()
        }""")
        spans = [site for site in sites if site.startswith("pieces/plasma-membrane.")]
        self.assertEqual(spans, ["pieces/plasma-membrane.os-lower", "pieces/plasma-membrane.os-upper"])

    def test_draw_a_cell_with_a_skin_and_take_it_away(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        cell = piece(page, "cell")
        art = (
            b'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60">'
            b'<script>window.skinRan = true</script>'
            b'<ellipse cx="50" cy="30" rx="40" ry="20" fill="#7c3aed" onclick="window.skinRan = true"/></svg>'
        )
        # The cell's Skin menu loads an SVG file and draws the cell with it, as an image: nothing in it runs.
        box = cell.bounding_box()
        page.mouse.click(box["x"] + 30, box["y"] + box["height"] * 0.6, button="right")
        menu = page.locator(".p-contextmenu")
        menu.get_by_text("Skin", exact=True).hover()
        with page.expect_file_chooser() as chooser:
            menu.get_by_text("Load SVG…", exact=True).click()
        chooser.value.set_files({"name": "Nucleus art.svg", "mimeType": "image/svg+xml", "buffer": art})
        skin = cell.locator("[data-testid=bio-skin]")
        expect(skin).to_have_count(1)
        href = skin.get_attribute("href")
        assert href.startswith("data:image/svg+xml"), href[:40]
        assert "script" not in href and "onclick" not in href, href
        assert page.evaluate("window.skinRan") is None

        # It is one of the workspace's skins now, to fill the cell differently or take away.
        self.piece_menu("cell", "Skin", "Fill", "Cover")
        expect(skin).to_have_attribute("preserveAspectRatio", "xMidYMid slice")
        self.piece_menu("cell", "Skin", "None")
        expect(skin).to_have_count(0)
        self.piece_menu("cell", "Skin", "Nucleus art")
        expect(skin).to_have_count(1)

    def swap_onto(self, path, index, point=None):
        """Drop the library's index-th module on a compartment, membrane or tube, in place of its new, empty module,
        which goes unasked. Gives the piece's node, now the dropped module's."""
        page = self.page
        node = piece(page, path)
        placeholder = node.get_attribute("data-id")
        self.drop_module(index, point or centre(node.bounding_box()))
        expect(page.locator(f'{BIO_NODE}[data-id="{placeholder}"]')).to_have_count(0)
        expect(page.locator(".p-dialog")).to_have_count(0)
        expect(piece(page, path)).to_have_count(1)
        return piece(page, path)

    def test_remove_a_piece_deletes_its_module_and_undo(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        region = self.swap_onto("paracellular", 1)
        module = region.get_attribute("data-id")

        # Removing the paracellular space takes its module with it, unasked, as nothing else goes.
        box = region.bounding_box()
        self.menu_at(centre(box), "Remove")
        expect(page.locator(".p-dialog")).to_have_count(0)
        expect(page.locator(f'{BIO_NODE}[data-id="{module}"]')).to_have_count(0)
        expect(page.locator(f'{BIO_NODE}:has([data-site="pieces/paracellular"])')).to_have_count(0)

        # The cell's process zone, with nothing on it: gone at once.
        self.piece_menu("cell", "Remove", "Metabolism")
        expect(page.locator(f'{BIO_NODE}:has([data-site="pieces/metabolism"])')).to_have_count(0)

        # Each is one step.
        undo(page)
        expect(piece(page, "metabolism")).to_have_count(1)
        undo(page)
        expect(piece(page, "paracellular")).to_have_attribute("data-id", module)

    # ---------- renaming instances -----------

    def test_rename_an_instance_from_the_physiology_view(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        lumen = piece(page, "apical-fluid").bounding_box()
        region = self.swap_onto("apical-fluid", 1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        protein = bound(page, "bioProtein")
        taken = protein.locator(".bio-protein__label").inner_text().strip()
        dialog = page.locator("[data-testid=bio-node-rename]")
        field = page.locator("#bio-node-rename-input")
        confirm = page.locator("[data-testid=bio-node-rename-confirm]")

        box = region.bounding_box()
        self.menu_at((box["x"] + 30, box["y"] + 20), "Rename…")
        expect(dialog).to_be_visible()
        # Another instance's name is refused.
        field.fill(taken)
        expect(dialog).to_contain_text("already exists")
        expect(confirm).to_be_disabled()
        # A free one, sanitised as the diagram does, names it there and here, as one step.
        field.fill("apical lumen")
        expect(confirm).to_be_enabled()
        confirm.click()
        expect(dialog).to_have_count(0)
        expect(region).to_contain_text("apical_lumen")
        page.locator("[data-testid=view-mode]").get_by_text("Diagram").click()
        expect(page.locator(".vue-flow__node").filter(has_text="apical_lumen")).to_have_count(1)
        page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
        undo(page)
        expect(region).not_to_contain_text("apical_lumen")

    # ---------- new modules from the physiological view -----------

    def menu_at(self, point, label):
        """Right-click a screen point and choose a menu item."""
        page = self.page
        expect(page.locator(".p-dialog-mask")).to_have_count(0)
        page.mouse.click(*point, button="right")
        menu = page.locator(".p-contextmenu")
        expect(menu).to_be_visible()
        menu.get_by_text(label, exact=True).click()
        expect(menu).to_be_hidden()

    def test_new_module_here_only_on_a_slot(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")

        # On the cell's apical slot: a new protein there, as one step, opened in the editor to write its math.
        cell = piece(page, "cell").bounding_box()
        self.menu_at((cell["x"] + cell["width"] / 2, cell["y"] + 2), "New Module Here")
        self.cancel_editor()
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        self.assertAlmostEqual(centre(protein.bounding_box())[1], piece(page, "cell").bounding_box()["y"], delta=3)
        undo(page)
        expect(protein).to_have_count(0)

        # Not on the lumen: a compartment always has its module, to be replaced by a drop.
        lumen = piece(page, "apical-fluid").bounding_box()
        page.mouse.click(lumen["x"] + 30, lumen["y"] + 20, button="right")
        menu = page.locator(".p-contextmenu")
        expect(menu).to_be_visible()
        expect(menu.get_by_text("Rename…", exact=True)).to_be_visible()
        expect(menu.get_by_text("New Module Here", exact=True)).to_have_count(0)

    # ---------- deleting -----------

    def protein_by_its_lumen(self):
        """An epithelial cell with a protein on its apical slot, joined to the module on its lumen: (protein, edge id)."""
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        lumen = piece(page, "apical-fluid").bounding_box()
        region = self.swap_onto("apical-fluid", 1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        return protein, f'{region.get_attribute("data-id")}--{protein.get_attribute("data-id")}'

    def in_diagram(self, edge_id, count, kept):
        """Check in the diagram how many of an edge there are, then come back to a kept node."""
        page = self.page
        page.locator("[data-testid=view-mode]").get_by_text("Diagram").click()
        expect(page.locator(f'.vue-flow__edge[data-id="{edge_id}"]')).to_have_count(count)
        page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
        expect(kept).to_have_count(1)

    def test_delete_a_protein_by_key_and_by_menu_and_undo_each(self):
        page = self.page
        protein, edge_id = self.protein_by_its_lumen()
        p = protein.get_attribute("data-id")
        mine = page.locator(f'{BIO_NODE}[data-id="{p}"]')
        region = piece(page, "apical-fluid")
        self.in_diagram(edge_id, 1, mine)

        # Delete: gone from the workspace with its edge, and one undo brings both back.
        mine.click()
        page.keyboard.press("Delete")
        expect(mine).to_have_count(0)
        self.in_diagram(edge_id, 0, region)
        undo(page)
        expect(mine).to_have_count(1)
        self.in_diagram(edge_id, 1, mine)

        # Backspace does the same.
        mine.click()
        page.keyboard.press("Backspace")
        expect(mine).to_have_count(0)
        undo(page)
        expect(mine).to_have_count(1)

        # Its menu's Delete, too.
        self.menu_at(centre(mine.bounding_box()), "Delete")
        expect(mine).to_have_count(0)
        self.in_diagram(edge_id, 0, region)
        undo(page)
        expect(mine).to_have_count(1)
        self.in_diagram(edge_id, 1, mine)

    def test_delete_a_selection_and_not_while_typing(self):
        page = self.page
        protein, _ = self.protein_by_its_lumen()
        region = piece(page, "apical-fluid")
        protein.click()
        modifier = "Meta" if sys.platform == "darwin" else "Control"
        box = region.bounding_box()
        page.keyboard.down(modifier)
        page.mouse.click(box["x"] + 10, box["y"] + 10)
        page.keyboard.up(modifier)
        expect(page.locator(f"{BIO} .vue-flow__node.selected")).to_have_count(2)

        # A rename dialog's field takes the keys, and nothing is deleted.
        self.menu_at(centre(protein.bounding_box()), "Rename…")
        page.locator("#bio-node-rename-input").press("Backspace")
        page.keyboard.press("Escape")
        expect(page.locator("[data-testid=bio-node-rename]")).to_have_count(0)
        expect(protein).to_have_count(1)
        expect(region).to_have_count(1)

        # The menu's item names the selection, and takes both in one step.
        self.menu_at(centre(protein.bounding_box()), "Delete Selection (2)")
        expect(protein).to_have_count(0)
        expect(region).to_have_count(0)
        undo(page)
        expect(protein).to_have_count(1)
        expect(region).to_have_count(1)

    def test_remove_a_whole_cell_deletes_everything_on_it(self):
        page = self.page
        protein, _ = self.protein_by_its_lumen()
        protein = page.locator(f'{BIO_NODE}[data-id="{protein.get_attribute("data-id")}"]')
        name = protein.locator(".bio-protein__label").inner_text().strip()
        self.piece_menu("cell", "Remove", "Epithelial_cell (whole cell)")
        # The fluids docked to it go too, and the protein on it: named in one question.
        dialog = page.locator(".p-dialog")
        expect(dialog).to_contain_text("Basolateral_fluid_interstitium")
        expect(dialog).to_contain_text(name)
        dialog.get_by_role("button", name="Remove", exact=True).click()
        expect(page.locator(f"{BIO_NODE}")).to_have_count(0)
        undo(page)
        expect(piece(page, "cell")).to_have_count(1)
        expect(protein).to_have_count(1)

    def test_delete_a_connection_shown_for_a_selected_protein(self):
        page = self.page
        protein, edge_id = self.protein_by_its_lumen()
        protein.click()
        shown = page.locator(f'{BIO} .vue-flow__edge[data-id="{edge_id}"]')
        expect(shown).to_have_count(1)
        # On the line where it leaves the protein's face for the lumen, clear of the protein drawn over its other end.
        line, face = shown.locator(".bio-coupling-edge__hover").bounding_box(), protein.bounding_box()
        self.menu_at((line["x"] + line["width"] / 2, (line["y"] + face["y"]) / 2), "Delete Connection")
        expect(shown).to_have_count(0)
        expect(protein).to_have_count(1)
        self.in_diagram(edge_id, 0, protein)
        undo(page)
        self.in_diagram(edge_id, 1, protein)

    # ---------- parameter sets and module configs from the physiological view -----------

    def set_menu(self, node):
        """Right-click an instance and open its Apply Parameter Set submenu."""
        page = self.page
        box = node.bounding_box()
        page.mouse.click(box["x"] + 30, box["y"] + 20, button="right")
        menu = page.locator(".p-contextmenu")
        menu.get_by_text("Apply Parameter Set", exact=True).hover()
        expect(menu.get_by_text("trial", exact=True)).to_be_visible()
        return menu

    def ticked(self, menu):
        return menu.locator(".p-contextmenu-item").filter(has_text=re.compile(r"^trial$")).locator(".pi-check")

    def test_apply_a_parameter_set_from_the_instance_menu(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        lumen = piece(page, "apical-fluid").bounding_box()
        region = self.swap_onto("apical-fluid", 1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        page.evaluate(ADD_TRIAL_SETS_JS)

        # As in the diagram: the values it changes are listed first, then applied and the set ticked.
        menu = self.set_menu(region)
        expect(self.ticked(menu)).to_have_count(0)
        menu.get_by_text("trial", exact=True).click()
        confirm = page.get_by_role("alertdialog").or_(page.get_by_role("dialog")).filter(has_text="Apply Parameter Set?")
        expect(confirm).to_contain_text("12345")
        confirm.get_by_role("button", name="Apply", exact=True).click()
        expect(confirm).to_have_count(0)
        menu = self.set_menu(region)
        expect(self.ticked(menu)).to_have_count(1)
        page.keyboard.press("Escape")
        expect(menu).to_be_hidden()

        # One undo takes it back.
        undo(page)
        menu = self.set_menu(region)
        expect(self.ticked(menu)).to_have_count(0)

    def test_placing_and_moving_leave_the_module_configs_alone(self):
        page = self.page
        protein, _ = self.protein_by_its_lumen()
        # Moved to the basolateral membrane, it is coupled to its new neighbour.
        cell = piece(page, "cell").bounding_box()
        start = centre(protein.bounding_box())
        self.drag(start, (cell["x"] + cell["width"] / 2 - start[0], cell["y"] + cell["height"] - start[1]))
        self.assertAlmostEqual(centre(protein.bounding_box())[1], cell["y"] + cell["height"], delta=4)

        # Saving either instance as it stands asks nothing: placing and moving touch no config.
        for node in (protein, piece(page, "apical-fluid")):
            node.dispatch_event("dblclick")
            editor = page.locator(".module-editor-dialog")
            expect(editor.get_by_role("tab", name=re.compile(r"Ports \(")).first).to_be_visible(timeout=30000)
            editor.get_by_role("button", name="Save", exact=True).click()
            expect(editor).to_be_hidden()
            expect(page.get_by_role("dialog", name="Save Module Config")).to_have_count(0)
            expect(page.get_by_role("dialog", name=re.compile("Parameter Set"))).to_have_count(0)


if __name__ == "__main__":
    unittest.main()
