import re
import sys
import unittest

from playwright.sync_api import sync_playwright, expect

try:
    from .config import BASE_URL, HEADLESS_MODE
except ImportError:
    from config import BASE_URL, HEADLESS_MODE


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


class TestBioTemplates(unittest.TestCase):

    def setUp(self):
        self.playwright = sync_playwright().start()
        self.browser = self.playwright.chromium.launch(headless=HEADLESS_MODE)
        self.context = self.browser.new_context(viewport={"width": 1600, "height": 1000})
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
        page.wait_for_timeout(300)
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

    def test_delete_takes_a_piece_a_layer_at_a_time(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        regions = page.locator(f"{BIO} .vue-flow__node-bioRegion")

        # A compartment: the first Delete takes its module, leaving it empty; the second takes it.
        self.drop_piece("compartment", self.pane_point(0.3, 0.3))
        expect(bound(page, "bioRegion")).to_have_count(1)
        box = piece(page, "compartment").bounding_box()
        corner = (box["x"] + 20, box["y"] + box["height"] - 15)
        self.delete_at(corner)
        expect(bound(page, "bioRegion")).to_have_count(0)
        expect(empty_piece(page, "compartment")).to_have_count(1)
        self.delete_at(corner)
        expect(regions).to_have_count(0)

        # A cell's inside: its compartment's module, then the compartment with everything attached to it, its
        # membrane and the membrane's module, once that is confirmed, leaving nothing behind.
        cell = self.drop_cell(self.pane_point(0.5, 0.45), "compartment")
        expect(bound(page, "bioMembrane")).to_have_count(1)
        self.expect_in_diagram(2)
        box = cell.bounding_box()
        inside = (box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.3)
        self.delete_at(inside)
        expect(bound(page, "bioCell")).to_have_count(0)
        expect(bound(page, "bioMembrane")).to_have_count(1)
        self.delete_at(inside)
        page.locator(".p-dialog").get_by_role("button", name="Remove", exact=True).click()
        expect(page.locator(f"{BIO} .vue-flow__node")).to_have_count(0)
        self.expect_in_diagram(0)
        # One step, undone as one: back to the empty compartment in its membrane, the membrane's module on it.
        undo(page)
        expect(bound(page, "bioMembrane")).to_have_count(1)
        expect(empty_piece(page, "compartment")).to_have_count(1)
        expect(page.locator(f"{BIO} .vue-flow__node-bioCell")).to_have_count(1)

    def test_delete_on_a_cells_membrane_takes_its_module_then_the_membrane_alone(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        cells = page.locator(f"{BIO} .vue-flow__node-bioCell")

        cell = self.drop_cell(self.pane_point(0.5, 0.45), "compartment")
        box = cell.bounding_box()
        band = (box["x"] + 2, box["y"] + box["height"] / 2)
        inside = (box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.3)

        # The membrane's module goes, the membrane staying, empty, round the compartment and its module.
        self.delete_at(band)
        expect(bound(page, "bioMembrane")).to_have_count(0)
        expect(bound(page, "bioCell")).to_have_count(1)
        # The empty membrane is still selectable by its band; Delete takes it, leaving the compartment as it was.
        self.delete_at(band)
        expect(cells).to_have_count(0)
        expect(bound(page, "bioRegion")).to_have_count(1)
        # Then the compartment, a layer at a time: its module, then itself.
        self.delete_at(inside)
        expect(bound(page, "bioRegion")).to_have_count(0)
        expect(empty_piece(page, "compartment")).to_have_count(1)
        self.delete_at(inside)
        expect(page.locator(f"{BIO} .vue-flow__node-bioRegion")).to_have_count(0)

    def on_top_at_its_centre(self, node):
        """Whether a node is the one drawn on top at its own centre, so not hidden by what it is in."""
        x, y = centre(node.bounding_box())
        top = self.page.evaluate(
            "([x, y]) => document.elementFromPoint(x, y)?.closest('.vue-flow__node')?.dataset.id", [x, y]
        )
        return top == node.get_attribute("data-id")

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

        # In a bare compartment, then a membrane put round that: the inner one still shows.
        self.drop_piece("compartment", self.pane_point(0.75, 0.45))
        outer = piece(page, "compartment-3")
        expect(outer).to_be_visible()
        self.drop_piece("compartment", centre(outer.bounding_box()))
        inner = piece(page, "compartment-4")
        expect(inner).to_be_visible()
        assert self.on_top_at_its_centre(inner)
        box = outer.bounding_box()
        self.drop_piece("membrane", (box["x"] + 30, box["y"] + 30))
        expect(page.locator(f'{BIO} .vue-flow__node-bioCell:has([data-site="pieces/compartment-3"])')).to_be_visible()
        page.wait_for_timeout(300)
        assert self.on_top_at_its_centre(inner)

    def test_delete_takes_a_tube_and_a_process_zone_a_layer_at_a_time(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        self.drop_piece("compartment", self.pane_point(0.3, 0.4))
        self.drop_piece("compartment", self.pane_point(0.85, 0.3))
        expect(piece(page, "compartment-2")).to_be_visible()
        page.wait_for_timeout(300)

        # A tube: its module's card, then the tube, selected by its empty room.
        self.drop_piece("tube", centre(piece(page, "compartment").bounding_box()))
        link = page.locator("[data-testid=bio-link]")
        expect(link).to_have_count(1)
        self.delete_at(centre(bound(page, "bioCard").bounding_box()))
        expect(bound(page, "bioCard")).to_have_count(0)
        expect(link).to_have_count(1)
        room = page.locator(".bio-link__zone")
        self.delete_at(centre(room.bounding_box()))
        expect(link).to_have_count(0)
        expect(piece(page, "compartment")).to_be_visible()

        # A process zone, empty, goes at once.
        self.drop_piece("zone", centre(piece(page, "compartment").bounding_box()))
        zone = page.locator(f"{BIO} .vue-flow__node-bioZone")
        expect(zone).to_have_count(1)
        box = zone.bounding_box()
        self.delete_at((box["x"] + box["width"] - 12, box["y"] + box["height"] - 8))
        expect(zone).to_have_count(0)

    def test_the_build_palette_joins_two_compartments_with_a_tube(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()

        # Two compartments on the view, side by side.
        self.drop_piece("compartment", self.pane_point(0.3, 0.4))
        first = piece(page, "compartment")
        expect(first).to_be_visible()
        self.drop_piece("compartment", self.pane_point(0.85, 0.3))
        second = piece(page, "compartment-2")
        expect(second).to_be_visible()
        page.wait_for_timeout(300)
        one, two = first.bounding_box(), second.bounding_box()
        assert two["x"] > one["x"] + one["width"], (one, two)

        # A tube dropped on the first joins it to the nearest other, with a new module in it named for it.
        self.drop_piece("tube", centre(one))
        link = page.locator("[data-testid=bio-link]")
        expect(link).to_have_count(1)
        held = bound(page, "bioCard").filter(has_text="Tube")
        expect(held).to_have_count(1)

        # A library module dropped on the tube's room takes the new one's place.
        page.locator("[data-testid=library-tab-modules]").click()
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        page.wait_for_timeout(400)
        self.drop_module(0, centre(held.bounding_box()))
        expect(link).to_have_count(1)
        expect(held).to_have_count(0)
        expect(bound(page, "bioCard")).to_have_count(1)

        # A compartment dragged takes its end of the tube along, and one step back puts it where it was.
        two = second.bounding_box()
        self.drag((two["x"] + two["width"] - 30, two["y"] + two["height"] - 20), (0, 160))
        page.wait_for_timeout(300)
        self.assertGreater(second.bounding_box()["y"] - two["y"], 120)
        undo(page)
        page.wait_for_timeout(300)
        self.assert_moved(two, second.bounding_box(), (0, 0), delta=2)

    def test_the_build_palette_joins_two_cells_with_a_gap_junction(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()

        first = self.drop_cell(self.pane_point(0.3, 0.4), "compartment")
        one = first.bounding_box()
        second = self.drop_cell((one["x"] + one["width"] * 1.9, one["y"] + one["height"] / 2), "compartment-2")
        page.wait_for_timeout(300)
        one, two = first.bounding_box(), second.bounding_box()
        assert two["x"] > one["x"] + one["width"], (one, two)

        # A tube between two cells is a junction, with a new module on it named for it.
        self.drop_piece("tube", centre(one))
        link = page.locator("[data-testid=bio-link]")
        expect(link).to_have_count(1)
        expect(page.locator(BIO).get_by_text("Junction", exact=True)).to_be_visible()

        # The cell's menu takes it away again, asking first, as a module is in it; the module stays in the diagram.
        count = page.locator(f'{BIO_NODE}:not([data-id^="pc:"]):not([data-id^="grip:"])').count()
        self.piece_menu("compartment", "Remove", "Junction")
        expect(page.locator(".p-dialog")).to_be_visible()
        page.locator(".p-dialog").get_by_role("button", name="Remove", exact=True).click()
        expect(link).to_have_count(0)
        expect(page.locator(f'{BIO_NODE}:not([data-id^="pc:"]):not([data-id^="grip:"])')).to_have_count(count)

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

    def test_the_build_palette_puts_an_organelle_inside_a_cell(self):
        page = self.page
        self.open_physiology()
        page.locator("[data-testid=library-tab-build]").click()
        cell = self.drop_cell(self.pane_point(0.5, 0.4), "compartment")
        before = cell.bounding_box()

        # A membrane dropped in the cell's cytoplasm is refused: it has a membrane already.
        nodes = page.locator(BIO_NODE).count()
        self.drop_piece("membrane", centre(before))
        page.wait_for_timeout(300)
        expect(page.locator(BIO_NODE)).to_have_count(nodes)

        # Dropped on a compartment inside the cell, it encloses it: an organelle, and the cell grows to hold it.
        organelle = self.drop_cell(centre(before), "compartment-2")
        name = organelle.locator("[data-testid=bio-piece-name]")
        expect(name).to_have_text("Compartment_2")
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        page.wait_for_timeout(400)
        outer, inner = cell.bounding_box(), organelle.bounding_box()
        assert outer["x"] < inner["x"] and inner["x"] + inner["width"] < outer["x"] + outer["width"], (outer, inner)
        assert outer["y"] < inner["y"] and inner["y"] + inner["height"] < outer["y"] + outer["height"], (outer, inner)

        # A compartment dropped just inside the cell's bottom side docks against it, inside: a microdomain.
        self.drop_piece("compartment", (outer["x"] + outer["width"] * 0.15, outer["y"] + outer["height"] - 12))
        microdomain = piece(page, "microdomain")
        expect(microdomain).to_be_visible()
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        page.wait_for_timeout(400)
        outer, under = cell.bounding_box(), microdomain.bounding_box()
        assert under["y"] > outer["y"] + outer["height"] / 2, (outer, under)

        # A fold dropped by the cell's top side dips in from it.
        self.drop_piece("fold", (outer["x"] + outer["width"] * 0.8, outer["y"] + 10))
        fold = page.locator("[data-testid=bio-fold]")
        expect(fold).to_have_count(1)
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        page.wait_for_timeout(400)
        outer, dip = cell.bounding_box(), fold.bounding_box()
        assert abs(dip["y"] - outer["y"]) < 6 and dip["height"] > 0.2 * outer["height"], (outer, dip)
        inner = organelle.bounding_box()

        # A module dropped on the organelle takes the place of the new module in it, not the cell's.
        page.locator("[data-testid=library-tab-modules]").click()
        expect(name).to_have_text("Compartment_2")
        self.drop_module(2, centre(inner))
        expect(name).not_to_have_text("Compartment_2")
        expect(cell.locator("[data-testid=bio-piece-name]").first).to_have_text("Compartment")

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
        """Open the app, switch to the physiological view and place a template's pieces from the pane's menu."""
        page = self.page
        self.open_physiology()
        page.mouse.click(450, 200, button="right")
        menu = page.locator(".p-contextmenu")
        menu.get_by_text("Add Template", exact=True).hover()
        menu.get_by_text(name, exact=True).click()
        expect(page.locator(f'{BIO_NODE}[data-id^="pc:"]').first).to_be_visible()
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
        page.wait_for_timeout(400)
        self.assertGreaterEqual(min(lefts()), edge)
        page.locator(f"{BIO} .vue-flow__controls-zoomout").click()
        page.locator(f"{BIO} .vue-flow__controls-fitview").click()
        page.wait_for_timeout(400)
        self.assertGreaterEqual(min(lefts()), edge)

    def test_the_drop_target_and_its_label_are_green(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        hint = centre(page.locator("[data-testid=bio-cell] [data-testid=bio-empty-hint]").bounding_box())
        self.drag_over(0, hint)
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

    def test_drop_on_the_cell_hint_then_on_its_membrane(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        active = page.locator(".bio-site-prompt--active")

        # On the empty cell's hint: the cell's inside, not a process card.
        hint = centre(page.locator("[data-testid=bio-cell] [data-testid=bio-empty-hint]").bounding_box())
        self.drag_over(0, hint)
        expect(active).to_have_class(has_class("bio-site-prompt--cell"))
        self.drop_module(0, hint)
        expect(bound(page, "bioCell")).to_have_count(1)
        expect(bound(page, "bioCard")).to_have_count(0)

        # Just inside the outline, between the apical slot and the corner: the cell's membrane.
        cell = bound(page, "bioCell").bounding_box()
        band = (cell["x"] + cell["width"] * 0.2, cell["y"] + 4)
        self.drag_over(1, band)
        expect(active).to_have_class(has_class("bio-site-prompt--membrane"))
        self.drop_module(1, band)
        expect(bound(page, "bioMembrane")).to_have_count(1)
        expect(bound(page, "bioCell")).to_have_count(1)

    def test_a_membrane_on_an_empty_cell_draws_its_bilayer(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        cell = piece(page, "cell")
        expect(cell.locator("[data-testid=bio-bilayer]")).to_have_count(0)

        # Just inside the empty cell's outline: its membrane, which shows though nothing is inside yet.
        box = cell.bounding_box()
        self.drop_module(1, (box["x"] + box["width"] * 0.2, box["y"] + 4))
        expect(bound(page, "bioMembrane")).to_have_count(1)
        expect(cell.locator("[data-testid=bio-bilayer]")).to_have_count(1)
        expect(cell.locator("[data-testid=bio-empty-hint]")).to_have_count(1)

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
        protein_box = protein.bounding_box()
        self.assertAlmostEqual(protein_box["y"] + protein_box["height"] / 2, cell["y"], delta=2)

        # On the apical fluid, clear of the slots: the band becomes that module's.
        lumen = piece(page, "apical-fluid").bounding_box()
        point = (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3)
        self.drop_module(1, point)
        expect(empty_piece(page, "apical-fluid")).to_have_count(0)
        expect(bound(page, "bioRegion")).to_have_count(1)
        first = bound(page, "bioRegion").get_attribute("data-id")

        # Another on the same fluid replaces it, once confirmed, and the one it replaced becomes a card.
        self.drop_module(2, point)
        page.get_by_role("button", name="Replace").click()
        expect(bound(page, "bioRegion")).to_have_count(1)
        expect(bound(page, "bioRegion")).not_to_have_attribute("data-id", first)
        expect(bound(page, "bioCard")).to_have_count(1)
        expect(bound(page, "bioCard")).to_have_attribute("data-id", first)

        # One undo takes back the whole replacing drop: the new instance goes, and the first is bound again.
        undo(page)
        expect(bound(page, "bioCard")).to_have_count(0)
        expect(bound(page, "bioRegion")).to_have_attribute("data-id", first)
        expect(bound(page, "bioProtein")).to_have_count(1)


    def test_dragging_a_cell_with_a_bound_protein_keeps_it_bound(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        lumen = piece(page, "apical-fluid").bounding_box()
        self.drop_module(1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        protein, region = bound(page, "bioProtein"), bound(page, "bioRegion")
        expect(region).to_have_count(1)

        # Dragged by its inside, clear of what is in it: the cell moves, and the protein and the fluid move with it.
        box = piece(page, "cell").bounding_box()
        before, lumen = protein.bounding_box(), region.bounding_box()
        self.drag((box["x"] + 30, box["y"] + box["height"] - 40), (120, 60))
        page.wait_for_timeout(300)
        expect(protein).to_have_count(1)
        moved = piece(page, "cell").bounding_box()
        offset = self.moved(box, moved)
        self.assertGreater(offset[0], 50)
        self.assert_moved(before, protein.bounding_box(), offset, delta=2)
        self.assert_moved(lumen, region.bounding_box(), offset, delta=2)
        undo(page)
        page.wait_for_timeout(300)
        expect(protein).to_have_count(1)
        self.assertAlmostEqual(protein.bounding_box()["x"], before["x"], delta=2)

    def test_a_protein_moved_to_another_facet_joins_that_facets_fluid_instead(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        lumen = piece(page, "apical-fluid").bounding_box()
        self.drop_module(1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        expect(bound(page, "bioRegion")).to_have_count(1)
        blood = piece(page, "basolateral-fluid").bounding_box()
        self.drop_module(2, (blood["x"] + 20, blood["y"] + blood["height"] * 2 / 3))
        regions = bound(page, "bioRegion")
        expect(regions).to_have_count(2)
        apical, basolateral = regions.nth(0).get_attribute("data-id"), regions.nth(1).get_attribute("data-id")
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
        self.drop_module(1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        region = bound(page, "bioRegion")
        expect(region).to_have_count(1)
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        joined = page.locator(
            f'.vue-flow__edge[data-id="{region.get_attribute("data-id")}--{protein.get_attribute("data-id")}"]'
        )

        def in_diagram(count):
            page.locator("[data-testid=view-mode]").get_by_text("Diagram").click()
            expect(joined).to_have_count(count)
            page.locator("[data-testid=view-mode]").get_by_text("Physiology").click()
            expect(protein).to_have_count(1)

        in_diagram(1)

        # Off the cell, clear of it: no longer joined to the lumen.
        start = centre(protein.bounding_box())
        self.drag(start, (cell["x"] + cell["width"] + 150 - start[0], lumen["y"] - start[1]))
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
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        boxes = lambda: [loc.bounding_box() for loc in (piece(page, "cell"), piece(page, "apical-fluid"), protein)]

        # By the cell's body, clear of its protein: everything in and against it moves along as it is dragged, and
        # stays where it is dropped.
        before = boxes()
        body = before[0]
        self.drag((body["x"] + 30, body["y"] + body["height"] - 40), (90, 50), release=False)
        offset = self.moved(before[0], piece(page, "cell").bounding_box())
        self.assertGreater(offset[0], 50)
        self.assert_moved(before[1], piece(page, "apical-fluid").bounding_box(), offset)
        page.mouse.up()
        page.wait_for_timeout(300)
        for old, new in zip(before, boxes()):
            self.assert_moved(old, new, offset)
        # One step, which one undo takes back.
        undo(page)
        page.wait_for_timeout(300)
        self.assert_moved(before[1], piece(page, "apical-fluid").bounding_box(), (0, 0))

        # A protein is a part: dragged off its cell, it moves alone.
        before = boxes()
        start = centre(protein.bounding_box())
        self.drag(start, (0, -260))
        expect(protein).to_have_count(1)
        page.wait_for_timeout(300)
        # The cell stays where it is; it refits its top side, now with no protein on it.
        self.assertAlmostEqual(boxes()[0]["x"], before[0]["x"], delta=3)
        self.assertLess(protein.bounding_box()["y"], before[2]["y"] - 150)

        # Off it, it stays put while the cell is dragged.
        before = boxes()
        body = before[0]
        self.drag((body["x"] + 30, body["y"] + body["height"] - 40), (80, 40))
        page.wait_for_timeout(300)
        offset = self.moved(before[0], piece(page, "cell").bounding_box())
        self.assertGreater(offset[0], 40)
        self.assert_moved(before[1], piece(page, "apical-fluid").bounding_box(), offset)
        self.assert_moved(before[2], protein.bounding_box(), (0, 0))

    def test_a_hand_added_cell_takes_its_cards_and_regions_along(self):
        page = self.page
        self.open_physiology()
        menu = page.locator(".p-contextmenu")
        dialog = page.locator("[data-testid=bio-place-dialog]")

        # A cell, and a compartment against its apical side.
        page.mouse.click(700, 500, button="right")
        menu.get_by_text("Add Cell…", exact=True).click()
        self.choose("bio-place-module", 0)
        page.locator("[data-testid=bio-place-confirm]").click()
        cell = bound(page, "bioCell")
        expect(cell).to_have_count(1)
        expect(dialog).to_have_count(0)
        box = cell.bounding_box()
        page.mouse.click(box["x"] - 120, box["y"] + 20, button="right")
        menu.get_by_text("Add Compartment…", exact=True).click()
        self.choose("bio-place-module", 0)
        self.choose("bio-place-cell", 1)
        expect(dialog.locator("[data-testid=bio-place-cell]")).not_to_contain_text("Not against")
        page.locator("[data-testid=bio-place-confirm]").click()
        region = bound(page, "bioRegion")
        expect(region).to_have_count(1)

        # A process inside it, dropped there then dragged to a place of its own; the region dragged to one too.
        box = cell.bounding_box()
        self.drop_module(2, (box["x"] + box["width"] / 2, box["y"] + box["height"] * 0.6))
        card = bound(page, "bioCard")
        expect(card).to_have_count(1)
        self.drag(centre(card.bounding_box()), (20, 10))
        lumen = region.bounding_box()
        self.drag((lumen["x"] + 30, lumen["y"] + 20), (0, -30))

        # The cell dragged: the card and the region come along as it goes, and stay with it once dropped.
        before = [loc.bounding_box() for loc in (cell, card, region)]
        box = cell.bounding_box()
        self.drag((box["x"] + box["width"] - 40, box["y"] + box["height"] - 40), (120, 60), release=False)
        offset = self.moved(before[0], cell.bounding_box())
        self.assertGreater(offset[0], 80)
        self.assert_moved(before[2], region.bounding_box(), offset)
        page.mouse.up()
        for old, new in zip(before, [loc.bounding_box() for loc in (cell, card, region)]):
            self.assert_moved(old, new, offset)

    def add_cell(self, point=(700, 500)):
        """Add a hand-added cell, with no membrane, from the pane's menu."""
        page = self.page
        page.mouse.click(*point, button="right")
        page.locator(".p-contextmenu").get_by_text("Add Cell…", exact=True).click()
        self.choose("bio-place-module", 0)
        page.locator("[data-testid=bio-place-confirm]").click()
        cell = bound(page, "bioCell")
        expect(cell).to_have_count(1)
        expect(page.locator("[data-testid=bio-place-dialog]")).to_have_count(0)
        return cell

    def test_drop_on_a_hand_added_cells_membrane_and_inside(self):
        page = self.page
        self.open_physiology()
        cell = self.add_cell()
        active = page.locator(".bio-site-prompt--active")
        label = page.locator("[data-testid=bio-drop-label]")

        # Just inside the outline, clear of its slots: the cell's membrane.
        box = cell.bounding_box()
        band = (box["x"] + box["width"] * 0.12, box["y"] + 3)
        self.drag_over(1, band)
        expect(active).to_have_class(has_class("bio-site-prompt--membrane"))
        expect(label).to_contain_text("(membrane)")
        self.drop_module(1, band)
        expect(bound(page, "bioMembrane")).to_have_count(1)
        # It now has one: no membrane prompt there any more.
        self.drag_over(2, band)
        expect(page.locator(".bio-site-prompt--membrane")).to_have_count(0)

        # Well inside: a process in the cell.
        box = cell.bounding_box()
        inside = (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        self.drag_over(2, inside)
        expect(active).to_have_class(has_class("bio-site-prompt--cell"))
        expect(label).to_contain_text("(intracellular space)")
        self.drop_module(2, inside)
        card = bound(page, "bioCard")
        expect(card).to_have_count(1)
        card_box, cell_box = card.bounding_box(), cell.bounding_box()
        self.assertGreater(card_box["x"], cell_box["x"])
        self.assertLess(card_box["x"] + card_box["width"], cell_box["x"] + cell_box["width"])
        # Each drop is one step.
        undo(page)
        expect(bound(page, "bioCard")).to_have_count(0)
        undo(page)
        expect(bound(page, "bioMembrane")).to_have_count(0)

    def drop_as(self, index, point, role, cell=None):
        """Drop the library's index-th module on an empty point and say what it is, and in or against which cell."""
        page = self.page
        self.drop_module(index, point)
        self.choose("bio-place-role", role)
        if cell is not None:
            self.choose("bio-place-cell", cell)
        page.locator("[data-testid=bio-place-confirm]").click()
        expect(page.locator("[data-testid=bio-place-dialog]")).to_have_count(0)

    def test_drag_existing_nodes_into_a_hand_added_cell(self):
        page = self.page
        self.open_physiology()
        cell = self.add_cell()
        box = cell.bounding_box()

        # A protein in no membrane yet, dragged onto the cell's apical slot: it goes in the membrane there.
        self.drop_as(0, (box["x"] - 200, box["y"] + 40), "A protein in a cell’s membrane", "Not in a membrane yet")
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        expect(protein.locator("[data-testid=bio-protein]")).to_have_class(has_class("bio-protein--unplaced"))
        # Adding it can refit the view.
        box = cell.bounding_box()
        # Dropped on the cell's outline by a corner, clear of its slots, a protein never becomes its membrane.
        start = centre(protein.bounding_box())
        corner = (box["x"] + box["width"] * 0.12, box["y"] + 3)
        self.drag(start, (corner[0] - start[0], corner[1] - start[1]))
        expect(bound(page, "bioProtein")).to_have_count(1)
        expect(bound(page, "bioMembrane")).to_have_count(0)
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
        moved = cell.bounding_box()
        self.assertAlmostEqual(centre(protein.bounding_box())[0] - at[0], moved["x"] - box["x"], delta=3)

        # A card dragged into the cell: a process inside it, as one step.
        box = moved
        self.drop_as(2, (box["x"] + box["width"] + 200, box["y"] + 40), "Nothing physiological (a card)")
        card = bound(page, "bioCard")
        expect(card).to_have_count(1)
        box = cell.bounding_box()
        before = card.bounding_box()
        start = centre(before)
        self.drag(start, (box["x"] + box["width"] / 2 - start[0], box["y"] + box["height"] * 0.6 - start[1]))
        inside = card.bounding_box()
        self.assertGreater(inside["x"], box["x"])
        self.assertLess(inside["x"] + inside["width"], box["x"] + box["width"])
        undo(page)
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

    def test_a_rod_is_drawn_to_its_own_outline_with_proteins_along_it(self):
        page = self.page
        self.open_physiology_with_template("Rod photoreceptor")
        fit = page.locator(f"{BIO} .vue-flow__controls-fitview")
        fit.click()
        page.wait_for_timeout(400)
        rod = page.locator(f'{BIO_NODE}[data-id="pc:plasma-membrane"]')
        # Its skin draws it: artwork inside an outline that is no rounded box, lying on its side.
        expect(rod.locator("[data-testid=bio-skin]")).to_have_count(1)
        expect(rod.locator("[data-testid=bio-bilayer]")).to_have_count(1)
        expect(rod.locator("[data-testid=bio-empty-hint]")).to_have_count(0)
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
            page.wait_for_timeout(400)
            box = rod.bounding_box()
        sites = page.evaluate("""() => {
            let c = [...document.querySelectorAll('.vue-flow')].find((el) => !el.closest('.bio-flow')).__vueParentComponent
            while (c && !c.exposed?.nodes) c = c.parent
            return c.exposed.nodes.value.map((n) => n.data.bioView?.site).filter(Boolean).sort()
        }""")
        self.assertEqual(sites, ["pieces/plasma-membrane.os-lower", "pieces/plasma-membrane.os-upper"])

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

    def test_remove_a_piece_keeping_the_module_on_it_and_undo(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        para = piece(page, "paracellular")
        expect(para).to_have_count(1)

        # A module on the paracellular space: removing it asks first, and the module stays in the diagram.
        box = para.bounding_box()
        self.drop_module(1, (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2))
        region = bound(page, "bioRegion")
        expect(region).to_have_count(1)
        module = region.get_attribute("data-id")
        box = region.bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, button="right")
        page.locator(".p-contextmenu").get_by_text("Remove", exact=True).click()
        page.get_by_role("button", name="Cancel").click()
        expect(region).to_have_attribute("data-id", module)
        expect(page.locator(".p-dialog-mask")).to_have_count(0)
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, button="right")
        page.locator(".p-contextmenu").get_by_text("Remove", exact=True).click()
        # Exact, as each library card's remove button is named "Remove <module>".
        page.get_by_role("button", name="Remove", exact=True).click()
        expect(page.locator(f'{BIO_NODE}[data-id="{module}"]')).to_have_count(1)
        expect(page.locator(f'{BIO_NODE}:has([data-site="pieces/paracellular"])')).to_have_count(0)

        # The cell's process zone, with nothing on it: gone at once.
        self.piece_menu("cell", "Remove", "Metabolism")
        expect(page.locator(f'{BIO_NODE}:has([data-site="pieces/metabolism"])')).to_have_count(0)

        # Each is one step.
        undo(page)
        expect(piece(page, "metabolism")).to_have_count(1)
        undo(page)
        expect(region).to_have_attribute("data-id", module)
        expect(piece(page, "paracellular")).to_have_count(1)

    # ---------- renaming instances -----------

    def test_rename_an_instance_from_the_physiology_view(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        lumen = piece(page, "apical-fluid").bounding_box()
        self.drop_module(1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        region, protein = bound(page, "bioRegion"), bound(page, "bioProtein")
        expect(region).to_have_count(1)
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

    def test_new_module_here_on_an_empty_site_or_slot(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")

        # On the empty lumen: a new module bound to it, as one step, opened in the editor to write its math.
        lumen = piece(page, "apical-fluid").bounding_box()
        self.menu_at((lumen["x"] + 30, lumen["y"] + 20), "New Module Here")
        self.cancel_editor()
        expect(empty_piece(page, "apical-fluid")).to_have_count(0)
        expect(bound(page, "bioRegion")).to_have_count(1)
        undo(page)
        expect(bound(page, "bioRegion")).to_have_count(0)
        expect(empty_piece(page, "apical-fluid")).to_have_count(1)

        # On the apical slot of the empty cell: a new protein there, joined to its neighbours.
        cell = piece(page, "cell").bounding_box()
        self.menu_at((cell["x"] + cell["width"] / 2, cell["y"] + 2), "New Module Here")
        self.cancel_editor()
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        self.assertAlmostEqual(centre(protein.bounding_box())[1], piece(page, "cell").bounding_box()["y"], delta=3)

        # Not on an occupied single site: the lumen bound again offers no new module.
        self.menu_at((lumen["x"] + 30, lumen["y"] + 20), "New Module Here")
        self.cancel_editor()
        region = bound(page, "bioRegion")
        expect(region).to_have_count(1)
        box = region.bounding_box()
        page.mouse.click(box["x"] + 30, box["y"] + 20, button="right")
        expect(page.locator(".p-contextmenu")).to_be_visible()
        expect(page.locator(".p-contextmenu").get_by_text("New Module Here", exact=True)).to_have_count(0)
        page.keyboard.press("Escape")

    def test_add_dialogs_offer_a_new_module_first(self):
        page = self.page
        self.open_physiology()
        page.mouse.click(700, 500, button="right")
        page.locator(".p-contextmenu").get_by_text("Add Cell…", exact=True).click()
        page.locator("[data-testid=bio-place-module]").click()
        expect(page.locator(".p-select-overlay .p-select-option").first).to_have_text("new_module:phlynx")


    # ---------- deleting -----------

    def protein_by_its_lumen(self):
        """An epithelial cell with a protein on its apical slot, joined to the module on its lumen: (protein, edge id)."""
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        lumen = piece(page, "apical-fluid").bounding_box()
        self.drop_module(1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        region = bound(page, "bioRegion")
        expect(region).to_have_count(1)
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
        region = bound(page, "bioRegion")
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
        region = bound(page, "bioRegion")
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

    def test_remove_a_whole_cell_keeps_its_modules(self):
        page = self.page
        protein, _ = self.protein_by_its_lumen()
        self.piece_menu("cell", "Remove", "Epithelial cell (whole cell)")
        page.get_by_role("button", name="Remove", exact=True).click()
        expect(page.locator(f'{BIO_NODE}[data-id^="pc:"]')).to_have_count(0)
        expect(protein).to_have_count(1)
        undo(page)
        expect(piece(page, "cell")).to_have_count(1)

    def test_delete_a_connection_shown_for_a_selected_protein(self):
        page = self.page
        protein, edge_id = self.protein_by_its_lumen()
        protein.click()
        shown = page.locator(f'{BIO} .vue-flow__edge[data-id="{edge_id}"]')
        expect(shown).to_have_count(1)
        self.menu_at(centre(shown.locator(".bio-coupling-edge__hover").bounding_box()), "Delete Connection")
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
        self.drop_module(1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        region = bound(page, "bioRegion")
        expect(region).to_have_count(1)
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
        for node in (protein, bound(page, "bioRegion")):
            node.dispatch_event("dblclick")
            editor = page.locator(".module-editor-dialog")
            expect(editor.get_by_role("tab", name=re.compile(r"Ports \(")).first).to_be_visible(timeout=30000)
            editor.get_by_role("button", name="Save", exact=True).click()
            expect(editor).to_be_hidden()
            expect(page.get_by_role("dialog", name="Save Module Config")).to_have_count(0)
            expect(page.get_by_role("dialog", name=re.compile("Parameter Set"))).to_have_count(0)


if __name__ == "__main__":
    unittest.main()
