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
    """An empty piece of the placed template, by its path in the template ('cell', 'apical-fluid', ...)."""
    return page.locator(f'{BIO_NODE}[data-id^="tpl:"][data-id$="/{path}"]')


def bound(page, kind):
    """Diagram instances drawn as one kind of node in the physiological view (bioRegion, bioProtein, ...)."""
    return page.locator(f'{BIO} .vue-flow__node-{kind}:not([data-id^="tpl:"])')


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

    def open_physiology_with_template(self, name):
        """Open the app, switch to the physiological view and place a template from the pane's menu."""
        page = self.page
        self.open_physiology()
        page.mouse.click(450, 200, button="right")
        menu = page.locator(".p-contextmenu")
        menu.get_by_text("Add Template", exact=True).hover()
        menu.get_by_text(name, exact=True).click()
        expect(page.locator("[data-testid=bio-template-title]")).to_have_count(1)
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

    # ---------- dropping modules on template sites -----------

    def test_fitting_the_view_keeps_clear_of_the_library(self):
        page = self.page
        # Narrow enough that the template fills the view.
        page.set_viewport_size({"width": 1000, "height": 900})
        self.open_physiology()
        page.mouse.click(450, 200, button="right")
        menu = page.locator(".p-contextmenu")
        menu.get_by_text("Add Template", exact=True).hover()
        menu.get_by_text("Epithelial cell", exact=True).click()
        expect(page.locator("[data-testid=bio-template-title]")).to_have_count(1)
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
        expect(piece(page, "apical-fluid")).to_have_count(0)
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


    def test_dragging_a_template_with_a_bound_protein_keeps_it_bound(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        lumen = piece(page, "apical-fluid").bounding_box()
        self.drop_module(1, (lumen["x"] + 20, lumen["y"] + lumen["height"] / 3))
        protein, region = bound(page, "bioProtein"), bound(page, "bioRegion")
        expect(region).to_have_count(1)

        # Both selected, dragged by the compartment: the template moves, and the protein moves with it, bound.
        protein.click()
        modifier = "Meta" if sys.platform == "darwin" else "Control"
        box = region.bounding_box()
        start = (box["x"] + 10, box["y"] + 10)
        page.keyboard.down(modifier)
        page.mouse.click(*start)
        page.keyboard.up(modifier)
        expect(page.locator(f"{BIO} .vue-flow__node.selected")).to_have_count(2)
        before = protein.bounding_box()
        page.mouse.move(*start)
        page.mouse.down()
        for step in range(1, 11):
            page.mouse.move(start[0] + 12 * step, start[1] + 6 * step)
        page.mouse.up()

        expect(protein).to_have_count(1)
        expect(page.locator(f"{BIO} .vue-flow__node-bioProtein[data-id^='tpl:']")).to_have_count(0)
        after, moved = protein.bounding_box(), region.bounding_box()
        self.assertGreater(moved["x"] - box["x"], 50)
        self.assertAlmostEqual(after["x"] - before["x"], moved["x"] - box["x"], delta=2)
        self.assertAlmostEqual(after["y"] - before["y"], moved["y"] - box["y"], delta=2)
        undo(page)
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

        # Off the template, clear of it: no longer joined to the lumen.
        start = centre(protein.bounding_box())
        self.drag(start, (cell["x"] + cell["width"] + 150 - start[0], lumen["y"] - start[1]))
        in_diagram(0)

        # One undo puts it back on the membrane, joined again: the edge's handles change in the same step.
        undo(page)
        self.assertAlmostEqual(centre(protein.bounding_box())[1], cell["y"], delta=4)
        in_diagram(1)

    # ---------- dragging structures and parts -----------

    def test_a_structure_drag_moves_the_whole_template_and_a_part_moves_alone(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        cell = piece(page, "cell").bounding_box()
        self.drop_module(0, (cell["x"] + cell["width"] / 2, cell["y"]))
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        title = page.locator(f"{BIO_NODE}-bioTemplateTitle")
        boxes = lambda: [loc.bounding_box() for loc in (piece(page, "cell"), piece(page, "apical-fluid"), protein, title)]

        # By its name: everything moves along as it is dragged, and stays where it is dropped.
        before = boxes()
        handle = title.bounding_box()
        self.drag((handle["x"] + 20, handle["y"] + handle["height"] / 2), (90, 50), release=False)
        offset = self.moved(before[3], title.bounding_box())
        self.assertGreater(offset[0], 50)
        self.assert_moved(before[1], piece(page, "apical-fluid").bounding_box(), offset)
        page.mouse.up()
        for old, new in zip(before, boxes()):
            self.assert_moved(old, new, offset)
        # One step, which one undo takes back.
        undo(page)
        expect(title).to_have_count(1)
        self.assert_moved(before[1], piece(page, "apical-fluid").bounding_box(), (0, 0))

        # By the cell's body, clear of its protein: the whole template again.
        before = boxes()
        body = piece(page, "cell").bounding_box()
        self.drag((body["x"] + 30, body["y"] + body["height"] * 0.6), (-60, 70))
        offset = self.moved(before[0], piece(page, "cell").bounding_box())
        self.assertGreater(offset[1], 40)
        for old, new in zip(before, boxes()):
            self.assert_moved(old, new, offset)

        # A protein is a part: dragged off its cell, it moves alone.
        before = boxes()
        start = centre(protein.bounding_box())
        self.drag(start, (0, -260))
        expect(protein).to_have_count(1)
        for old, new in zip(before[:2], boxes()[:2]):
            self.assert_moved(old, new, (0, 0))
        self.assertLess(protein.bounding_box()["y"], before[2]["y"] - 150)

        # Still selected, it stays put while the template is dragged by its name.
        before = boxes()
        handle = title.bounding_box()
        self.drag((handle["x"] + 20, handle["y"] + handle["height"] / 2), (80, 40))
        offset = self.moved(before[3], title.bounding_box())
        self.assertGreater(offset[0], 40)
        self.assert_moved(before[0], piece(page, "cell").bounding_box(), offset)
        self.assert_moved(before[2], protein.bounding_box(), (0, 0))

        # By the cell's outline, where its membrane is: the whole template.
        body = piece(page, "cell").bounding_box()
        band = (body["x"] + body["width"] * 0.2, body["y"] + 4)
        self.drop_module(1, band)
        expect(bound(page, "bioMembrane")).to_have_count(1)
        before = boxes()[:2]
        self.drag(band, (70, 40))
        offset = self.moved(before[0], piece(page, "cell").bounding_box())
        self.assertGreater(offset[0], 40)
        self.assert_moved(before[1], piece(page, "apical-fluid").bounding_box(), offset)
        self.assert_moved(piece(page, "cell").bounding_box(), bound(page, "bioMembrane").bounding_box(), (0, 0))

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

    # ---------- adding to and removing from a placed template -----------

    def piece_menu(self, path, *labels):
        """Right-click a template piece and follow its menu through the labels, clicking the last."""
        page = self.page
        expect(page.locator(".p-dialog-mask")).to_have_count(0)
        box = piece(page, path).bounding_box()
        page.mouse.click(box["x"] + 30, box["y"] + box["height"] * 0.6, button="right")
        menu = page.locator(".p-contextmenu")
        for label in labels[:-1]:
            menu.get_by_text(label, exact=True).hover()
        menu.get_by_text(labels[-1], exact=True).click()
        expect(menu).to_be_hidden()

    def test_add_empty_pieces_to_one_placed_template(self):
        page = self.page
        self.open_physiology_with_template("Epithelial cell")
        zones = piece(page, "cell").locator("[data-testid=bio-process-zone]")
        expect(zones).to_have_count(1)

        # A process zone, which takes cards like the template's own.
        self.piece_menu("cell", "Add Process Zone")
        expect(zones).to_have_count(2)
        self.drag_over(0, centre(zones.nth(1).bounding_box()))
        expect(page.locator(".bio-slot-prompt--active")).to_have_count(1)
        self.drop_module(0, centre(zones.nth(1).bounding_box()))
        expect(bound(page, "bioCard")).to_have_count(1)

        # A compartment against the apical side, named as it is added; it stacks outward from the lumen.
        lumen = piece(page, "apical-fluid").bounding_box()
        self.piece_menu("cell", "Add Compartment…", "Apical membrane")
        page.locator("[data-testid=bio-template-name-input]").fill("Mucus")
        page.locator("[data-testid=bio-template-name-confirm]").click()
        added = piece(page, "compartment-1")
        expect(added).to_have_count(1)
        expect(added).to_contain_text("Mucus")
        self.assertLess(added.bounding_box()["y"], lumen["y"])

        # Each is one step.
        undo(page)
        expect(added).to_have_count(0)
        undo(page)
        expect(bound(page, "bioCard")).to_have_count(0)
        undo(page)
        expect(zones).to_have_count(1)

        # Every edge of this cell has its protein site already.
        box = piece(page, "cell").bounding_box()
        page.mouse.click(box["x"] + 30, box["y"] + box["height"] * 0.6, button="right")
        site = page.locator(".p-contextmenu .p-contextmenu-item").filter(has_text="Add Protein Site")
        expect(site).to_have_class(has_class("p-disabled"))

    def test_add_a_protein_site_on_a_free_edge(self):
        page = self.page
        self.open_physiology_with_template("Vessel wall")
        cell = piece(page, "endothelial")
        labels = cell.locator("[data-testid=bio-facet-label]")
        count = labels.count()
        self.piece_menu("endothelial", "Add Protein Site", "Left")
        expect(labels).to_have_count(count + 1)
        expect(cell).to_contain_text("Protein site (left)")
        # A protein dropped on its edge goes on it.
        box = cell.bounding_box()
        self.drop_module(0, (box["x"], box["y"] + box["height"] / 2))
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        self.assertAlmostEqual(centre(protein.bounding_box())[0], cell.bounding_box()["x"], delta=4)

    def test_remove_pieces_from_one_placed_template_and_restore_them(self):
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
        page.locator(".p-contextmenu").get_by_text("Remove from This Template", exact=True).click()
        page.get_by_role("button", name="Cancel").click()
        expect(region).to_have_attribute("data-id", module)
        expect(page.locator(".p-dialog-mask")).to_have_count(0)
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, button="right")
        page.locator(".p-contextmenu").get_by_text("Remove from This Template", exact=True).click()
        # Exact, as each library card's remove button is named "Remove <module>".
        page.get_by_role("button", name="Remove", exact=True).click()
        expect(page.locator(f'{BIO_NODE}[data-id="{module}"]')).to_have_count(1)
        expect(page.locator(f'{BIO_NODE}[data-id^="tpl:"][data-id$="/paracellular"]')).to_have_count(0)
        expect(page.locator(f"{BIO} [data-testid=bio-region]")).to_have_count(3)

        # A facet of the cell, with nothing on it: gone at once, with the lumen against it.
        self.piece_menu("cell", "Remove from This Template", "Apical membrane")
        expect(piece(page, "apical-fluid")).to_have_count(0)
        labels = piece(page, "cell").locator("[data-testid=bio-facet-label]")
        expect(labels.filter(has_text="Apical membrane")).to_have_count(0)

        # Restore brings both back, empty, as one step.
        self.piece_menu("cell", "Restore Removed Elements")
        expect(piece(page, "apical-fluid")).to_have_count(1)
        expect(piece(page, "paracellular")).to_have_count(1)
        undo(page)
        expect(piece(page, "paracellular")).to_have_count(0)
        undo(page)
        undo(page)
        expect(region).to_have_attribute("data-id", module)

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

        # On the empty lumen: a new module bound to it, as one step.
        lumen = piece(page, "apical-fluid").bounding_box()
        self.menu_at((lumen["x"] + 30, lumen["y"] + 20), "New Module Here")
        expect(piece(page, "apical-fluid")).to_have_count(0)
        expect(bound(page, "bioRegion")).to_have_count(1)
        undo(page)
        expect(bound(page, "bioRegion")).to_have_count(0)
        expect(piece(page, "apical-fluid")).to_have_count(1)

        # On the apical slot of the empty cell: a new protein there, joined to its neighbours.
        cell = piece(page, "cell").bounding_box()
        self.menu_at((cell["x"] + cell["width"] / 2, cell["y"] + 2), "New Module Here")
        protein = bound(page, "bioProtein")
        expect(protein).to_have_count(1)
        self.assertAlmostEqual(centre(protein.bounding_box())[1], piece(page, "cell").bounding_box()["y"], delta=3)

        # Not on an occupied single site: the lumen bound again offers no new module.
        self.menu_at((lumen["x"] + 30, lumen["y"] + 20), "New Module Here")
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
        """A template with a protein on its apical slot, joined to the module on its lumen: (protein, edge id)."""
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

    def test_delete_a_template_keeps_its_modules(self):
        page = self.page
        protein, _ = self.protein_by_its_lumen()
        title = page.locator("[data-testid=bio-template-title]")
        self.menu_at(centre(title.bounding_box()), "Delete Template")
        expect(title).to_have_count(0)
        expect(protein).to_have_count(1)
        undo(page)
        expect(title).to_have_count(1)

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
